# SelfActualSite

The marketing/landing site for selfActual — a **static site** served via **GitHub Pages from `main`** (`CNAME` → selfactual.ai). No build step, no framework; edit HTML/assets directly and push to `main` to publish.

## Structure

- **`index.html` (root)** — the **published live site**. Single-page, with an "Experience / Architecture" mode toggle. Carries Google Analytics (`gtag` `G-R82XNXT8J0`), the favicon, and Intercom (`intercom.js`).
- **`newsite/index.html`** — the **staging area for changes-since-publishing**. The rule (owner's words): *"newsite is where all changes since publishing should be"* and *"no links from the main site to it."* Marked `noindex,nofollow`.
  - The **"a.i. & I" book section** lives **only** in `newsite/`, deliberately not on the root/live site.
  - Assets in `newsite/` reference the root via `../` (e.g. `../images/book_cover.png`) since it's one level down.

## Publishing

Root `index.html` is live the moment it lands on `main`. Promote a `newsite/` change to live by folding it into the root page (and fixing the `../` asset paths back to root-relative). Keep post-publish work-in-progress in `newsite/`, not the root.

## History (context, not current behavior)

`newsite/` **used to be password-gated** — a StatiCrypt-style client-side AES-256-GCM gate that decrypted the real page in-browser. That gate was **removed on 2026-05-26** (commit `99217c3`): the page was decrypted to plaintext and pushed to live at the owner's explicit direction. So `newsite/` now serves its content **directly, unencrypted** (still `noindex,nofollow`, still unlinked from root). Don't reintroduce or chase the old gate/password — it's moot. The pre-encryption plaintext is recoverable from git at `28dd849` if ever needed.
