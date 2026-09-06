// Persisted configuration and the record of what has already been imported.
// Everything lives in localStorage, scoped to this page's origin.

const SETTINGS_KEY = 'ctls.settings.v1';
const IMPORTED_KEY = 'ctls.imported.v1';

const DEFAULTS = { chesscomUser: '', studyId: '' };

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function settingsComplete(s = loadSettings()) {
  return Boolean(s.chesscomUser && s.studyId);
}

/** Study IDs are exactly 8 characters of [A-Za-z0-9]. */
export function validStudyId(id) {
  return /^[A-Za-z0-9]{8}$/.test(id);
}

// --- imported games -------------------------------------------------------
// Keyed by the chess.com game UUID so a game is never imported twice.

export function loadImported() {
  try {
    return JSON.parse(localStorage.getItem(IMPORTED_KEY) || '{}');
  } catch {
    return {};
  }
}

export function markImported(uuid, chapterId) {
  const all = loadImported();
  all[uuid] = { chapterId, at: Date.now() };
  localStorage.setItem(IMPORTED_KEY, JSON.stringify(all));
  return all;
}
