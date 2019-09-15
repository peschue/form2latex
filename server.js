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
const child_process = require('child_process');
const low = require('lowdb');
const FileAsync = require('lowdb/adapters/FileAsync')

const configFile = process.env.CONFIG || "configs/config_local.json"
const config = JSON.parse(fs.readFileSync(configFile, "utf-8"));

const { forms } = require(config.forms_spec);

const preloaded = {
  formselection: fs.readFileSync("templates/formselection.mustache", "utf8"),
  form: fs.readFileSync("templates/form.mustache", "utf8"),
  login: fs.readFileSync("templates/login.mustache", "utf8"),
};

const common_substitutions = {
  commoncss: fs.readFileSync("templates/common.css", "utf8"),
  commonjs: fs.readFileSync("templates/common.js", "utf8"),
  prefix: config.prefix,
  site_title: config.site_title,
}

const auth = (req, res, next) => {
  if (req.session && req.session.logged_in !== undefined)
    return next();
  else
    return res.redirect(config.prefix+'/login');
};

const sleep = (ms) => {
  return new Promise(resolve=>{
    setTimeout(resolve,ms)
  })
}

//
// the login page
//
const app_login = (req, res) => {
    if (!req.query.user && !req.query.password) {
      console.log("displaying login page");
      res.contentType("html");
      res.status(200);
      res.send(mustache.render(preloaded.login, common_substitutions));
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
// the list of forms
//
const formselection = (db) => { return (req, res) => {
  try {
    const forms = db.get('filledforms').value();
    let substitutions = _.clone(common_substitutions);
    _.extend(substitutions, {
      commoncss: '',
      commonjs: '',
      newformtype: config.newformtype,
      forms: _.pairs(forms).map( (kv) => ({ formkey: kv[0], formtype: kv[1].formtype }) ),
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


//
// the form editing
//
const edit_form = (db) => { return (req, res) => {
  try {
    const formtype = req.params.formtype;
    const formkey = req.params.formkey;
    let formcontent = {};
    // TODO solve problems that happen when a form is not renamed from "new"
    if (formkey != 'new') {
      formcontent = db.get('filledforms').get(formkey).value();
      if (formtype != formcontent.formtype)
        throw "inconsistent form type!";
    }
    const formspec = forms[formtype];
    let substitutions = _.clone(common_substitutions);
    _.extend(substitutions, {
      formkey: formkey,
      formtype: formtype,
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

// we need this for forms, because single fields return single values
// but multiple fields return arrays and we always want to handle arrays
// (this simplifies the code)
const ensure_array = (thing) => _.flatten([thing]);

//
// the PDF assembly
//
const assemble = (db) => { return async (req, res) => {
  try {
    const originalformkey = req.body.originalformkey;
    const formtype = req.body.formtype;
    const form = forms[formtype];

    console.log("assemble for fields", _.keys(req.body).join(' '), "and files", _.keys(req.files).join(' '));

    console.log('req.body', req.body);
    console.log('req.files', req.files);

    // replace \r\n by \n
    // replace multiple \n by single \n
    req.body = _.object(
      _.pairs(req.body)
      .map( (kv) => {
        if (_.isArray(kv[1]))
          return [ kv[0], kv[1].map((v) => v.replace(/(\r\n)+/g, '\n')) ]
        else
          return [ kv[0], kv[1].replace(/(\r\n)+/g, '\n') ]
      })
    )
    console.log('revised req.body', req.body);

    //
    // interpret form data and store in `formvalue`
    //

    // form name = key
    const formkey = req.body.formkey;
    if (formkey == 'new')
      throw "cannot store name 'new'!";
    const originalexists = db.get('filledforms').has(originalformkey).value();
    const newexists = db.get('filledforms').has(formkey).value();
    console.log('originalexists', originalexists);
    if (newexists && formkey != originalformkey)
      throw "cannot store under existing name!";

    // form data that we get as field
    const form_blocks_nonfile = form.form_blocks
      .filter( block => (_.has(req.body, block.name) && block.type != 'IMAGE') )
      .map( block => {
        if (block.repeat == 'yes')
          // array as value (even if only one value)
          return [ block.name, ensure_array(req.body[block.name]) ]
        else
          // no array as value
          return [ block.name, req.body[block.name] ]
      });

    //
    // form data that we get as newly uploaded or existing file
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

    const mime_mapper = {
      'image/png': { extension: '.png' },
      'application/pdf': { extension: '.pdf' },
    };

    var errors = [];
    const form_blocks_file = form.form_blocks
      .filter( block => (block.type == 'IMAGE' && _.has(req.body, block.name) ) )
      .map( block => {
        let collected = []        
        const existing_or_new = ensure_array(req.body[block.name]);
        let existing_idx = 0, new_idx = 0;
        for(let i=0; i < existing_or_new.length; i++) {
          if (existing_or_new[i] == 'existing_file') {
            // no new file was uploaded, use body fields
            collected.push({
              filename: ensure_array(req.body[block.name+'_FILENAME'])[existing_idx],
              hash: ensure_array(req.body[block.name+'_HASH'])[existing_idx],
              mimetype: ensure_array(req.body[block.name+'_MIMETYPE'])[existing_idx]
              })
            existing_idx++;
          } else if (existing_or_new[i] == 'new_file') {
            // new file was uploaded, use multer fields
            const file = req.files[block.name+'_FILE'][new_idx]
            console.log("handling file",file);            
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
          } else {
            console.error("got invalid content for existing_or_new: %s", existing_or_new[i]);
          }
        }
        return [ block.name, collected ]
      })

    if (errors.length > 0) {
      const msg = "errors interpreting form data: "+errors.join('\n');
      res.status(200);
      res.send(msg);
      res.end();
      throw msg;
    }
  
    // check if files need to be deleted and delete them
    // TODO implement, for now we leave orphan files

    const formvalue = {
      formtype: formtype,
      blocks: _.object(form_blocks_nonfile.concat(form_blocks_file))
    }
    console.log('formvalue', formvalue);

    //
    // save `formvalue` to DB
    //

    if (!originalexists || formkey == originalformkey) {
      // update by setting again
      console.info('storing under key',formkey)
      await db.get('filledforms').set(formkey, formvalue).write()
    } else {
      // delete old and insert new
      console.info('deleting key',originalformkey,'and storing key',formkey)
      await db.get('filledforms').remove(originalformkey).set(formkey, formvalue).write()
    }

    //
    // assemble PDF
    //

    const tmpdir = tempfile.dirSync({ dir: config.temp_dir_location, unsafeCleanup: true });
    console.log("created temporary directory for assemble: "+tmpdir.name);

    // interpret `formvalue` as PDF replacements
    var replacements = {};
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
          const content = formvalue.blocks[block.name];
					if (block.repeat == 'yes')  {
            if (Array.isArray(content)) {
              replacements[block.name] = content.map( (text) => ({ TEXT: text }) );
            } else {
              replacements[block.name] = [ { TEXT: content } ];
            }
          } else
						replacements[block.name] = content;
				}
      } else {
        console.log("block type "+block.type);
      }
    }

    console.log("replacements", replacements);

    const texfile = tmpdir.name + '/' + form.tex_targetbase+'.tex';
    const textemplate = fs.readFileSync(form.tex_template, "utf8");
    fs.writeFileSync(texfile, mustache.render("{{=<% %>=}}"+textemplate, replacements), encoding='utf-8');

    for(var i in [1, 2]) {
      console.log(`building tex file ${texfile} (pass ${i})`);
      const child = child_process.spawn(config.pdflatexbinary, [ texfile ], { cwd: tmpdir.name, stdio: ['ignore', process.stderr, process.stderr ] });

      // wait for child in a non-blocking way
      let exitcode = undefined;
      child.on('exit', (code) => { exitcode = code; });
      while( exitcode === undefined ) await sleep(100);
      child.kill();
      console.log('pdflatex terminated with exit code '+exitcode);
    }

    const pdffile = tmpdir.name + '/' + form.tex_targetbase + '.pdf';
    const binarypdf = fs.readFileSync(pdffile);
    const pdfstat = fs.statSync(pdffile);

    console.log("removing temporary directory "+tmpdir.name);
    tmpdir.removeCallback();

    res.status(200);
    res.setHeader('Content-Length', pdfstat.size);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename='+form.pdf_send_filename);
    res.send(binarypdf);
    res.end();
  } catch(err) {
    console.error('exception in assemble:', err);
  }
}}

const all_formspec_image_blocks = _.flatten(
  _.values(forms)
  .map( (formspec) =>
        formspec.form_blocks.filter( block => block.type == 'IMAGE' ) )
);
const multer_fields = all_formspec_image_blocks
  .map( block => ({ name: block.name+"_FILE", maxCount: config.max_upload_per_field }) );
console.log("multer_fields: ",multer_fields);

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

  app.get(config.prefix+'/login', app_login);
  app.get(config.prefix+'/logout', app_logout);
  app.get(config.prefix+'/', auth, formselection(db));
  app.get(config.prefix+'/editform/:formtype/:formkey', auth, edit_form(db));
  app.post(config.prefix+'/assemble', auth, upload.fields(multer_fields), assemble(db));

  return db.defaults({
      'filledforms': {},
    })
    .write()
})
.then(() => {
  app.listen(port, 'localhost', () => console.log(`listening on port ${port}!`))
})
