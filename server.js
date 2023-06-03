/*
 * form2latex - Main Source
 *
 * MIT License
 *
 * Copyright (c) 2019 Peter Schüller
 */
const _ = require("underscore");
const fs = require("fs");
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const mustache = require("mustache");
const low = require('lowdb');
const FileAsync = require('lowdb/adapters/FileAsync')

const hh = require('./helpers.js')
const config = hh.config
const { forms } = require(config.forms_spec);

const edit_form = require('./edit_form.js')
const form_selection = require('./formselection.js')
const form_action = require('./formaction.js')
const form_create = require('./form_create.js')

const preloaded = {
	login: fs.readFileSync("templates/login.mustache", "utf8"),
};

const auth = (req, res, next) => {
	if (!_.has(config, 'users')) {
		return next();
	} else {
		if (req.session && req.session.logged_in !== undefined)
			return next();
		else
			return res.redirect(config.prefix+'/login');
	}
};

//
// the login page
//
const app_login = (req, res) => {
	if (_.has(config, 'users')) {
		// we have some users configured -> login required
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
	} else {
		// no users -> no login required
		req.session.user = 'none';
		req.session.logged_in = true;
		res.redirect(config.prefix+'/');
	}
}

//
// the logout page
//
const app_logout = (req, res) => {
	req.session.destroy();
	res.redirect(config.prefix+'/');
}

// provide PDF of form (already built)
const provide_pdf = (db) => { return async (req, res) => {
	const formtype = req.params.formtype
	const form = forms[formtype]
	const formkey = req.params.formkey;
	let version = req.params.version;
	//console.log(`using formkey ${formkey} and version ${version}`)
	const pdfinfo = await db.get('filledforms').get(formkey).get('versions').nth(version-1).get('pdf').value()
	//console.log(`got pdf info ${pdfinfo} from DB`)
	const pdffile = pdfinfo.location
	const binarypdf = fs.readFileSync(pdffile);
	const pdfstat = fs.statSync(pdffile);
	res.setHeader('Content-Length', pdfstat.size);
	res.setHeader('Content-Type', 'application/pdf');
	res.setHeader('Content-Disposition', 'attachment; filename='+formkey+'_v'+version+'.pdf');
	res.send(binarypdf);
}}

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

console.log("prefix: ", config.prefix);

const lowdb_adapter = new FileAsync(config.lowdb_location);
low(lowdb_adapter)
	.then(db => {

		app.get(config.prefix + '/', auth, form_selection.handler(db));
		app.get(config.prefix + '/login', app_login);
		app.get(config.prefix + '/logout', app_logout);
		app.get(config.prefix + '/forms/:formtype/create', auth, form_create.handler(db));
		app.get(config.prefix + '/forms/:formtype/:formkey/:version/pdf', auth, provide_pdf(db));
		app.get(config.prefix + '/forms/:formtype/:formkey/:version/edit', auth, edit_form.handler(db));
		app.post(config.prefix + '/forms/:formkey/:version/action', auth, upload.fields(multer_fields), form_action.handler(db));

		return db.defaults({
				'filledforms': {},
			})
			.write()
	})
	.then(() => {
		app.listen(port, 'localhost', () => console.log(`listening on port ${port}!`))
	})
