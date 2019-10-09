const forms = {
  'FormType1': {
    tex_template: 'templates/sample.mustache.tex',
    tex_targetbase: 'type1',
    htmlcomment: 'comment to form type',
    form_blocks: [
      {
        name: 'TESTTITLE',
        type: 'TEXT',
        repat: 'no',
        rows: 1,
        cols: 40,
        defaultvalue: 'Test Title',
        htmlcomment: 'This is an explanation for the <i>very important</i> field!'
      },
      {
        name: 'TESTTABLEROW',
        type: 'TABLEROW',
        repeat: 'yes',
        cols: 40,
        defaultvalue: [ 'foo & bar', 'bar & baz' ],
      },
      {
        name: 'TESTIMAGE',
        type: 'IMAGE',
        repeat: 'yes',
        defaultvalue: [],
        htmlcomment: 'This is just an image, or more than one.'
      },
    ],
  },
}

exports.forms = forms;
