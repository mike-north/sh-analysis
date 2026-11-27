---
"sh-analysis": patch
---

Include commands from case-arm subtrees, detect tilde expansion in assignment-shaped arguments, and report locale uncertainty for non-ASCII ANSI-C Unicode escapes.

Honor Bash quoting within tilde prefixes in assignment-shaped command arguments. Report possible Zsh tilde expansion in assignment values after a backslash-escaped colon or before a quoted or escaped slash. Preserve wrapper command resolution when an assignment is known to occupy one field. Report glob uncertainty for possible Zsh pattern groups and qualifiers when filename generation is possible.

Report uncertainty for detached word literals whose backslash escapes depend on their enclosing syntax. Pass `context` for a known command argument or assignment value to resolve its escapes. The `filenameGeneration` option controls only literal glob detection.
