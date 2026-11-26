---
"sh-analysis": minor
---

Function contexts now expose a names array in declaration order. Replace reads of frame.name with frame.names. Anonymous functions have an empty array.
