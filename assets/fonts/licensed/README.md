Place licensed font binaries for code-to-design here and register them in `manifest.json`.

The preferred workflow is to run the font sync step against the website project first:

`npm run code-to-design:fonts -- --snapshot /tmp/aitest-snapshot.json --project ../AItest --dist ../AItest/dist --sync-bundle`

If the website ships font binaries, the sync step copies them into this bundle. If the website only declares a font stack, the sync step falls back to the browser-resolved local font files so the licensed bundle still matches the fonts actually used in the page capture.

Required for exact AItest parity:
- `Didot`
- `Iowan Old Style`
- any additional browser-resolved families captured by the runtime snapshot

The acceptance workflow treats missing manifest coverage or missing files as a hard failure.
