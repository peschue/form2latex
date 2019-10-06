/*
 * form2latex - Form Selection Module
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

const preloaded = {
  formselection: fs.readFileSync("templates/formselection.mustache", "utf8"),
}

//
// the list of forms
//
exports.handler = (db) => { return (req, res) => {
  try {
    const forms = db.get('filledforms').value();
    let substitutions = _.clone(hh.common_substitutions);
    _.extend(substitutions, {
      commoncss: '',
      commonjs: '',
      newformtype: config.newformtype,
			forms: _.pairs(forms)
				.map( (kv) => ({
					formkey: kv[0],
					formtype: kv[1].formtype,
					versions: kv[1].versions.map( (v) => ({
						version: v.version,
						isDraft: !v.final
					}) )
				}) ),
    });
    //console.log(substitutions.forms);
    res.contentType("html");
    res.status(200);
    res.send(mustache.render(preloaded.formselection, substitutions));
  } catch (except) {
    const msg = "an unknown error occurred at "+new Date();
    console.error(msg);
    console.error(except+' '+except.stack);
    res.status(500);
    res.end(msg);
  }
}}