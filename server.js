/*
 * form2latex - Main Source
 *
 * MIT License
 *
 * Copyright (c) 2019 Peter Schüller
 */
const _ = require("underscore");
const util = require('util');
const fs = require("fs");
const tempfile = require('tmp');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const mustache = require("mustache");
const low = require('lowdb');
const FileAsync = require('lowdb/adapters/FileAsync')

const hh = require('./helpers.js')
const config = hh.config
const formselection = require('./formselection.js')

const { forms } = require(config.forms_spec);

const preloaded = {
  form: fs.readFileSync("templates/form.mustache", "utf8"),
  login: fs.readFileSync("templates/login.mustache", "utf8"),
};

const auth = (req, res, next) => {
  if (req.session && req.session.logged_in !== undefined)
    return next();
  else
    return res.redirect(config.prefix+'/login');
};

//
// the login page
//
const app_login = (req, res) => {
    if (!req.query.user && !req.query.password) {
      console.log("displaying login page");
      res.contentType("html");
      res.status(200);
      res.send(mustache.render(preloaded.login, hh.common_substitutions));
    } else if (_.has(config.users, req.query.user) &&
               req.query.password === config.users[req.query.user]) {
      console.log("login of "+req.query.user+" successful");
      req.session.user = req.query.user;
      req.session.logged_in = true;
      res.redirect(config.prefix+'/');
    } else {
      console.warn("login failed");
      res.send('Login failed');
    }
}

//
// the logout page
//
const app_logout = (req, res) => {
  req.session.destroy();
  res.redirect(config.prefix+'/');
}

//
// the form editing
//
const edit_form = (db) => { return (req, res) => {
  try {
    const formtype = req.params.formtype;
    const formkey = req.params.formkey;
    let version = undefined;
    let isDraft = undefined;
    let hasPDF = false;
    let pdflink = undefined;
    let formcontent = {};
    // TODO solve problems that happen when a form is not renamed from "new"
    if (formkey != 'new') {
      const formcontainer = db.get('filledforms').get(formkey).value();
      if (formtype != formcontainer.formtype)
        throw "inconsistent form type!";
      // if a version is specified, try to use that version
      if (req.params.version != undefined) {
        // make sure that version exists
        // versions are 1-based
        if ( (req.params.version > 0) && 
             (req.params.version <= formcontainer.versions.length) ) {
          version = req.params.version
        }
      }
      if (version == undefined) {
        // address the latest version
        version = formcontainer.versions.length
      }
      // address the specified version (1-based version)
      formcontent = formcontainer.versions[version-1]
      // crosscheck
      if (formcontent.version != version)
        throw `versions must be sorted in correct order in json! got mismatch for version ${version} and formcontent.version ${formcontent.version}!`
      // check if the used version is a draft version
      isDraft = !formcontent.final
      hasPDF = _.has(formcontent,"pdffile")
      if (hasPDF)
        pdflink = formcontent.pdffile
		} else {
			// new versions start at 1 and are drafts
			version = 1
			isDraft = true
		}

    const formspec = forms[formtype];
    let substitutions = _.clone(hh.common_substitutions);
    _.extend(substitutions, {
      formkey: formkey,
      formtype: formtype,
      version: version,
      isDraft: isDraft,
      hasPDF: hasPDF,
      pdflink: pdflink,
      blocks: formspec.form_blocks.map(augment_block(formcontent))
    });
    res.contentType("html");
    res.status(200);
    res.send(mustache.render(preloaded.form, substitutions));
  } catch (except) {
    const msg = "an unknown error occurred at "+new Date();
    console.error(msg);
    console.error(except+' '+except.stack);
    res.status(500);
    res.end(msg);
  }
}}

// tablerow
const render_tablerow_general = (block, trclass, value) => `
  <tr class='${trclass}'>
		<td><textarea name="${block.name}" rows="1" cols="${block.cols}">${value}</textarea></td>
		<td><input class="more" fieldname="${block.name}" type="button" value="+" /></td>
	</tr>
`;
const render_template_tablerow = (block) => `
	<table class="template" id="template-${block.name}">
		${render_tablerow_general(block, 'tocopy onevaluecontainer', '')}
	</table>
`;
const render_existing_tablerow = (block, value) => render_tablerow_general(block, 'onevaluecontainer', value);

// image
const render_add_image = (block) => `
  <tr class="onevaluecontainer">
    <td>
      <input class="more" fieldname="${block.name}" type="button" value="+" />
    </td>
  </tr>
  `;
