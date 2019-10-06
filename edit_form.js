/*
 * form2latex - Form Editing Module
 *
 * MIT License
 *
 * Copyright (c) 2019 Peter Schüller
 */
const _ = require("underscore")
const fs = require("fs");
const mustache = require("mustache")

const hh = require("./helpers.js")
const config = hh.config
const { forms } = require(config.forms_spec);

const preloaded = {
	form: fs.readFileSync("templates/form.mustache", "utf8"),
}

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


//
// the list of forms
//
exports.handler = (db) => { return (req, res) => {
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
		hasPDF = _.has(formcontent,"pdf")
		if (hasPDF)
			pdflink = `${config.prefix}/forms/${formtype}/${formkey}/${version}/pdf`
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
			basedOnVersion: formcontent.based_on_version,
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

