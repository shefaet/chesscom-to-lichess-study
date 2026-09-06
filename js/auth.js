// Lichess OAuth 2.0 Authorization Code flow with PKCE (RFC 7636).
//
// Lichess accepts unregistered public clients: the client_id is an arbitrary
// unique string (we use this page's own URL) and there is no client secret.
// The only accepted challenge method is S256. Tokens last about a year and
// there are no refresh tokens — when one expires you just connect again.
//
// The code_verifier never leaves sessionStorage and never appears in a URL;
// only its SHA-256 hash is sent in the authorize request. That is what makes
// the intercepted-authorization-code attack useless against us.

const LICHESS = 'https://lichess.org';
const SCOPES = 'study:write';

const TOKEN_KEY = 'ctls.token.v1';
const PKCE_KEY = 'ctls.pkce'; // sessionStorage: cleared when the tab closes

/**
 * This page's canonical URL, used as both client_id and redirect_uri.
 * Must be byte-identical in the authorize request and the token exchange,
 * so it is derived the same way in both.
 */
export function appUrl() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.pathname = u.pathname.replace(/index\.html$/, '');
  return u.toString();
}

// --- token storage --------------------------------------------------------

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function isConnected() {
  return Boolean(getToken());
}

function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}

export function forgetToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// --- PKCE primitives ------------------------------------------------------

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes -> 43 base64url chars, within RFC 7636's 43..128 range. */
function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function s256(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// --- flow -----------------------------------------------------------------

/** Step 1: stash a verifier + state, then hand the user to Lichess. */
export async function beginLogin() {
  const verifier = randomToken();
  const state = randomToken();
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: appUrl(),
    redirect_uri: appUrl(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: await s256(verifier),
    state,
  });
  location.href = `${LICHESS}/oauth?${params}`;
}

/**
 * Step 2: if we have just been redirected back, exchange the code for a token.
 * Returns 'connected' | 'denied' | null (not a redirect). Always leaves the
 * URL clean so a reload doesn't retry a spent code.
 */
export async function completeLoginIfRedirected() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  const error = q.get('error');
  const returnedState = q.get('state');
  if (!code && !error) return null;

  let stash = null;
  try {
    stash = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
  } catch { /* treated as missing below */ }
  sessionStorage.removeItem(PKCE_KEY);
  cleanUrl();

  if (error) {
    if (error === 'access_denied') return 'denied';
    throw new Error(q.get('error_description') || error);
  }
  if (!stash) throw new Error('Authorisation state was lost. Please try connecting again.');
  if (returnedState !== stash.state) throw new Error('State mismatch — authorisation rejected.');

  const res = await fetch(`${LICHESS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: stash.verifier,
      redirect_uri: appUrl(),
      client_id: appUrl(),
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}).`);

  const data = await res.json();
  if (!data.access_token) throw new Error('Token exchange returned no access token.');
  setToken(data.access_token);
  return 'connected';
}

function cleanUrl() {
  history.replaceState(null, '', appUrl());
}
