---
"sh-analysis": patch
---

Include commands from case-arm subtrees, detect tilde expansion in assignment-shaped arguments, and report locale uncertainty for non-ASCII ANSI-C Unicode escapes.

Honor Bash quoting within tilde prefixes in assignment-shaped command arguments and report possible Zsh tilde expansion in assignment values with quoted delimiters. Preserve wrapper command resolution when an assignment is known to occupy one field, and report uncertainty for operands that can undergo Zsh glob qualification.
