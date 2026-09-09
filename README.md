# Action Recorder PDF

A Chrome MV3 extension that records web page actions as annotated screenshot steps and exports them to PDF, editable Word, or JSON backup.

## Why I built it

Creating operation manuals usually means repeating the same work: perform an action, take a screenshot, mark the key position, write a note, and arrange everything into a document. Action Recorder turns that workflow into a lightweight browser tool.

## What it does

- Records a baseline screenshot when recording starts.
- Captures clicks as annotated screenshots with a visual marker.
- Captures changed text inputs after Tab / blur.
- Masks sensitive fields such as passwords, phone numbers, verification codes, IDs, and bank-card-related fields.
- Provides a floating right-side cache panel with drag, resize, collapse, close, and snap-back controls.
- Lets users edit notes, reorder steps, delete steps, and recapture the current viewport.
- Provides a demo mode that replays recorded click/input positions on the page.
- Exports records to PDF, editable Word-compatible `.doc`, and JSON backup.
- Stores screenshot blobs in IndexedDB and lightweight session metadata in Chrome local storage.
- Includes a recovery page for restoring locally cached recording sessions.

## Tech stack

- Chrome Extension Manifest V3
- Vanilla JavaScript / HTML / CSS
- Chrome Scripting, Tabs, Storage APIs
- IndexedDB
- Shadow DOM
- Blob / Object URL based document export

## Project structure

```text
action-recorder-pdf/
├── manifest.json
├── index.html                 # Project showcase page (GitHub Pages)
├── test-page.html             # Local test page
├── emergency-rescue-snippet.js
└── src/
    ├── background.js
    ├── content.js
    ├── content.css
    ├── shared.js
    ├── export.html
    ├── export.js
    ├── export.css
    ├── recovery.html
    ├── recovery.js
    ├── recovery.css
    └── icon.svg
```

## Load in Chrome / Edge

1. Download or clone this repository.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder.
6. Open any normal webpage and click the extension icon.
7. Click **开始录制 / Start Recording** in the right-side panel.

> For local `file://` pages, enable the extension's “Allow access to file URLs” permission first.

## Privacy

The extension is designed to keep captured data local. Screenshots and recording sessions are stored in the browser and are not uploaded to an external server by this project.

## Resume-oriented project summary

Built a Chrome MV3 browser extension to automate operation-manual production by recording key webpage interactions, generating annotated screenshots, supporting step editing/reordering and sensitive-input masking, and exporting structured records to PDF/Word/JSON. The tool was designed to reduce repetitive screenshot-and-document work in real product-support workflows.

## License

For portfolio and learning use. Add your preferred open-source license before accepting external contributions.
