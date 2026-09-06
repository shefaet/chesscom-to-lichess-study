# Game → Study

A phone-first static page that imports a **chess.com** game — clock comments and
all — straight into a chapter of an existing **Lichess study**, then drops you
into that chapter ready to annotate.

It replaces this:

> finish a game in the chess.com app → open chess.com in the browser → find the
> game → create a "classroom" (the only obvious way to get a PGN with clocks) →
> copy the PGN → open lichess.org → find the study → new chapter → paste

with a single tap.

No server, no build step, no dependencies. It is `index.html` plus four ES
modules, hostable on GitHub Pages as-is.

## Why this works without a backend

| | |
|---|---|
| **chess.com** | The [public data API](https://www.chess.com/news/view/published-data-api) needs no auth, sends `access-control-allow-origin: *`, and its PGN already contains `{[%clk ...]}`. The classroom detour was never necessary. |
| **Lichess** | Sends `allow-origin: *` with `POST` and `Authorization` permitted, and supports **unregistered public OAuth clients** — arbitrary `client_id`, no client secret, PKCE `S256`. Lichess's own [demo app](https://lichess-org.github.io/api-demo/) is a static GitHub Pages site doing the same thing. |

## Setup

1. Publish the folder with GitHub Pages (Settings → Pages → deploy from branch).
2. Open it on your phone, and **Add to Home Screen** — the manifest makes it
   launch fullscreen without Safari's chrome.
3. Tap ⚙ and enter:
   - **Chess.com username** — used for the public archive lookup.
   - **Lichess study ID** — the 8 characters in `lichess.org/study/XXXXXXXX`.
4. Tap **Connect Lichess** and approve. That's the PKCE flow; nothing to paste.

Both settings persist in `localStorage` and can be changed any time.

### Running locally

```sh
python3 -m http.server 8000     # then open http://localhost:8000/
```

Lichess permits `http://` redirect URIs on localhost, so the OAuth flow works
in local dev. The `client_id` and `redirect_uri` are both derived from the
page's own URL, so nothing needs reconfiguring between local and Pages.

## How the auth works

Authorization Code flow with PKCE ([RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)):

1. Generate a random `code_verifier` and `state` into `sessionStorage`.
2. Send the user to `lichess.org/oauth` with `code_challenge = S256(verifier)`.
   **The verifier itself is never transmitted and never appears in a URL.**
3. You log in *on lichess.org* — this page never sees your credentials.
4. Lichess redirects back with `?code=…&state=…`; the `state` is checked.
5. `POST /api/token` exchanges the code **plus the verifier** for an access
   token, which is stored in `localStorage` and sent as a bearer token.

The intercepted-code attack is what PKCE exists to stop: the code comes back
through a URL, and URLs leak (history, referrers, other apps). Without the
verifier the code is worthless, and the verifier never left the browser.

A client secret would be pointless here — anyone can read a static page — which
is exactly why the spec's answer for public clients is PKCE instead of one.

### What is and isn't exposed

**Published in this repo:** the `client_id` (this page's URL), the redirect URI,
and the source. All public by design; none of it grants access to anything.

**Not in the repo:** the access token. It is minted on your device and stays in
that browser's `localStorage`.

Worth knowing:

- **Scope is `study:write` only** — the token cannot play games, read your
  email, or change your account. But Lichess has no per-study scope, so it can
  write to *all* your studies, not just the configured one.
- **`username.github.io` is a single origin for every repo you publish there,**
  and `localStorage` is origin-scoped, not path-scoped. Any other page you host
  on that origin can read this token. Use a custom domain, or keep the rule that
  nothing on that origin loads third-party scripts.
- To limit XSS reach the page ships a strict CSP (`default-src 'none'`, no
  inline script or style, `connect-src` pinned to the two APIs), has no
  third-party or CDN dependencies, and renders every game field with
  `textContent` — opponent names and PGN tags are attacker-controlled strings.
- **Revoke** with the Disconnect button (calls `DELETE /api/token`) or at
  [lichess.org/account/oauth/token](https://lichess.org/account/oauth/token).
- Tokens last about a year. There are no refresh tokens; when one expires the
  app drops back to the Connect button.

## Behaviour notes

- Reads the current month's archive, plus the previous month if that is thin —
  so it still works on the 1st.
- Imported game UUIDs are remembered, so a game shows **Open ↗** instead of
  **Import** on a second visit. This is per-device.
- Chapter names are `2026-09-04 · B vs opponent · 0-1`, and the board is
  oriented to the colour you played.
- The PGN is passed through **verbatim** — no parsing, no rewriting — so the
  clock comments survive into the study.

## Files

```
index.html            markup, CSP, PWA wiring
app.css               mobile-first styling, light + dark
manifest.webmanifest  home-screen install
js/auth.js            OAuth PKCE against Lichess
js/chesscom.js        public archive fetch, normalising, chapter naming
js/lichess.js         study import, whoami, token revoke
js/settings.js        persisted config + imported-game record
js/app.js             UI wiring
```

## API reference

- `GET https://api.chess.com/pub/player/{user}/games/{YYYY}/{MM}`
- `POST https://lichess.org/api/study/{studyId}/import-pgn` — scope `study:write`
- `POST https://lichess.org/api/token`, `DELETE https://lichess.org/api/token`
- [Lichess API docs](https://lichess.org/api)
