// Remembers which media folder belongs to which database / .wachat file, so the
// user doesn't have to pick it again every time the app is opened.
//
// Stored in localStorage as { "<source path>": "<media folder>" }. localStorage can
// be unavailable or throw (private mode, cleared site data), so every access is
// wrapped: when it fails the app simply behaves as before (nothing remembered).

const STORE_KEY = "wa-viewer:media-folders:v1";

type Store = Record<string, string>;

// Windows paths are case-insensitive and may use either slash, so "C:\Chats\a.db"
// and "c:/chats/a.db" must map to the same entry.
export function normalizeSourcePath(path: string): string {
  const p = path.trim().replace(/\\/g, "/");
  return /^[a-z]:\//i.test(p) || p.startsWith("//") ? p.toLowerCase() : p;
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable or full: not remembering is fine */
  }
}

export function getSavedMediaFolder(sourcePath: string): string | null {
  const folder = readStore()[normalizeSourcePath(sourcePath)];
  return typeof folder === "string" && folder ? folder : null;
}

export function saveMediaFolder(sourcePath: string, folder: string): void {
  const store = readStore();
  store[normalizeSourcePath(sourcePath)] = folder;
  writeStore(store);
}
