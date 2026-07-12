# v2.5.0 — CAP code choices and Google Forms-style result entry

## Changes
- Replaced free-text CAP result fields with deterministic coded choices where the provider form has reporting codes.
- Options are displayed as `code │ English label`.
- Up to 5 choices render as radio cards; longer lists render as dropdowns.
- CAP terminology, JE1 questions and answer choices remain in English.
- Manufacturer/method/exception fields are collapsed under CAP reporting codes to reduce visual clutter.
- No database, SQL or Edge Function changes.

## Update files
- `index.html`
- `js/app.js`
- `css/app.css`
- `service-worker.js`
