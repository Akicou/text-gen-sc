# Moodle Question Extractor (Firefox)

A small Firefox extension that detects Moodle quiz questions on any page
and adds a little **📋 Extrahieren** button in the top-right corner of each
question. Clicking it opens a popup with the question text and all options
as plain text, ready to be copied.

## Supported question types

| Moodle class                 | What it looks like                            |
|------------------------------|-----------------------------------------------|
| `que.kprime`                 | "richtig / falsch" table (K-Prime)            |
| `que.multichoice`            | Single-answer radio buttons                   |
| `que.gapselect`              | Lückentext with dropdown gaps                 |
| `que.match`                  | Zuordnung / drag-and-drop matching            |

For multichoice questions, if the page already shows the solution, the
extracted text also marks the correct and chosen option.

## Install in Firefox (temporary, for development)

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."**.
3. Select the `manifest.json` file inside this folder (or any file inside
   the unzipped extension folder).
4. Open a Moodle quiz page — you should see the blue **📋 Extrahieren**
   button in the top-right of each question.

> Temporary add-ons are removed when Firefox restarts. For permanent
> install you'd need to sign the extension via AMO (addons.mozilla.org) or
> use Firefox Developer/Nightly with `xpinstall.signatures.required` set
> to `false` in `about:config`.

## Install from the .zip

If you got `moodle-extractor.zip`, unzip it first, then follow the steps
above pointing at the unzipped `manifest.json`.

## Usage

- Click **📋 Extrahieren** on any supported question.
- A modal opens with the extracted text.
- Click **Kopieren** (or just press `Ctrl+C` — the text is pre-selected).
- Press `Esc` or click outside the modal to close it.

## Files

- `manifest.json` — extension manifest (MV2, Firefox)
- `content.js`    — detects questions and builds the popup
- `content.css`   — styles the button and popup
- `icons/`        — extension icons
