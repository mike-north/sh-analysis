---
"sh-analysis": patch
---

Analyse very long flat arithmetic expressions, test conditions and `elif` chains without exhausting the call stack. `enumerateCommands` previously threw a `RangeError` on an arithmetic expression, `[[ ... ]]` condition or subscript with several thousand terms; it now reports the commands and uncertainties inside it like any other, and the result and its order are unchanged.
