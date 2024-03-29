/*
 * form2latex - Common Helper Module
 *
 * MIT License
 *
 * Copyright (c) 2019-2023 Peter Schüller
 */
const _ = require("underscore")
const child_process = require('child_process')
const fs = require("fs");
const mustache = require("mustache");

const configFile = process.env.CONFIG || "configs/config_local.json"
const config = JSON.parse(fs.readFileSync(configFile, "utf-8"));
const packagejson = JSON.parse(fs.readFileSync("package.json", "utf-8"));

exports.config = config

// we need this for forms, because single fields return single values
// but multiple fields return arrays and we always want to handle arrays
// (this simplifies the code)
const ensure_array = (thing) => _.flatten([thing])
exports.ensure_array = ensure_array

const sleep = (ms) => {
	return new Promise(resolve=>{
		setTimeout(resolve,ms)
	})
}
exports.sleep = sleep

exports.common_substitutions = {
  commoncss: fs.readFileSync("templates/common.css", "utf8"),
  commonjs: fs.readFileSync("templates/common.js", "utf8"),
  prefix: config.prefix,
  site_title: config.site_title + ' v'+packagejson.version,
  appversion: 'v'+packagejson.version,
  showlogout: _.has(config, 'users'),
}

// replace \r\n by \n
// replace multiple \n by single \n
// strip leading/trailing newlines
exports.normalize_newlines = (obj) => {
	const ret = _.object(
		_.pairs(obj)
		.map((kv) => {
			if (_.isArray(kv[1]))
				return [kv[0], kv[1].map((v) => v.replace(/(\r\n)+/g, '\n').trim())]
			else
				return [kv[0], kv[1].replace(/(\r\n)+/g, '\n').trim()]
		})
	)
	//console.debug('after normalizing newlines:', obj)
	return ret
}

const mime_mapper = {
	'image/png': { extension: '.png' },
	'image/jpeg': { extension: '.jpg' },
	'image/jpeg': { extension: '.jpeg' },
	'application/pdf': { extension: '.pdf' },
};

// handle existing files that stay or are deleted
// handle newly uploaded files
//
// uploaded files are managed as follows:
// * they stay in the uploaded directory as the hashes how they are created
// * the DB stores the hash and the filename specified by the user
// * if a file is removed from a form, its hash file is only deleted
//   if no other form in the DB refers to it (this happens by versioning)
// TODO the last is not yet implemented, currently hash files can stay as orphans
//
// upload is managed as follows:
// * each file is either an existing or a new file
// * existing files have fields
//   - <block>_TYPE = existing_file
//   - <block>_HASH = hash (file name on disk)
//   - <block>_FILENAME = filename (user-specified filename)
//   - <block>_MIMETYPE = mime type
// * existing files that are not sent back are considered deleted
// * newly uploaded files have fields
//   - <block>_TYPE = new_file
//   - <block>_FILE = multipart form data (user upload)
exports.interpret_file_formdata = (blocks, req_body, req_files, errors) => {
	const ret = blocks
		.filter(block => (block.type == 'IMAGE' && _.has(req_body, block.name)))
		.map(block => {
			let collected = []
			const existing_or_new = ensure_array(req_body[block.name]);
			let existing_idx = 0, new_idx = 0;
			for (let i = 0; i < existing_or_new.length; i++) {
				if (existing_or_new[i] == 'existing_file') {
					// no new file was uploaded, use body fields
					collected.push({
						filename: ensure_array(req_body[block.name + '_FILENAME'])[existing_idx],
						hash: ensure_array(req_body[block.name + '_HASH'])[existing_idx],
						mimetype: ensure_array(req_body[block.name + '_MIMETYPE'])[existing_idx]
					})
					existing_idx++;
				} else if (existing_or_new[i] == 'new_file') {
					//console.log('req_files for block %s is %s', block.name, req_files[block.name + '_FILE']);
					// new file was uploaded, use multer fields
					if (req_files[block.name + '_FILE'] != undefined && req_files[block.name + '_FILE'][new_idx] != undefined ) {
						const file = req_files[block.name + '_FILE'][new_idx]
						//console.log("handling file", file);
						if (!_.has(mime_mapper, file.mimetype)) {
							errors.push(`received file ${file.originalname} with unprocessable mime type ${file.mimetype} (can handle {${_.keys(mime_mapper).join(';')}})`);
						} else {
							collected.push({
								filename: file.originalname,
								hash: file.filename,
								mimetype: file.mimetype
							})
						}
						new_idx++;
					}
				} else {
					console.error("got invalid content for existing_or_new: %s", existing_or_new[i]);
				}
			}
			return [block.name, collected]
		})
	// check if files need to be deleted and delete them
	// TODO implement, for now we leave orphan files
	return ret;
}

