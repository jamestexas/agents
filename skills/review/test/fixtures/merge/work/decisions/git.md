| 1 | No — `parse()` runs first; `git/diff.patch` hunk 2 (`handler.go:88` vs `:104`). → candidate: signature verified after parse |
| 3 | Yes — `parser.go:12` splits on `\|` only; test at `parser_test.go:40`. → candidate: none |
