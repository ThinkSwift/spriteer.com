# spriteer.com

Static site on GitHub Pages. No build step.

- `/` and `/c/` (challenge links) are the same page; `c/index.html` is a copy of `index.html` with `noindex`.
  After editing `index.html`, refresh the copy (see the `sed` line in the commit that added it).
- A challenge link is `https://spriteer.com/c/#<Skin PNG, base64url>` — the Skin PNG v1 format
  (Spriteer repo `docs/skin-png-v1.md`). The part after `#` never reaches the server.
- The house follows the engine's `HOUSE.md`: this site writes the Spriteer half (residents, guests);
  the Pythoneer half arrives through the door (`#house=`).
- `js/art.js` is generated from PythoneerEngineKit (Resources/Sprites + the survival tileset). Do not edit by hand.
- `.well-known/apple-app-site-association` lets the Spriteer app open `/c/*` links.
- Events go to the shared web events endpoint as `spriteer.com` (same names as the app's Usage events).