exports.assemble_pdf = async (tmpdir, form, formvalue) => {
	// interpret `formvalue` as PDF replacements
	var replacements = {
		'VERSION': formvalue.version,
	}
	if (_.has(formvalue, 'based_on_version')) {
		replacements['BASED_ON_VERSION'] = formvalue['based_on_version'];
	}
	for(let block of form.form_blocks) {
		if (block.type == 'IMAGE' ) {
			if ( _.has(formvalue.blocks, block.name) ) {
				// we have at least one file of that block
				var replacement_parts = [];
				for(let file of formvalue.blocks[block.name]) {
					// copy to target dir and rename for replacement
					const mapinfo = mime_mapper[file.mimetype];
					const targetname = tmpdir.name + '/' + file.hash + mapinfo.extension;
					const tex_targetname = tmpdir.name + '/' + file.hash;
					fs.copyFileSync(config.upload_directory+'/'+file.hash, targetname);
					replacement_parts.push({ PATH: tex_targetname });
				}
				replacements[block.name] = replacement_parts;
			}
		} else if (block.type == 'TEXT' || block.type == 'TABLEROW') {
			if (_.has(formvalue.blocks, block.name)) {
				let content = formvalue.blocks[block.name];
				if (block.repeat == 'yes')  {
					if (Array.isArray(content)) {
						replacements[block.name] = content.map( (text) => ({ TEXT: text }) );
					} else {
						if (block.trim == true)
							content = content.trim();
						replacements[block.name] = [ { TEXT: content } ];
					}
				} else
					replacements[block.name] = content;
			}
		} else {
			console.log("block type "+block.type);
		}
	}
	//console.log("replacements", replacements);

	const texfile = tmpdir.name + '/' + form.tex_targetbase+'.tex';
	const textemplate = fs.readFileSync(form.tex_template, "utf8");
	fs.writeFileSync(texfile, mustache.render("{{=<% %>=}}"+textemplate, replacements), encoding='utf-8');

	let exitcode = undefined;
	for(var i in [1, 2]) {
		console.log(`building tex file ${texfile} (pass ${i})`);
		const child = child_process.spawn(config.pdflatexbinary, [ texfile ], { cwd: tmpdir.name, stdio: ['ignore', process.stderr, process.stderr ] });

		// wait for child in a non-blocking way
		child.on('exit', (code) => { exitcode = code; });
		while( exitcode === undefined ) await sleep(100);
		child.kill();
		console.log('pdflatex terminated with exit code '+exitcode);
		if (exitcode != 0)
			return ['failure', exitcode]
		exitcode = undefined;
	}
	const pdffile = tmpdir.name + '/' + form.tex_targetbase + '.pdf';
	return ['success', pdffile]
}

exports.get_all_image_hashes = (form_blocks, blocks) => {
	const image_formblock_names = form_blocks
		.filter( (fb) => fb.type == 'IMAGE' )
		.map( (fb) => fb.name );
	//console.log('get_all_image_hashes got formblock names '+image_formblock_names+' and blocks '+blocks)
	let oldimagehashes = [];
	for(const blockname of image_formblock_names) {
		if( _.has(blocks, blockname) ) {
			for(const imgobj of blocks[blockname]) {
				oldimagehashes.push(imgobj.hash);
			}
		}
	}
	//console.log('get_all_image_hashes returning '+oldimagehashes)
	return oldimagehashes;
}

exports.remove_pdf_if_not_in_db = async (db, pdflocation) => {
	if (pdflocation == undefined)
		return;
	const forms = await db.get('filledforms').value();
	for(const formkey in forms) {
		const form = forms[formkey]
		for(const version of form.versions) {
			//console.log('checking version '+version.version+' of form '+formkey)
			if( version.pdf != undefined && version.pdf.location == pdflocation ) {
				//console.log('found!')
				return;
			}
		}
	}
	// did not return -> remove
	console.log('removing '+pdflocation)
	fs.unlinkSync(pdflocation)
}

exports.remove_imagefile_if_not_in_db = async (db, imagehash) => {
	const forms = await db.get('filledforms').value();
	for(const formkey in forms) {
		const form = forms[formkey]
		for(const version of form.versions) {
			for(const block of _.values(version.blocks)) {
				const check = (blockobject) => blockobject.hash == imagehash;
				if( _.isArray(block) ) {
					if( _.some(block, check) ) return;
				} else {
					if( check(block) ) return;
				}
			}
		}
	}
	// did not return -> remove
	const full_image_path = config.upload_directory+'/'+imagehash
	console.log('removing unreferenced image file '+full_image_path)
	fs.unlinkSync(full_image_path)
}
