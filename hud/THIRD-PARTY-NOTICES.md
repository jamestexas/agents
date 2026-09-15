# Third-party notices — vendored bundles under `hud/ui/`

`hud/` itself is AGPL-3.0-only ([hud/LICENSE](LICENSE)). The two JavaScript
bundles below are not ours. They are vendored — checked in as pre-built files
rather than installed — because the HUD ships no `node_modules` and the browser
loads them from `/ui/` directly (`hud/ui/index.html`, `<script src>` tags).

Both are MIT, which is compatible with the AGPL: MIT code may be combined into
an AGPL work. Compatibility does not waive attribution. The MIT license requires
that the copyright notice and permission notice travel with the code, so they
are reproduced here in full and mirrored in each bundle's own header comment.

If you bump either bundle, update the version in this file in the same commit.
A version recorded here that does not match the file on disk is worse than no
record, because it is the thing a downstream reader will trust.

| Bundle | Version | License | Upstream |
| --- | --- | --- | --- |
| `hud/ui/marked.min.js` | 18.0.13 | MIT | https://github.com/markedjs/marked |
| `hud/ui/mermaid.min.js` | 12.0.0 | MIT | https://github.com/mermaid-js/mermaid |

Versions are the ones the bundles report about themselves: marked's is in its
own file header, mermaid's is its internal `version` string (`getVersion()`).

## marked — `hud/ui/marked.min.js`

```
Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

marked's distribution also reproduces the original Markdown.pl license (John
Gruber, 2004, BSD-3-Clause style) for the syntax it implements; see
`LICENSE` in the marked repository for that text.

## mermaid — `hud/ui/mermaid.min.js`

```
The MIT License (MIT)

Copyright (c) 2014 - 2022 Knut Sveidqvist

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The vendored mermaid bundle arrived here with no header notice — the bundler
stripped it, and nobody noticed until the repository was licensed. A header
comment has since been prepended to `hud/ui/mermaid.min.js` restoring the
notice above. That was an accident to fix, not a choice; do not strip it again
on the next bump.

mermaid bundles its own dependencies, several of which carry their own MIT or
BSD notices inside the minified file (for example `js-yaml`, Ralf S.
Engelschall's `stackblur`). Those notices are intact in the bundle and travel
with it.
