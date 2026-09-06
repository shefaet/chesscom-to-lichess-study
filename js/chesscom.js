// Chess.com public data API. No authentication, and the PGN it returns
// already contains {[%clk ...]} comments — which is the whole reason this
// tool exists, since the site UI makes you jump through hoops for them.
//
// Docs: https://www.chess.com/news/view/published-data-api

const API = 'https://api.chess.com/pub';

/** Monthly archive URL for a Date. */
function archiveUrl(user, date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${API}/player/${encodeURIComponent(user.toLowerCase())}/games/${y}/${m}`;
}

/**
 * Two cache-busts, because the layer that actually goes stale is the browser's,
 * and Safari partitions its cache by top-level origin — so the copy this page
 * holds is invisible from a tab opened straight at the API, and survives a
 * browser restart. The archive says `max-age=5` and still gets served hours old.
 *
 * `no-store` is the real fix. The `t` parameter is a fallback for WebKit
 * versions that ignore the `cache` option, and it is free: chess.com's CDN
 * leaves the query string out of its cache key, so a unique `t` still lands on
 * the same edge entry and adds no origin traffic. That is exactly backwards
 * from what a cache-buster normally does, and it is why the param alone would
 * not have worked either — it is the browser being dodged here, not the CDN.
 *
 * What must NOT be added: a `Cache-Control` request header. Preflight answers
 * `access-control-allow-headers: Origin`, so it fails CORS and kills the fetch.
 * Nor a cased username — those 301 to the lowercase path.
 */
async function fetchMonth(user, date) {
  const url = `${archiveUrl(user, date)}?t=${Date.now()}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 404) throw new Error(`No chess.com player named "${user}".`);
  if (!res.ok) throw new Error(`Chess.com returned ${res.status}.`);
  const data = await res.json();
  return data.games || [];
}

/**
 * Recent games, newest first. Reads the current month and, if that is thin
 * (early in a month), the previous one too.
 */
export async function fetchRecentGames(user, { limit = 20 } = {}) {
  const now = new Date();
  let games = await fetchMonth(user, now);

  if (games.length < limit) {
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    try {
      games = games.concat(await fetchMonth(user, prev));
    } catch {
      // A missing previous month is not an error worth surfacing.
    }
  }

  return games
    .map((g) => normalise(g, user))
    .filter(Boolean)
    .sort((a, b) => b.endTime - a.endTime)
    .slice(0, limit);
}

const DRAW_RESULTS = new Set([
  'agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient',
]);

function normalise(g, user) {
  if (!g.pgn) return null; // daily games in progress, aborted games

  const lower = user.toLowerCase();
  const youAreWhite = (g.white?.username || '').toLowerCase() === lower;
  const youAreBlack = (g.black?.username || '').toLowerCase() === lower;
  if (!youAreWhite && !youAreBlack) return null;

  const you = youAreWhite ? g.white : g.black;
  const them = youAreWhite ? g.black : g.white;

  let outcome;
  if (you.result === 'win') outcome = 'win';
  else if (DRAW_RESULTS.has(you.result)) outcome = 'draw';
  else outcome = 'loss';

  return {
    uuid: g.uuid,
    url: g.url,
    endTime: (g.end_time || 0) * 1000,
    timeClass: g.time_class,
    timeControl: g.time_control,
    colour: youAreWhite ? 'white' : 'black',
    opponent: them.username || 'unknown',
    opponentRating: them.rating,
    yourRating: you.rating,
    outcome,
    resultTag: tagValue(g.pgn, 'Result') || '*',
    eco: ecoName(g),
    pgn: g.pgn,
  };
}

/** Read a single PGN seven-tag-roster value without pulling in a parser. */
function tagValue(pgn, name) {
  const m = pgn.match(new RegExp(`^\\[${name} "([^"]*)"\\]`, 'm'));
  return m ? m[1] : null;
}

function ecoName(g) {
  if (!g.eco) return null;
  // ECOUrl looks like .../openings/Caro-Kann-Defense-Exchange-Variation...
  // Take the part before the moves, minus the trailing move number some slugs
  // carry ("Three-Knights-Opening-3").
  const slug = (g.eco.split('/').pop() || '').split('...')[0];
  const name = slug.replace(/-\d+$/, '').replace(/-/g, ' ').trim();
  if (!name) return null;
  return name.length > 44 ? `${name.slice(0, 43)}…` : name;
}

/** Date as YYYY-MM-DD in the viewer's local timezone. */
export function localDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Study chapter name. Lichess caps these at 100 characters, so the opponent
 * name is trimmed rather than the parts that make the chapter identifiable.
 */
export function chapterName(game) {
  const side = game.colour === 'white' ? 'W' : 'B';
  const opponent = game.opponent.length > 40 ? `${game.opponent.slice(0, 39)}…` : game.opponent;
  return `${localDate(game.endTime)} · ${side} vs ${opponent} · ${game.resultTag}`;
}
