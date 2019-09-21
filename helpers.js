
// replace \r\n by \n
// replace multiple \n by single \n
exports.normalize_newlines = (obj) => {
	const ret = _.object(
		_.pairs(obj)
		.map((kv) => {
			if (_.isArray(kv[1]))
				return [kv[0], kv[1].map((v) => v.replace(/(\r\n)+/g, '\n'))]
			else
				return [kv[0], kv[1].replace(/(\r\n)+/g, '\n')]
		})
	)
	console.debug('after normalizing newlines:', obj)
	return ret
}

// handle existing files that stay or are deleted
// handle newly uploaded files
exports.interpret_file_formdata = (blocks, req_body, req_files, mime_mapper, errors) => {
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
					// new file was uploaded, use multer fields
					const file = req_files[block.name + '_FILE'][new_idx]
					console.log("handling file", file);
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
			return [block.name, collected]
		})
	return ret;
}
