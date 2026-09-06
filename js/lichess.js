// Lichess study API. CORS is open (`access-control-allow-origin: *`) and
// Authorization is an allowed header, so this all works from a static page.

const LICHESS = 'https://lichess.org';

export class AuthError extends Error {}

async function authed(token, path, init = {}) {
  const res = await fetch(`${LICHESS}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new AuthError('Lichess rejected the token — reconnect.');
  return res;
}

/** The connected account's username, or null if the token can't tell us. */
export async function whoami(token) {
  try {
    const res = await authed(token, '/api/account');
    if (!res.ok) return null;
    return (await res.json()).username || null;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    return null;
  }
}

/**
 * Create a chapter in an existing study from raw PGN.
 * POST /api/study/{studyId}/import-pgn, scope study:write.
 * Returns { id, name } of the created chapter.
 */
export async function importPgn(token, { studyId, pgn, name, orientation }) {
  const body = new URLSearchParams({ pgn, name, orientation });

  const res = await authed(token, `/api/study/${studyId}/import-pgn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (res.status === 404) throw new Error('Study not found — check the study ID.');
  if (res.status === 403) throw new Error('No permission to write to that study.');
  if (res.status === 429) throw new Error('Rate limited by Lichess. Wait a minute and retry.');
  if (!res.ok) {
    throw new Error(await errorText(res) || `Lichess returned ${res.status}.`);
  }

  const data = await res.json();
  const chapter = data.chapters?.[0];
  if (!chapter) throw new Error('Lichess created no chapter (is the study at its 64-chapter limit?).');
  return chapter;
}

async function errorText(res) {
  try {
    const data = await res.json();
    return data.error || null;
  } catch {
    return null;
  }
}

/** Ask Lichess to revoke the token as well as forgetting it locally. */
export async function revokeToken(token) {
  try {
    await authed(token, '/api/token', { method: 'DELETE' });
  } catch {
    // Already invalid or offline; the local copy is dropped either way.
  }
}

// The trailing slashes below are load-bearing — do not "tidy" them away.
//
// The Lichess iOS app claims these paths as Universal Links. From its
// apple-app-site-association:
//
//     { "/": "/study/????????"            }   Studies
//     { "/": "/study/????????/????????"   }   Studies with explicit chapter ID
//
// So navigating to a canonical study URL on iOS opens the native app, which
// cannot create chapters or edit comments — the exact opposite of what we
// want after an import.
//
// In those patterns `?` matches exactly one character, so a trailing slash
// makes the path one character too long and the rule no longer matches. iOS
// leaves the navigation alone, and Lichess 301s the slashed form back to the
// canonical URL. Safari follows that redirect internally: a server redirect
// does not re-trigger Universal Link matching, so we land on the website.

export function chapterUrl(studyId, chapterId) {
  return `${LICHESS}/study/${studyId}/${chapterId}/`;
}

export function studyUrl(studyId) {
  return `${LICHESS}/study/${studyId}/`;
}