const render_existing_image = (block, value) => `
  <tr class="onevaluecontainer">
    <td>
      <input type="hidden" name="${block.name}" value="existing_file" />
      <input type="hidden" name="${block.name}_HASH" value="${value.hash}" />
      <input type="hidden" name="${block.name}_FILENAME" value="${value.filename}" />
      <input type="hidden" name="${block.name}_MIMETYPE" value="${value.mimetype}" />
      File "${value.filename}"
    </td>
    <td>
      <input class="delete" type="button" value="-" />
    </td>
  </tr>
  `;
const render_template_image = (block) => `
	<table class="template" id="template-${block.name}">
    <tr class="tocopy onevaluecontainer">
      <td>
        <input type="hidden" name="${block.name}" value="new_file" />
        <input type="file" name="${block.name}_FILE" />
      </td>
      <td>
        <input class="delete" type="button" value="-" />
        <input class="more" fieldname="${block.name}" type="button" value="+" />
      </td>
    </tr>
	</table>
  `;

const augment_block = (formcontent) => { return (block) => {
  // deep copy
  let ret = JSON.parse(JSON.stringify(block));

  if (_.has(formcontent.blocks, block.name)) {
    // extend with formcontent
    block.value = formcontent.blocks[block.name];
  } else if (_.has(block, 'defaultvalue')) {
    // use default value(s)
    block.value = block.defaultvalue
  }
  // TODO manage missing default value if not image (we want defaults for all but not for images)

  // extend with HTML
  switch(block.type) {
  case 'TEXT':
		block.template = '';
    block.control = `<textarea name="${block.name}" rows="${block.rows}" cols="${block.cols}">\n${block.value}\n</textarea>`;
    break;
  case 'TABLEROW':
    if (block.repeat == 'yes') {
      block.template = render_template_tablerow(block);
      let values = block.value;
      if (values.length == 0)
        // add an empty one (so that we have at least one)
        values.push('');
      block.control = 
        '<table border="0">'+
        values.map( (val) => render_existing_tablerow(block, val) ).join('\n') +
				'</table>';
    } else {
			block.template = '';
      // TODO render_single_tablerow
      block.control = `<textarea name="${block.name}" rows="1" cols="${block.cols}">\n${block.value}\n</textarea>`;
    }
    break;
  case 'IMAGE':
    if (block.repeat == 'yes') {
			block.template = render_template_image(block);
      block.control = 
        '<table border="0">' +
        block.value.map( (val) => render_existing_image(block, val) ).join('\n') +
        render_add_image(block) +
        '</table>';
    } else {
      // TODO render single image upload
      console.error("not implemented: nonrepeated IMAGE")
			//block.template = '';
      //block.control = `<input name="${block.name}" type="file">`;
    }
    break;
  default:
		block.template = 'TODO';
    block.control = "TODO";
    break;
  }
  return block;
}}

const form_action = (db) => { return async (req, res) => {
  try {
		console.log('req.body',req.body)
		if (_.has(req.body, 'save_and_assemble')) {
			return await save_and_create_pdf(db, req, res);
		} else if (_.has(req.body, 'finalize_version')) {
			// TODO implement
			res.redirect(req.headers.referer)
		} else if (_.has(req.body, 'delete_draft')) {
			return await delete_draft(db, req, res)
		} else if (_.has(req.body, 'draft_from_this')) {
			// TODO implement
			res.redirect(req.headers.referer)
		}
  } catch(except) {
    const msg = "exception during form action: "+new Date()+except+' '+except.stack;
    console.error(msg);
    res.status(500);
    res.end(msg);
  }
}}

