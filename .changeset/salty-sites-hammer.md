---
"sh-analysis": patch
---

Include commands from case-arm subtrees, detect tilde expansion in assignment-shaped arguments, and report locale uncertainty for non-ASCII ANSI-C Unicode escapes.

Honor Bash quoting within tilde prefixes in assignment-shaped command arguments and report possible Zsh tilde expansion in assignment values with quoted delimiters. Preserve wrapper command resolution when an assignment is known to occupy one field. Report glob uncertainty for possible Zsh pattern groups and qualifiers when filename generation is possible.
