/*
 * form2latex - Form Editing Module
 *
 * MIT License
 *
 * Copyright (c) 2019-2023 Peter Schüller
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

// text input
const render_text_input = (block) => {
	const extra_class = block.validate === true ? ' validate' : '';
	return `
	<div class="onevaluecontainer">
	<textarea
		class="disable_for_readonly${extra_class}" name="${block.name}"
		rows="${block.rows}" cols="${block.cols}"
		validate_ampersands="${block.validate_ampersands}">
	${block.value}
	</textarea><p class="warning_message hidden">${block.validate_message}</p>
	</div>
	`;
};

// tablerow
const render_tablerow_general = (block, trclass, value) => {
	const extra_class = block.validate === true ? ' validate' : '';
	return `
	<tr class="${trclass} onevaluecontainer">
		<td><textarea
			class="disable_for_readonly${extra_class}" name="${block.name}"
			rows="1" cols="${block.cols}"
			validate_ampersands="${block.validate_ampersands}">${value}</textarea></td>
		<td><input class="disable_for_readonly delete" type="button" value="-" /></td>
		<td><input class="more disable_for_readonly" fieldname="${block.name}" type="button" value="+" /></td>
		<td><p class="warning_message hidden">${block.validate_message}</p></td>
	</tr>
	`;
};

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
		<input class="disable_for_readonly more" fieldname="${block.name}" type="button" value="+" />
	</td>
	</tr>
	`;
const render_existing_image = (block, value) => `
	<tr class="onevaluecontainer">
	<td>
		<input class="disable_for_readonly" type="hidden" name="${block.name}" value="existing_file" />
		<input type="hidden" name="${block.name}_HASH" value="${value.hash}" />
		<input type="hidden" name="${block.name}_FILENAME" value="${value.filename}" />
		<input type="hidden" name="${block.name}_MIMETYPE" value="${value.mimetype}" />
		File "${value.filename}"
	</td>
	<td>
		<input class="disable_for_readonly delete" type="button" value="-" />
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
	// TODO use mustache for these templates

	// extend with HTML
	switch (block.type) {
		case 'TEXT':
			block.template = '';
			block.control = render_text_input(block);
			break;
		case 'TABLEROW':
			if (block.repeat == 'yes') {
				block.template = render_template_tablerow(block);
				let values = block.value;
				if (values == undefined)
					values = [];
				if (values.length == 0)
					// add an empty one (so that we have at least one)
					values.push('');
				block.control =
					'<table border="0">' +
					values.map((val) => render_existing_tablerow(block, val)).join('\n') +
					'</table>';
			} else {
				block.template = '';
				// TODO render_single_tablerow
				block.control = `<textarea class="disable_for_readonly" name="${block.name}" rows="1" cols="${block.cols}">\n${block.value}\n</textarea>`;
			}
			break;
		case 'IMAGE':
			if (block.repeat == 'yes') {
				block.template = render_template_image(block);
				let values = block.value;
				if (values == undefined)
					values = [];
				block.control =
					'<table border="0">' +
					values.map((val) => render_existing_image(block, val)).join('\n') +
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
}
}

// edit one form
exports.handler = (db) => { return (req, res) => {
	try {
		const formtype = req.params.formtype;
		const formkey = req.params.formkey;
		const version = req.params.version;
		let isDraft = undefined;
		let hasPDF = false;
		let pdflink = undefined;
		let formcontent = {};

		const formcontainer = db.get('filledforms').get(formkey).value();
		if (formtype != formcontainer.formtype)
			throw "inconsistent form type!";

		// address the specified version (1-based version)
		formcontent = formcontainer.versions[version - 1]
		// crosscheck
		if (formcontent.version != version)
			throw `versions must be sorted in correct order in json! got mismatch for version ${version} and formcontent.version ${formcontent.version}!`

		// check if the used version is a draft version
		isDraft = !formcontent.final
		hasPDF = _.has(formcontent, "pdf") && formcontent['pdf'] != undefined
		if (hasPDF)
			pdflink = `${config.prefix}/forms/${formtype}/${formkey}/${version}/pdf`

		const formspec = forms[formtype];
		let substitutions = _.clone(hh.common_substitutions);
		_.extend(substitutions, {
			formkey: formkey,
			formtype: formtype,
			formhtmlcomment: formspec.htmlcomment,
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
		const msg = "an unknown error occurred at " + new Date();
		console.error(msg);
		console.error(except + ' ' + except.stack);
		res.status(500);
		res.end(msg);
	}
}}
