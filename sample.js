const forms = {
  'FormType1': {
    tex_template: 'templates/sample.mustache.tex',
    tex_targetbase: 'type1',
    htmlcomment: 'comment to form type',
    form_blocks: [
      {
        name: 'TESTTITLE',
        type: 'TEXT',
        repeat: 'no',
        rows: 1,
        cols: 80,
        defaultvalue: 'Test Title where no special text can be entered',
        htmlcomment: 'This is an explanation for the <i>very important</i> field!',
        validate: true,
        validate_message: 'Please use only Characters that are safe for LaTeX: a-zA-Z0-9!"#\'()+,./:;<=>?|-'
      },
      {
        name: 'TESTTEXT',
        type: 'TEXT',
        repeat: 'no',
        rows: 4,
        cols: 80,
        defaultvalue: 'Test Text where you can also enter \\LaTeX commands',
        htmlcomment: 'Field without validation is useful for people who know what they are doing',
      },
      {
        name: 'TESTTABLEROW',
        type: 'TABLEROW',
        repeat: 'yes',
        cols: 40,
        defaultvalue: [ 'foo & bar', 'bar & baz' ],
        validate: true,
        validate_ampersands: 1,
        validate_message: 'Please use only Characters that are safe for LaTeX: a-zA-Z0-9!"#\'()+,./:;<=>?|- and make sure to include a single ampersand (&).'
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
