---
title: IndyGrab araç entegrasyonu
created: 2026-09-13
modified: 2026-09-13
type: implementation-report
status: 🟢 active
tags: [indygrab, test]
---

# Tools integration (title removal, embedded Mixer and ASIN blacklist)

## Final changes
- Title preparation removed: `titles.html`, `titles.js`, `title_generator.js` deleted; no title entries in `manifest.json` or `research.html`.
- Legacy `generatedTitles` storage is left untouched and no longer read. User data is not erased.
- Liste karıştırıcı (`#section-mixer`) and ASIN kara listesi (`#section-asin-blacklist`) now live in `research.html` and are routed by the sidebar through `research.js` (`#section-…` hash).
- `mixer.html` and `blacklist.html` are now compatibility stubs. `tool-route.js` sends them to `research.html#<data-workspace>`.
- Each tool has its own notification element (`#notification`, `#blacklist-notification`, `#mixer-notification`). The blacklist uses `data-blacklist-i18n`, so `popup.js`'s `[data-i18n]` pass can't overwrite it.
- Changing the language with the flags also updates the blacklist through `storage.onChanged`. Adding memory items with "Send to Blacklist" re-renders the embedded blacklist.
- Logo is still `assets/wordmark-indygrab.png`.

## Review fixes
- The embedded blacklist heading changed from `h1` to `h2` (so it no longer duplicates the page `h1`). Its title now says "ASIN kara listesi" so it isn't confused with the seller "Kara Liste".
- Re-downloading from export history now writes the same shape as the original export: JSON `{items:[{asin}]}`, and CSV ends with a newline.

## Unverified / remaining
- The browser wasn't run. Redirects, section switching and notification visibility still need testing.
- Only the files listed in the task were reviewed. `background.js`, `popup.html`, content scripts and CSS weren't checked for leftover title references or for styling of `.embedded-tool`, `.mixer-columns` and `.tool-actions`.
- `popup.js` injects global `.asin-row { color:#fff }`. This already existed, and blacklist rows may be hard to read in light theme.
- Sections without inline `display:none` can show briefly until `restoreWorkspace` runs (setTimeout 0).
- `tool-route.js` isn't listed in `web_accessible_resources`. It loads from the extension origin, which should be enough, but this wasn't verified.
- Old `#section-titles` hashes fall back to the first workspace.

## Integration verification (Astra)
- 20/20 isolated real-extension checks passed after Opus edits; 5/5 target unit tests passed.
- Mixer deduplication/TXT download, blacklist manual/file import and in-panel navigation, ASIN-only CSV/JSON exports verified. No uncaught page errors.
- Runtime title references absent; original logo preserved. The existing workspace CSS has a higher-specificity body .asin-row color rule.
- Live Amazon/eBay and long-running scans not exercised.
