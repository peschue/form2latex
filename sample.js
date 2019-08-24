const forms = {
  'FormType1': {
    tex_template: 'templates/sample.mustache.tex',
    tex_targetbase: 'type1',
    pdf_send_filename: 'TYPE1.pdf',
    form_blocks: [
      {
        name: 'TESTTITLE',
        type: 'TEXT',
        repat: 'no',
        rows: 1,
        cols: 40,
        defaultvalue: 'Test Title',
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
      },
    ],
  },
}

exports.forms = forms;
