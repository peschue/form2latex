# form2latex

Tool for filling in forms and render their contents using LaTeX.

* Author: Peter Schüller
* License: MIT License
* Copyright (C) 2019-2023 Peter Schüller <contact@peterschueller.com>

# Form Content

There are 3 types of content blocks: TABLEROW TEXT IMAGE.
IMAGE can be PNG or PDF files.
IMAGE/TABLEROW is repeatable.
Each content block has a name.
Each TABLEROW/TEXT block has a predefined value (if repeatable multiple values).

Each content block can be filled with value(s) and is rendered in a LaTeX template.

# Latex Template

The latex template is a mustache template and contains the following placeholders
for form content:

* Builtin fields are non-repeatable TEXT blocks with name

  - VERSION
  - BASED_ON_VERSION

* Non-repeatable TEXT blocks can be rendered by

  `<% & <BLOCKNAME> %>`
  
* Non-repeatable TABLEROW blocks can be rendered by

  `<% & <BLOCKNAME> %> \\`

* Repeatable TABLEROW blocks can be rendered by

  ```
  <% #<BLOCKNAME> %>
  <% & TEXT %> \\
  <% /<BLOCKNAME> %>
  ```

* Non-repeatable IMAGE blocks can be rendered by

  `\includegraphics[height=17cm,width=24cm,keepaspectratio]{<% & <BLOCKNAME> %>}`

* Repeatable IMAGE blocks can be rendered by

  ```
  <% #<BLOCKNAME> %>
  \includegraphics[height=17cm,width=24cm,keepaspectratio]{<% & PATH %>}
  <% /<BLOCKNAME> %>
  ```

# Validation

Each block can have the "validate" property set to true, in that case only LaTeX characters that are safe to include, plus ampersands, are permitted.

If the property "validate_ampersands" is set to an integer value, only the specified number of ampersands is permitted in the field.

The message shown in case of violation can be specified in property "validate_message".