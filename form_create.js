/*
 * form2latex - Create Form Module
 *
 * MIT License
 *
 * Copyright (c) 2019 Peter Schüller
 */
const _ = require("underscore")

const hh = require("./helpers.js")
const config = hh.config
const { forms } = require(config.forms_spec);

exports.handler = (db) => { return async (req, res) => {
	const formtype = req.params.formtype
	const form = forms[formtype]
	const newname = req.query.name
	console.log(`creating new form of type ${formtype} with name ${newname}`)
	const allforms = await db.get('filledforms').value()
	if (_.has(allforms, newname)) {
		// TODO create common error method with link to start in hh
		res.send("Error: name already exists!").send().end()
	} else {
		// create completely new record
		const defaultblocks = _.object(
			form.form_blocks
				.filter( (v) => v.type == 'TABLEROW' || v.type == 'TEXT' )
				.map( (v) => [v.name, v.defaultvalue] ))
		const formvalue = {
			formtype: formtype,
			versions: [
				{
					version: 1,
					final: false,
					blocks: defaultblocks,
					pdf: undefined,
				}
			]
		}
		await db.get('filledforms').set(newname, formvalue).write()
		res.redirect(config.prefix+'/')
		res.end()
	}
}}
