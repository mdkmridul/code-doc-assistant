# 0004 — Enforce LF line endings with `.gitattributes`

All text files are stored and checked out with LF (`* text=auto eol=lf` in `.gitattributes`). We chose this over setting Prettier's `endOfLine: "auto"`. The repo is developed on Windows, where files had CRLF endings and caused 85 `prettier/prettier` lint errors in the API. Relaxing Prettier would hide the inconsistency and let mixed line endings into commits and diffs. Forcing LF at the git level makes every OS, every Docker container and every formatter see the same bytes.
