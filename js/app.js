import * as auth from './auth.js';
import * as chesscom from './chesscom.js';
import * as lichess from './lichess.js';
import {
  loadSettings, saveSettings, settingsComplete, validStudyId,
  loadImported, markImported,
} from './settings.js';

const $ = (id) => document.getElementById(id);

const el = {
  settings: $('settings'),
  settingsToggle: $('settings-toggle'),
  user: $('in-user'),
  study: $('in-study'),
  save: $('save-settings'),
  close: $('close-settings'),
  authStatus: $('auth-status'),
  connect: $('connect'),
  disconnect: $('disconnect'),
  banner: $('banner'),
  gamesSection: $('games-section'),
  listMeta: $('list-meta'),
  games: $('games'),
  refresh: $('refresh'),
  setupPrompt: $('setup-prompt'),
  openSettings: $('open-settings'),
};

let settings = loadSettings();
let games = [];
let busy = false;

// --- banner ---------------------------------------------------------------

function say(message, kind = 'info') {
  el.banner.textContent = message;
  el.banner.className = `banner ${kind}`;
}

function clearBanner() {
  el.banner.textContent = '';
  el.banner.className = 'banner hidden';
}

/** Errors from an expired or revoked token should drop us back to connect. */
function handleError(e) {
  if (e instanceof lichess.AuthError) {
    auth.forgetToken();
    renderAuth();
    renderShell();
    openSettings(true);
    say('Lichess token is no longer valid. Connect again.', 'error');
  } else {
    say(e.message || String(e), 'error');
  }
}

// --- settings panel -------------------------------------------------------

function openSettings(open) {
  el.settings.classList.toggle('hidden', !open);
  el.settingsToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    el.user.value = settings.chesscomUser;
    el.study.value = settings.studyId;
  }
  renderShell();
}

el.settingsToggle.addEventListener('click', () => {
  openSettings(el.settings.classList.contains('hidden'));
});
el.close.addEventListener('click', () => openSettings(false));
el.openSettings.addEventListener('click', () => openSettings(true));

el.save.addEventListener('click', async () => {
  const chesscomUser = el.user.value.trim();
  const studyId = el.study.value.trim();

  if (!chesscomUser) return say('Enter your chess.com username.', 'error');
  if (!validStudyId(studyId)) return say('Study ID must be 8 letters or digits.', 'error');

  settings = saveSettings({ chesscomUser, studyId });
  clearBanner();
  openSettings(false);
  renderShell();
  if (auth.isConnected()) await loadGames();
});

// --- auth -----------------------------------------------------------------

el.connect.addEventListener('click', () => auth.beginLogin());

el.disconnect.addEventListener('click', async () => {
  const token = auth.getToken();
  if (token) await lichess.revokeToken(token);
  auth.forgetToken();
  games = [];
  renderAuth();
  renderShell();
  say('Disconnected.', 'info');
});

function renderAuth(username = null) {
  const connected = auth.isConnected();
  el.connect.classList.toggle('hidden', connected);
  el.disconnect.classList.toggle('hidden', !connected);
  if (!connected) {
    el.authStatus.textContent = 'Not connected.';
  } else {
    el.authStatus.textContent = username ? `Connected as ${username}.` : 'Connected.';
  }
}

// --- game list ------------------------------------------------------------

async function loadGames() {
  if (!settingsComplete(settings) || !auth.isConnected()) return;
  el.refresh.disabled = true;
  say('Loading games…');
  try {
    games = await chesscom.fetchRecentGames(settings.chesscomUser);
    clearBanner();
    renderGames();
  } catch (e) {
    handleError(e);
  } finally {
    el.refresh.disabled = false;
  }
}

el.refresh.addEventListener('click', loadGames);

function renderGames() {
  const imported = loadImported();
  el.games.replaceChildren();

  if (!games.length) {
    el.listMeta.textContent = 'No finished games in the last two months.';
    return;
  }
  el.listMeta.textContent = `${games.length} most recent, newest first.`;

  for (const game of games) {
    el.games.append(gameRow(game, imported[game.uuid]));
  }
}

function gameRow(game, alreadyImported) {
  const li = document.createElement('li');
  li.className = `game ${game.outcome}`;

  const main = document.createElement('div');
  main.className = 'game-main';

  const title = document.createElement('div');
  title.className = 'game-title';
  title.textContent = `${game.colour === 'white' ? '□' : '■'} vs ${game.opponent}`;
  if (game.opponentRating) {
    const rating = document.createElement('span');
    rating.className = 'muted';
    rating.textContent = ` (${game.opponentRating})`;
    title.append(rating);
  }

  const meta = document.createElement('div');
  meta.className = 'game-meta';
  meta.textContent = [
    chesscom.localDate(game.endTime),
    game.timeClass,
    game.resultTag,
    game.eco,
  ].filter(Boolean).join(' · ');

  main.append(title, meta);

  const action = document.createElement('div');
  action.className = 'game-action';

  if (alreadyImported) {
    const link = document.createElement('a');
    link.className = 'btn-link';
    link.href = lichess.chapterUrl(settings.studyId, alreadyImported.chapterId);
    link.textContent = 'Open ↗';
    link.rel = 'noopener noreferrer';
    action.append(link);
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primary';
    btn.textContent = 'Import';
    btn.addEventListener('click', () => importGame(game, btn));
    action.append(btn);
  }

  li.append(main, action);
  return li;
}

async function importGame(game, btn) {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    const chapter = await lichess.importPgn(auth.getToken(), {
      studyId: settings.studyId,
      pgn: game.pgn,
      name: chesscom.chapterName(game),
      orientation: game.colour,
    });
    markImported(game.uuid, chapter.id);
    renderGames();
    say('Chapter created. Opening Lichess…', 'ok');
    location.href = lichess.chapterUrl(settings.studyId, chapter.id);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Import';
    handleError(e);
  } finally {
    busy = false;
  }
}

// --- shell ----------------------------------------------------------------

function renderShell() {
  const ready = settingsComplete(settings) && auth.isConnected();
  const settingsOpen = !el.settings.classList.contains('hidden');
  el.gamesSection.classList.toggle('hidden', !ready);
  // The prompt only exists to point at the settings panel, so it is noise
  // whenever that panel is already open.
  el.setupPrompt.classList.toggle('hidden', ready || settingsOpen);
}

// --- boot -----------------------------------------------------------------

(async function boot() {
  renderAuth();
  renderShell();

  try {
    const result = await auth.completeLoginIfRedirected();
    if (result === 'denied') say('Authorisation cancelled.', 'error');
  } catch (e) {
    say(e.message, 'error');
  }

  renderAuth();
  renderShell();

  if (!settingsComplete(settings)) {
    openSettings(true);
    return;
  }
  if (!auth.isConnected()) {
    openSettings(true);
    return;
  }

  // Fire-and-forget: a failed whoami must not block the game list.
  lichess.whoami(auth.getToken()).then((name) => renderAuth(name)).catch(handleError);
  await loadGames();
})();
