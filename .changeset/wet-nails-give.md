---
"sh-analysis": minor
---

**Breaking API change.** Function context frames expose `names` in place of `name`. Replace reads of `frame.name` with `frame.names`. Read the first entry when you expect a single declared name, or check every entry when matching a name. The array preserves declaration order and is empty for anonymous functions.