//
// saving and creating a PDF
//
const save_and_create_pdf = async (db, req, res) => {
	const formkey = req.params.formkey;
	const version = req.params.version; // TODO use version below
	const formtype = req.body.formtype;
	const form = forms[formtype];

	console.log("assemble for fields", _.keys(req.body).join(' '), "and files", _.keys(req.files).join(' '));
	console.debug('req.body', req.body);
	console.debug('req.files', req.files);
	req.body = hh.normalize_newlines(req.body)

	//
	// interpret form data and store in `formvalue`
	//

	// checkout if we rename into an existing name
	const newformkey = req.body.formkey;
	if (newformkey == 'new')
		throw "cannot store name 'new'!";
	const originalexists = db.get('filledforms').has(formkey).value();
	const newexists = db.get('filledforms').has(newformkey).value();
	console.log('originalexists', originalexists);
	if (newexists && formkey != newformkey)
		throw "cannot store under existing name!";
		
	// form data that we get as field
	const form_blocks_nonfile = form.form_blocks
		.filter( block => (_.has(req.body, block.name) && block.type != 'IMAGE') )
		.map( block => {
			if (block.repeat == 'yes')
				// array as value (even if only one value)
				return [ block.name, hh.ensure_array(req.body[block.name]) ]
			else
				// no array as value
				return [ block.name, req.body[block.name] ]
		});

	// form data that we get as newly uploaded or existing file
	var errors = [];
	const form_blocks_file = hh.interpret_file_formdata(
		form.form_blocks, req.body, req.files, errors);
	if (errors.length > 0)
		throw "errors interpreting form data: "+errors.join('\n');

	// get everything from db and insert/overwrite draft version
	let formvalue = undefined;
	const newblocks = _.object(form_blocks_nonfile.concat(form_blocks_file));
	if (originalexists) {
		// overwrite draft version / insert draft version
		formvalue = db.get('filledforms').get(formkey).value();
		const latestversion = formvalue.versions.length
		if (formvalue.versions[latestversion-1].final) {
			// new draft version
			formvalue.versions.append({
				version: latestversion+1,
				final:false,
				blocks: newblocks
			});
		} else {
			// overwrite draft version
			formvalue.versions[latestversion-1].blocks = newblocks;
		}
	} else {
		// create completely new record
		formvalue = {
			formtype: formtype,
			versions: [
				{
					version: 1,
					final: false,
					blocks: newblocks
				}
			]
		};
	}
	console.log('formvalue', formvalue);

	// save `formvalue` to DB
	if (!originalexists || formkey == newformkey) {
		// update by setting again
		console.info('storing under key',newformkey)
		await db.get('filledforms').set(newformkey, formvalue).write()
	} else {
		// delete old and insert new
		console.info('deleting key',formkey,'and storing key',newformkey)
		await db.get('filledforms').unset(formkey).set(newformkey, formvalue).write()
	}

	// assemble PDF
	const tmpdir = tempfile.dirSync({ dir: config.temp_dir_location, unsafeCleanup: true })
	console.log("created temporary directory for assemble: "+tmpdir.name)
	// do it
	const pdffile = await hh.assemble_pdf(tmpdir, form, formvalue)
	const binarypdf = fs.readFileSync(pdffile);
	const pdfstat = fs.statSync(pdffile);
	console.log("removing temporary directory "+tmpdir.name);
	tmpdir.removeCallback();

	// send reply
	res.status(200);
	res.setHeader('Content-Length', pdfstat.size);
	res.setHeader('Content-Type', 'application/pdf');
	res.setHeader('Content-Disposition', 'attachment; filename='+form.pdf_send_filename);
	res.send(binarypdf);
	res.end();
}

const delete_draft = async (db, req, res) => {
	const formkey = req.params.formkey
	const version = req.params.version

	if (!db.get('filledforms').has(formkey).value())
		throw "invalid form key "+formkey

	const formvalue = db.get('filledforms').get(formkey).value()
	if (formvalue.versions.length < version)
		throw "invalid version "+version+" of form key "+formkey
	if (formvalue.versions[version-1].final)
		throw "version "+version+" of form key "+formkey+" is final and cannot be deleted"
	if (version == 1) {
		// delete whole formkey
		console.log('deleting form key "'+formkey+'"')
		const ret = await db.get('filledforms').unset(formkey).write()
		console.log('deleted',ret)
	} else {
		// delete only the one version
		console.log('deleting version',version,'of form key',formkey)
		const ret = await db.get('filledforms').get(formkey).get('versions').pullAt(version-1).write()
		console.log('deleted',ret)
	}
	res.redirect(config.prefix);
	res.end()
}

const all_formspec_image_blocks = _.flatten(
	_.values(forms)
		.map((formspec) =>
			formspec.form_blocks.filter(block => block.type == 'IMAGE'))
);
const multer_fields = all_formspec_image_blocks
	.map(block => ({ name: block.name + "_FILE", maxCount: config.max_upload_per_field }));
console.log("multer_fields: ", multer_fields);

//
// start of application
//

const port = parseInt(process.env.PORT) || config.port;

const upload = multer({ dest: config.upload_directory });

const app = express();
app.use(session({
	secret: 's901234hkfds80',
	resave: true,
	saveUninitialized: true
}));

const lowdb_adapter = new FileAsync(config.lowdb_location);
low(lowdb_adapter)
	.then(db => {

		app.get(config.prefix + '/login', app_login);
		app.get(config.prefix + '/logout', app_logout);
		app.get(config.prefix + '/', auth, formselection.handler(config, db));
		app.get(config.prefix + '/forms/:formtype/:formkey/:version/edit', auth, edit_form(db));
		app.post(config.prefix + '/forms/:formkey/:version/action', auth, upload.fields(multer_fields), form_action(db));

		return db.defaults({
				'filledforms': {},
			})
			.write()
	})
	.then(() => {
		app.listen(port, 'localhost', () => console.log(`listening on port ${port}!`))
	})
