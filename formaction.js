/*
 * form2latex - Form Action Module
 *
 * MIT License
 *
 * Copyright (c) 2019 Peter Schüller
 */
const _ = require("underscore")
const fs = require("fs");
const tempfile = require('tmp');

const hh = require("./helpers.js")
const config = hh.config

//
// entry point to form actions
//
exports.handler = (db) => { return async (req, res) => {
	try {
		console.log('req.body',req.body)
		if (_.has(req.body, 'save_and_assemble')) {
			return await save_and_create_pdf(db, req, res);
		} else if (_.has(req.body, 'finalize_version')) {
			return await finalize_version(db, req, res)
		} else if (_.has(req.body, 'delete_draft')) {
			return await delete_draft(db, req, res)
		} else if (_.has(req.body, 'draft_from_this')) {
			return await draft_from_this(db, req, res)
		}
	} catch(except) {
		const msg = "exception during form action: "+new Date()+'\n\n'+except;
		console.error(msg);
		res.status(500);
		res.end(msg);
	}
}}

// saving and creating a PDF
const save_and_create_pdf = async (db, req, res) => {
	const formkey = req.params.formkey;
	let version = req.params.version;
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
			version = latestversion+1
			formvalue.versions.append({
				version: version,
				final:false,
				blocks: newblocks,
				pdf: undefined,
			});
		} else {
			// overwrite draft version
			version = latestversion
			formvalue.versions[version-1].blocks = newblocks;
			formvalue.versions[version-1].pdf = undefined; // remove PDF! (we set it again if it was built successfully)
		}
	} else {
		// create completely new record
		version = 1
		formvalue = {
			formtype: formtype,
			versions: [
				{
					version: version,
					final: false,
					blocks: newblocks,
					pdf: undefined,
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
	const result = await hh.assemble_pdf(tmpdir, form, formvalue)
	// if it was successful, save PDF to non-temp location and store link in DB
	let successmessage = undefined
	if (result[0] == 'success') {
		const pdffile = result[1];
		// move to target location
		const pdffinallocation = tempfile.tmpNameSync({ dir: config.built_pdf_location, template: 'builtpdfXXXXXX' })
		console.log("copying PDF to final locaiton "+pdffinallocation);
		fs.copyFileSync(pdffile, pdffinallocation);
		console.log("removing temporary directory "+tmpdir.name);
		tmpdir.removeCallback();

		console.log("storing to DB again");
		formvalue.versions[version-1].pdf = { location: pdffinallocation }
		await db.get('filledforms').set(newformkey, formvalue).write()

		successmessage = 'was successful'
	} else {
		successmessage = 'failed ('+result[1]+')'
	}
	// send reply
	res.status(200)
		.send("<html>PDF build "+successmessage+` <a href="${config.prefix}/forms/${formtype}/${newformkey}/${version}/edit">back</a></html>`) // TODO use a proper template here
		.end()
}

const get_formvalue_throw_if_form_key_or_version_bad = (db, formkey, version) => {
	if (!db.get('filledforms').has(formkey).value())
		throw "invalid form key "+formkey
	const formvalue = db.get('filledforms').get(formkey).value()
	if (formvalue.versions.length < version)
		throw "invalid version "+version+" of form key "+formkey
	return formvalue
}

const finalize_version = async (db, req, res) => {
	const formkey = req.params.formkey
	const version = req.params.version
	const formvalue = get_formvalue_throw_if_form_key_or_version_bad(db, formkey, version)

	if (formvalue.versions[version-1].final)
		throw "version "+version+" of form key "+formkey+" is already final"
	if (!_.has(formvalue.versions[version-1], 'pdf'))
		throw "version "+version+" of form key "+formkey+" has no PDF -> cannot be made final"

	// set final
	await db.get('filledforms').get(formkey).get('versions').nth(version-1).set('final',true).write()
	res.redirect(config.prefix);
	res.end()
}

const delete_draft = async (db, req, res) => {
	const formkey = req.params.formkey
	const version = req.params.version
	const formvalue = get_formvalue_throw_if_form_key_or_version_bad(db, formkey, version)

	if (formvalue.versions[version-1].final)
		throw "version "+version+" of form key "+formkey+" is final and cannot be deleted"
	if (version == 1) {
		// delete whole formkey
		const ret = await db.get('filledforms').unset(formkey).write()
	} else {
		// delete only the one version
		const ret = await db.get('filledforms').get(formkey).get('versions').pullAt(version-1).write()
	}
	res.redirect(config.prefix);
	res.end()
}

const draft_from_this = async (db, req, res) => {
	const formkey = req.params.formkey
	const version = req.params.version

	const formvalue = get_formvalue_throw_if_form_key_or_version_bad(db, formkey, version)

	if (!formvalue.versions[version-1].final)
		throw "version "+version+" of form key "+formkey+" is not final, cannot create draft from draft"
	if (!formvalue.versions[formvalue.versions.length-1].final)
		throw "version "+(formvalue.versions.length-1)+" of form key "+formkey+" is a draft, cannot create a second draft"

	let newversion = JSON.parse(JSON.stringify(formvalue.versions[version-1]))
	newversion.version = formvalue.versions.length+1
	newversion.final = false
	newversion.based_on_version = version;

	// append version
	await db.get('filledforms').get(formkey).get('versions').push(newversion).write()
	res.redirect(config.prefix);
	res.end()
}