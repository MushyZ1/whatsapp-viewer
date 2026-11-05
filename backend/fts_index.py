"""
FTS5 candidate index for search.

The user's database is never modified. A separate SQLite file (in the app's data folder, keyed by the
database's path + size + mtime) holds a contentless FTS5 table using the *trigram* tokenizer, which
supports fast substring MATCH - exactly what "bud" -> "budget" needs.

It is only used to NARROW the rows that the existing matcher (search_utils.matches_blob) then checks
exactly, so results are identical to the plain scan, just faster. Any problem (SQLite without
trigram support, unwritable data folder, index still building, corrupt file) silently falls back to
the plain scan.
"""
import hashlib
import logging
import os
import sqlite3
import sys
import threading
from pathlib import Path
from typing import List, Optional, Tuple

from search_utils import fold, is_real_file, file_text, ParsedQuery

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "1"
MIN_TOKEN = 3            # trigram needs >= 3 characters to narrow anything
BATCH = 5000


def data_dir() -> Path:
    override = os.environ.get("WA_VIEWER_DATA_DIR")
    if override:
        base = Path(override)
    elif sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "whatsapp-viewer"
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / "whatsapp-viewer"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "whatsapp-viewer"
    return base / "fts"


def narrowing_tokens(pq: ParsedQuery) -> List[str]:
    """Pieces (>= 3 chars, no whitespace) that every matching message must contain."""
    out: List[str] = []
    for item in list(pq.terms) + list(pq.phrases):
        for piece in item.split():
            if len(piece) >= MIN_TOKEN and piece not in out:
                out.append(piece)
    return out


def fts_match_expr(tokens: List[str]) -> str:
    return " AND ".join('"' + t.replace('"', '""') + '"' for t in tokens)


class FtsIndex:
    def __init__(self, db_path: str):
        self.db_path = str(Path(db_path).resolve())
        self.state = "idle"           # idle | building | ready | unavailable
        self.error: Optional[str] = None
        self.indexed_rows = 0
        self._cancel = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.index_path: Optional[Path] = None

    # ── lifecycle ───────────────────────────────────────────────────────────
    def _target(self) -> Path:
        st = os.stat(self.db_path)
        h = hashlib.sha1(self.db_path.encode("utf-8", "replace")).hexdigest()[:12]
        return data_dir() / f"fts-{h}-{st.st_size}-{st.st_mtime_ns}.sqlite"

    def start(self) -> None:
        """Begin (or reuse) the index in the background. Never raises."""
        try:
            self.index_path = self._target()
            self.index_path.parent.mkdir(parents=True, exist_ok=True)
            if self._is_complete(self.index_path):
                self.state = "ready"
                logger.info("Search index ready (reused): %s", self.index_path.name)
                return
            self.state = "building"
            self._thread = threading.Thread(target=self._build_safe, name="fts-build", daemon=True)
            self._thread.start()
        except Exception as e:                      # noqa: BLE001 - must never break opening a database
            self._fail(e)

    def cancel(self) -> None:
        self._cancel.set()

    def _fail(self, e: Exception) -> None:
        self.state = "unavailable"
        self.error = str(e)
        logger.warning("Search index unavailable (falling back to plain search): %s", e)

    @staticmethod
    def _is_complete(path: Path) -> bool:
        if not path.exists():
            return False
        try:
            con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            try:
                row = con.execute("SELECT v FROM meta WHERE k='complete'").fetchone()
                ver = con.execute("SELECT v FROM meta WHERE k='schema'").fetchone()
                return bool(row) and row[0] == "1" and bool(ver) and ver[0] == SCHEMA_VERSION
            finally:
                con.close()
        except Exception:                            # noqa: BLE001
            return False

    # ── build ───────────────────────────────────────────────────────────────
    def _build_safe(self) -> None:
        tmp = None
        try:
            assert self.index_path is not None
            tmp = self.index_path.with_suffix(".building")
            if tmp.exists():
                tmp.unlink()
            self._build(tmp)
            if self._cancel.is_set():
                tmp.unlink(missing_ok=True)
                return
            os.replace(tmp, self.index_path)
            self._remove_stale()
            self.state = "ready"
            logger.info("Search index ready: %d messages indexed", self.indexed_rows)
        except Exception as e:                       # noqa: BLE001
            self._fail(e)
            try:
                if tmp is not None:
                    tmp.unlink(missing_ok=True)
            except OSError:
                pass

    def _build(self, tmp: Path) -> None:
        src = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        dst = sqlite3.connect(str(tmp))
        try:
            dst.execute("PRAGMA journal_mode=OFF")
            dst.execute("PRAGMA synchronous=OFF")
            dst.execute("CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT)")
            dst.execute("CREATE VIRTUAL TABLE msgfts USING fts5(body, content='', tokenize='trigram')")

            media_by_msg = {}
            has_media = src.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='message_media'").fetchone()
            if has_media:
                for mid, name, path, mime, cap in src.execute(
                        "SELECT message_row_id, media_name, file_path, mime_type, media_caption FROM message_media"):
                    if is_real_file(mime, path):
                        media_by_msg.setdefault(mid, []).append(file_text(name, path, cap))

            batch = []
            total = 0
            for mid, text in src.execute("SELECT _id, text_data FROM message"):
                if self._cancel.is_set():
                    return
                body = fold(((text or "") + " " + " ".join(media_by_msg.get(mid, ()))).strip())
                if not body:
                    continue
                batch.append((mid, body))
                if len(batch) >= BATCH:
                    dst.executemany("INSERT INTO msgfts(rowid, body) VALUES (?, ?)", batch)
                    total += len(batch)
                    self.indexed_rows = total
                    batch = []
            if batch:
                dst.executemany("INSERT INTO msgfts(rowid, body) VALUES (?, ?)", batch)
                total += len(batch)
            self.indexed_rows = total
            dst.execute("INSERT INTO meta VALUES('schema', ?)", (SCHEMA_VERSION,))
            dst.execute("INSERT INTO meta VALUES('complete', '1')")
            dst.commit()
        finally:
            src.close()
            dst.close()

    def _remove_stale(self) -> None:
        """Delete index files of older versions of the same database."""
        try:
            assert self.index_path is not None
            prefix = self.index_path.name.split("-")[0:2]
            for f in self.index_path.parent.glob(f"{prefix[0]}-{prefix[1]}-*"):
                if f != self.index_path:
                    f.unlink(missing_ok=True)
        except Exception:                            # noqa: BLE001
            pass

    # ── query side ──────────────────────────────────────────────────────────
    def narrowing(self, pq: ParsedQuery) -> Optional[Tuple[str, str]]:
        """(index file, FTS MATCH expression) when the index can narrow this query, else None."""
        if self.state != "ready" or self.index_path is None:
            return None
        tokens = narrowing_tokens(pq)
        if not tokens:
            return None                              # only 1-2 letter words: plain scan
        return str(self.index_path), fts_match_expr(tokens)

    def status(self) -> dict:
        return {"state": self.state, "indexed_messages": self.indexed_rows, "error": self.error}
