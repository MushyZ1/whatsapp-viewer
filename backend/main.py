from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from typing import Optional, List
from pydantic import BaseModel
import logging
import sys
import json
from pathlib import Path
from datetime import timedelta
from contextlib import asynccontextmanager
import tempfile
import subprocess
import shutil
import asyncio

from database import DatabaseManager
from search_utils import parse_query, matches, score, highlight_terms, searchable_text, file_matches, resolve_media_file
from models import Chat, Message, MessagePage, MediaItem, SearchParams
from indexer import create_indexes, analyze_database

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def strip_media_prefix(media_path: str) -> str:
    if media_path and media_path.startswith('Media/'):
        return media_path[6:]
    return media_path

# ─── GLOBALS ──────────────────────────────────────────────────────────────────
db_manager: Optional[DatabaseManager] = None
imported_chat_cache: Optional[dict] = None
IMPORTED_CHAT_ID = -1
imported_media_path: Optional[Path] = None


def _active_media_root():
    """The media folder in use, in either mode (None if not set)."""
    if db_manager and db_manager.media_path:
        return db_manager.media_path
    return imported_media_path

# ─── REQUEST MODELS ───────────────────────────────────────────────────────────
class InitRequest(BaseModel):
    db_path: str
    media_path: Optional[str] = None

class MediaConfigRequest(BaseModel):
    media_path: str

class ImportChatRequest(BaseModel):
    chat_path: str

class DecryptRequest(BaseModel):
    encrypted_db_path: str
    encryption_key: str  # 64-digit key from WhatsApp settings

# ─── APP ──────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Backend starting...")
    yield
    logger.info("Backend shutting down...")

app = FastAPI(title="WhatsApp Viewer API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",    # vite dev
        "http://localhost:1420",    # tauri dev
        "http://127.0.0.1:1420",   # tauri dev alt
        "tauri://localhost",        # tauri v2 WebView2 fallback
        "https://tauri.localhost",  # tauri v2 secure
        "http://tauri.localhost",   # tauri v2 Windows production
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── HELPERS ──────────────────────────────────────────────────────────────────
def validate_db_path(path: str) -> Path:
    db_path = Path(path)
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Database file not found")
    if not db_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    return db_path

def validate_media_path(path: Optional[str]) -> Optional[Path]:
    if not path:
        return None
    p = Path(path)
    if not p.exists():
        logger.warning(f"Media path does not exist: {path}")
        return None
    if not p.is_dir():
        raise HTTPException(status_code=400, detail="Media path is not a directory")
    return p

def _imported_msg_to_message(msg: dict) -> Message:
    return Message(
        id=msg['id'],
        timestamp=msg['timestamp'],
        from_me=msg.get('from_me', False),
        text=msg.get('text'),
        message_type=msg.get('message_type', 0),
        quoted_text=msg.get('quoted_text'),
        quoted_key_id=msg.get('quoted_key_id'),
        quoted_message_id=msg.get('quoted_message_id'),
        media=[
            MediaItem(
                file_path=m.get('file_path'),
                media_name=m.get('media_name'),
                mime_type=m.get('mime_type'),
                caption=m.get('caption') or m.get('media_caption'),
            )
            for m in (msg.get('media') or [])
        ],
    )

def _drop_dangling_quote_refs(data: dict) -> None:
    """Clear quoted_message_id values that don't point at a message in this file
    (hand-edited or trimmed exports), so the UI never offers a jump that can't work."""
    messages = data.get('messages') or []
    def _is_id(v) -> bool:
        return isinstance(v, int) and not isinstance(v, bool)
    ids = {m.get('id') for m in messages if isinstance(m, dict) and _is_id(m.get('id'))}
    for m in messages:
        if not isinstance(m, dict):
            continue
        q = m.get('quoted_message_id')
        if not (_is_id(q) and q in ids):
            m['quoted_message_id'] = None

def check_wadecrypt_installed() -> bool:
    """Check if wa-crypt-tools is installed"""
    try:
        result = subprocess.run(['wadecrypt', '--help'], 
                              capture_output=True, 
                              timeout=5)
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        # Try python -m method
        try:
            result = subprocess.run([sys.executable, '-m', 'wadecrypt', '--help'],
                                  capture_output=True,
                                  timeout=5)
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False

def install_wadecrypt() -> tuple[bool, str]:
    """
    Attempt to install wa-crypt-tools automatically
    Returns (success, message)
    """
    try:
        logger.info("Auto-installing wa-crypt-tools...")
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', 'wa-crypt-tools'],
            capture_output=True,
            text=True,
            timeout=120
        )
        
        if result.returncode == 0:
            logger.info("✅ wa-crypt-tools installed successfully")
            return True, "wa-crypt-tools installed successfully"
        else:
            error = result.stderr or result.stdout
            logger.error(f"Installation failed: {error}")
            return False, f"Installation failed: {error}"
    except subprocess.TimeoutExpired:
        return False, "Installation timed out"
    except Exception as e:
        logger.error(f"Installation error: {e}")
        return False, str(e)

@app.post("/api/install-wadecrypt")
async def install_wadecrypt_endpoint():
    """Attempt to install wa-crypt-tools automatically"""
    try:
        success, message = install_wadecrypt()
        if success:
            return {"status": "success", "message": message}
        else:
            raise HTTPException(status_code=500, detail=message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── DECRYPT DATABASE ─────────────────────────────────────────────────────────
@app.post("/api/decrypt")
async def decrypt_database(request: DecryptRequest):
    """
    Decrypt an encrypted WhatsApp database.
    wadecrypt accepts the 64-char hex key directly as the first positional arg:
        wadecrypt <hex_key> <encrypted_file> <output_file>
    """
    try:
        encrypted_path = Path(request.encrypted_db_path)
        if not encrypted_path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {encrypted_path}")

        key = request.encryption_key.replace('-', '').replace(' ', '').upper()
        if len(key) != 64 or not all(c in '0123456789ABCDEF' for c in key):
            raise HTTPException(
                status_code=400,
                detail="Invalid key — must be exactly 64 hex characters (0-9, A-F)."
            )

        wadecrypt_exe = shutil.which("wadecrypt")
        if not wadecrypt_exe:
            raise HTTPException(
                status_code=500,
                detail="wadecrypt not found. Install with: pip install wa-crypt-tools"
            )

        temp_dir    = Path(tempfile.mkdtemp())
        output_path = temp_dir / "msgstore.db"

        try:
            logger.info(f"Decrypting {encrypted_path.name} with wadecrypt...")
            # Pass hex key directly as first positional arg — no key file needed
            result = subprocess.run(
                [wadecrypt_exe, key, str(encrypted_path), str(output_path)],
                capture_output=True, text=True, timeout=180,
            )

            logger.info(f"wadecrypt stdout: {result.stdout.strip()}")
            if result.stderr.strip():
                logger.info(f"wadecrypt stderr: {result.stderr.strip()}")

            if result.returncode != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"Decryption failed: {result.stderr or result.stdout}"
                )

            if not output_path.exists() or output_path.stat().st_size == 0:
                raise HTTPException(status_code=500, detail="Decryption produced no output file")

            # Verify it's actually a SQLite database
            magic = output_path.read_bytes()[:6]
            if magic != b"SQLite":
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Decrypted output is not a valid SQLite database. "
                        "The key may be wrong, or the file may be corrupted."
                    )
                )

            downloads_dir = Path.home() / "Downloads"
            downloads_dir.mkdir(parents=True, exist_ok=True)
            final_path = downloads_dir / "msgstore_decrypted.db"
            counter = 1
            while final_path.exists():
                final_path = downloads_dir / f"msgstore_decrypted_{counter}.db"
                counter += 1

            shutil.copy(output_path, final_path)
            logger.info(f"✅ Saved: {final_path}")

            return {
                "status": "success",
                "message": "Database decrypted successfully",
                "decrypted_path": str(final_path),
                "size_mb": round(final_path.stat().st_size / (1024 * 1024), 2),
            }

        finally:
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                logger.warning(f"Temp cleanup failed: {e}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Decryption error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/check-wadecrypt")
async def check_wadecrypt():
    """Check if wadecrypt is installed and available"""
    installed = check_wadecrypt_installed()
    return {
        "installed": installed,
        "message": "wa-crypt-tools is installed" if installed else "wa-crypt-tools not found. Install with: pip install wa-crypt-tools"
    }

# ─── INIT (open database) ─────────────────────────────────────────────────────
@app.post("/api/init")
async def initialize_database(request: InitRequest):
    global db_manager, imported_chat_cache, imported_media_path
    try:
        validated_db_path  = validate_db_path(request.db_path)
        validated_media_path = validate_media_path(request.media_path)
        await create_indexes(str(validated_db_path))
        await analyze_database(str(validated_db_path))
        db_manager = DatabaseManager(
            str(validated_db_path),
            str(validated_media_path) if validated_media_path else None,
        )
        await db_manager.init()
        db_manager.start_search_index()
        imported_chat_cache = None
        imported_media_path = None
        logger.info("Database initialized successfully")
        return {"status": "success", "message": "Database initialized",
                "media_available": validated_media_path is not None}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Initialization failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search/index-status")
async def search_index_status():
    fts = getattr(db_manager, "fts", None) if db_manager else None
    return fts.status() if fts else {"state": "none", "indexed_messages": 0, "error": None}

# ─── IMPORT (.wachat file) ────────────────────────────────────────────────────
@app.post("/api/import")
async def import_chat(request: ImportChatRequest):
    global imported_chat_cache, db_manager, imported_media_path

    chat_path = Path(request.chat_path)
    if not chat_path.exists() or not chat_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {request.chat_path}")

    try:
        with open(chat_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot read file: {e}")

    if 'messages' not in data:
        raise HTTPException(
            status_code=400,
            detail="Invalid .wachat file — 'messages' key missing."
        )

    _drop_dangling_quote_refs(data)
    imported_chat_cache = data
    db_manager = None
    imported_media_path = None
    chat_name     = data.get('chat_name', 'Imported Chat')
    message_count = len(data['messages'])

    logger.info(f"Imported '{chat_name}' — {message_count} messages")
    return {"chat_name": chat_name, "message_count": message_count, 
            "media_available": False}

# ─── MEDIA CONFIGURE ──────────────────────────────────────────────────────────
@app.post("/api/media/configure")
async def configure_media_path(request: MediaConfigRequest):
    global db_manager, imported_media_path
    
    try:
        validated = validate_media_path(request.media_path)
        if not validated:
            raise HTTPException(status_code=400, detail="Invalid media path")
        
        if db_manager:
            db_manager.media_path = validated
            logger.info(f"Media path configured (database mode): {validated}")
        else:
            imported_media_path = validated
            logger.info(f"Media path configured (import mode): {validated}")
        
        return {"status": "success", "media_path": str(validated)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── CHATS ────────────────────────────────────────────────────────────────────
@app.get("/api/chats")
async def get_chats() -> List[Chat]:
    if imported_chat_cache is not None:
        messages = imported_chat_cache.get('messages', [])
        last_ts  = messages[-1]['timestamp'] if messages else 0
        return [Chat(
            id=IMPORTED_CHAT_ID,
            name=imported_chat_cache.get('chat_name', 'Imported Chat'),
            message_count=len(messages),
            last_message_time=last_ts,
        )]
    
    if not db_manager:
        raise HTTPException(status_code=400, detail="Database not initialized")
    try:
        chat_list = await db_manager.get_chats()
        return [
            Chat(id=c['id'], name=c['name'], message_count=c['message_count'],
                 last_message_time=c['last_message_time'])
            for c in chat_list
        ]
    except Exception as e:
        logger.error(f"Failed to get chats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# ─── MESSAGES ─────────────────────────────────────────────────────────────────
@app.get("/api/chats/{chat_id}/messages")
async def get_messages(
    chat_id: int,
    limit: int = Query(100, ge=1, le=500),
    cursor: Optional[int] = Query(None),
    direction: str = Query("after", pattern="^(after|before)$"),
) -> MessagePage:
    if chat_id == IMPORTED_CHAT_ID and imported_chat_cache is not None:
        all_msgs = imported_chat_cache.get('messages', [])
        total_count = len(all_msgs)
        
        if cursor is None:
            messages = all_msgs[-limit:] if len(all_msgs) > limit else all_msgs
            next_cursor = None
            prev_cursor = messages[0]['timestamp'] if messages else None
        elif direction == "after":
            idx = next((i for i, m in enumerate(all_msgs) if m['timestamp'] > cursor), None)
            if idx is None:
                messages = []
            else:
                messages = all_msgs[idx:idx + limit]
            next_cursor = messages[-1]['timestamp'] if messages and idx + limit < len(all_msgs) else None
            prev_cursor = messages[0]['timestamp'] if messages else None
        else:
            idx = next((i for i in range(len(all_msgs) - 1, -1, -1) 
                       if all_msgs[i]['timestamp'] < cursor), None)
            if idx is None:
                messages = []
            else:
                start = max(0, idx - limit + 1)
                messages = all_msgs[start:idx + 1]
            next_cursor = messages[-1]['timestamp'] if messages else None
            prev_cursor = messages[0]['timestamp'] if messages and start > 0 else None
        
        return MessagePage(messages=[_imported_msg_to_message(m) for m in messages],
                          has_more=prev_cursor is not None or next_cursor is not None,
                          next_cursor=next_cursor, prev_cursor=prev_cursor,
                          total_count=total_count)
    
    if not db_manager:
        raise HTTPException(status_code=400, detail="Database not initialized")
    if chat_id < 0:
        raise HTTPException(status_code=400, detail="Invalid chat_id")
    try:
        total_count = await db_manager.get_message_count(chat_id)
        messages, next_cursor, prev_cursor = await db_manager.get_messages_page(
            chat_id, limit, cursor, direction)
        if not messages:
            return MessagePage(messages=[], has_more=False, next_cursor=None,
                              prev_cursor=None, total_count=total_count)
        message_ids = [msg['_id'] for msg in messages]
        media_dict  = await db_manager.get_media_for_messages(message_ids)
        quotes_dict = await db_manager.get_quoted_messages(message_ids, chat_id)
        result = []
        for msg in messages:
            mid = msg['_id']
            qt  = quotes_dict.get(mid, {})
            result.append(Message(
                id=mid, timestamp=msg['timestamp'], from_me=bool(msg['from_me']),
                text=msg.get('text_data'), message_type=msg['message_type'],
                quoted_text=qt.get('text'), quoted_key_id=qt.get('key_id'),
                quoted_message_id=qt.get('message_id'),
                media=[
                    MediaItem(file_path=m.get('file_path'), media_name=m.get('media_name'),
                              mime_type=m.get('mime_type'), caption=m.get('media_caption'))
                    for m in media_dict.get(mid, [])
                ],
            ))
        return MessagePage(messages=result, has_more=len(messages) == limit or cursor is not None,
                           next_cursor=next_cursor, prev_cursor=prev_cursor,
                           total_count=total_count)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get messages: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# ─── SINGLE MESSAGE ───────────────────────────────────────────────────────────
# Used by the media gallery's "Show in chat" button: it only knows the message id,
# and jumping to a message needs the full message (text, media, quote).
@app.get("/api/chats/{chat_id}/messages/{message_id}")
async def get_message(chat_id: int, message_id: int) -> Message:
    if chat_id == IMPORTED_CHAT_ID and imported_chat_cache is not None:
        for m in imported_chat_cache.get('messages', []):
            if m.get('id') == message_id:
                return _imported_msg_to_message(m)
        raise HTTPException(status_code=404, detail="Message not found")

    if not db_manager:
        raise HTTPException(status_code=400, detail="Database not initialized")
    if chat_id < 0:
        raise HTTPException(status_code=400, detail="Invalid chat_id")
    try:
        msg = await db_manager.get_message_by_id(message_id)
        # also checks the message belongs to this chat
        if not msg or msg.get('chat_row_id') != chat_id:
            raise HTTPException(status_code=404, detail="Message not found")
        media_dict  = await db_manager.get_media_for_messages([message_id])
        quotes_dict = await db_manager.get_quoted_messages([message_id], chat_id)
        qt = quotes_dict.get(message_id, {})
        return Message(
            id=message_id, timestamp=msg['timestamp'], from_me=bool(msg['from_me']),
            text=msg.get('text_data'), message_type=msg['message_type'],
            quoted_text=qt.get('text'), quoted_key_id=qt.get('key_id'),
            quoted_message_id=qt.get('message_id'),
            media=[
                MediaItem(file_path=m.get('file_path'), media_name=m.get('media_name'),
                          mime_type=m.get('mime_type'), caption=m.get('media_caption'))
                for m in media_dict.get(message_id, [])
            ],
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get message {message_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# ─── SEARCH ───────────────────────────────────────────────────────────────────
@app.post("/api/chats/{chat_id}/search")
async def search_messages(chat_id: int, params: SearchParams):
    if chat_id == IMPORTED_CHAT_ID and imported_chat_cache is not None:
        all_msgs = imported_chat_cache.get('messages', [])
        filtered = all_msgs

        if params.query:
            pq = parse_query(params.query)
            filtered = [m for m in filtered if matches(searchable_text(m.get('text'), m.get('media')), pq)]
            if params.sort == "relevance":
                filtered = sorted(filtered, key=lambda m: (-score(searchable_text(m.get('text'), m.get('media')), pq), -m['timestamp']))

        if params.date_from:
            try:
                from datetime import datetime
                ts = int(datetime.fromisoformat(params.date_from).timestamp() * 1000)
                filtered = [m for m in filtered if m['timestamp'] >= ts]
            except Exception:
                pass

        if params.date_to:
            try:
                from datetime import datetime
                ts = int((datetime.fromisoformat(params.date_to) + timedelta(days=1)).timestamp() * 1000) - 1
                filtered = [m for m in filtered if m['timestamp'] <= ts]
            except Exception:
                pass

        total = len(filtered)
        page  = filtered[params.offset: params.offset + params.limit]
        return {"messages": [_imported_msg_to_message(m) for m in page],
                "total_count": total,
                "file_matches": file_matches(params.query, {m['id']: (m.get('media') or []) for m in page}, _active_media_root()),
                "has_more": (params.offset + params.limit) < total,
                "highlight": highlight_terms(params.query)}

    if not db_manager:
        raise HTTPException(status_code=400, detail="Database not initialized")
    if chat_id < 0:
        raise HTTPException(status_code=400, detail="Invalid chat_id")
    if not (1 <= params.limit <= 500):
        raise HTTPException(status_code=400, detail="Limit must be 1–500")
    if params.offset < 0:
        raise HTTPException(status_code=400, detail="Offset must be non-negative")
    try:
        messages, total_count = await db_manager.search_messages(
            chat_id, params.query, params.date_from, params.date_to,
            params.limit, params.offset, params.sort)
        message_ids = [msg['_id'] for msg in messages]
        media_dict  = await db_manager.get_media_for_messages(message_ids)
        quotes_dict = await db_manager.get_quoted_messages(message_ids, chat_id)
        result = []
        for msg in messages:
            mid = msg['_id']
            qt  = quotes_dict.get(mid, {})
            result.append(Message(
                id=mid, timestamp=msg['timestamp'], from_me=bool(msg['from_me']),
                text=msg.get('text_data'), message_type=msg['message_type'],
                quoted_text=qt.get('text'), quoted_key_id=qt.get('key_id'),
                quoted_message_id=qt.get('message_id'),
                media=[
                    MediaItem(file_path=m.get('file_path'), media_name=m.get('media_name'),
                              mime_type=m.get('mime_type'), caption=m.get('media_caption'))
                    for m in media_dict.get(mid, [])
                ],
            ))
        file_hits = file_matches(params.query, media_dict, _active_media_root())
        return {"messages": result, "total_count": total_count, "file_matches": file_hits,
                "has_more": (params.offset + params.limit) < total_count,
                "highlight": highlight_terms(params.query)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Search failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# ─── MEDIA GALLERY ────────────────────────────────────────────────────────────
@app.get("/api/chats/{chat_id}/media")
async def get_media_gallery(
    chat_id: int,
    type: Optional[str] = Query(None, pattern="^(all|images|videos|audios)$"),
):
    if chat_id == IMPORTED_CHAT_ID and imported_chat_cache is not None:
        from datetime import datetime
        
        all_msgs = imported_chat_cache.get('messages', [])
        media_items = []
        
        for msg in all_msgs:
            for media in (msg.get('media') or []):
                mime = media.get('mime_type') or ''
                
                if not mime:
                    continue
                
                if type == 'images' and not mime.startswith('image/'):
                    continue
                if type == 'videos' and not mime.startswith('video/'):
                    continue
                if type == 'audios' and not (mime.startswith('audio/') or mime == 'application/ogg'):
                    continue
                if type == 'all' and not (mime.startswith('image/') or mime.startswith('video/') or 
                                         mime.startswith('audio/') or mime == 'application/ogg'):
                    continue
                
                media_items.append({
                    'message_id': msg['id'],
                    'file_path': media.get('file_path'),
                    'media_name': media.get('media_name'),
                    'mime_type': mime,
                    'caption': media.get('caption') or media.get('media_caption'),
                    'timestamp': msg['timestamp']
                })
        
        media_by_month = {}
        for item in media_items:
            timestamp = item['timestamp']
            date = datetime.fromtimestamp(timestamp / 1000)
            month_key = date.strftime('%Y-%m')
            month_label = date.strftime('%B %Y')
            
            if month_key not in media_by_month:
                media_by_month[month_key] = {
                    'month': month_label,
                    'items': []
                }
            
            media_by_month[month_key]['items'].append(item)
        
        result = [
            {'month': v['month'], 'items': v['items']}
            for k, v in sorted(media_by_month.items(), reverse=True)
        ]
        
        return {"chat_id": chat_id, "filter": type or "all", "months": result}
    
    if not db_manager:
        raise HTTPException(status_code=400, detail="Database not initialized")
    try:
        media_type = None if type in ("all", None) else type
        media_data = await db_manager.get_media_gallery(chat_id, media_type)
        return {"chat_id": chat_id, "filter": type or "all", "months": media_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── EXPORT ───────────────────────────────────────────────────────────────────
@app.get("/api/chats/{chat_id}/export")
async def export_chat(chat_id: int, export_dir: str = ""):
    out_dir = Path(export_dir).expanduser() if export_dir else Path.home() / "Downloads"
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        if chat_id == IMPORTED_CHAT_ID and imported_chat_cache is not None:
            export_data = imported_chat_cache
        elif db_manager:
            export_data = await db_manager.export_chat(chat_id)
        else:
            raise HTTPException(status_code=400, detail="No data available to export")

        filename  = f"chat_{chat_id}_export.wachat"
        save_path = out_dir / filename
        counter   = 1
        while save_path.exists():
            save_path = out_dir / f"chat_{chat_id}_export_{counter}.wachat"
            counter  += 1

        with open(save_path, 'w', encoding='utf-8') as f:
            json.dump(export_data, f, ensure_ascii=False, indent=2)

        logger.info(f"Export saved: {save_path}")
        return {"status": "success", "saved_to": str(save_path), "filename": save_path.name}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Export failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# ─── EXPORT WITH MEDIA — STREAMING PROGRESS ──────────────────────────────────
@app.get("/api/chats/{chat_id}/export-media-stream")
async def export_chat_with_media_stream(chat_id: int, export_dir: str = ""):
    import zipfile as _zipfile
    from fastapi.responses import StreamingResponse as _StreamingResponse

    STORE_EXTS = {
        '.jpg','.jpeg','.png','.webp','.gif','.heic','.heif',
        '.mp4','.mov','.avi','.mkv','.webm','.3gp','.m4v',
        '.mp3','.ogg','.opus','.aac','.m4a','.amr','.weba',
    }

    async def generate():
        try:
            if chat_id == IMPORTED_CHAT_ID and imported_chat_cache is not None:
                export_data = imported_chat_cache
            elif db_manager:
                export_data = await db_manager.export_chat(chat_id)
            else:
                err_msg = json.dumps({"type": "error", "message": "No database loaded"})
                yield f"data: {err_msg}\n\n"
                return

            active_media_path = None
            if db_manager and db_manager.media_path:
                active_media_path = db_manager.media_path
            elif imported_media_path:
                active_media_path = imported_media_path

            media_files = []
            if active_media_path:
                base = active_media_path.resolve()
                seen: set = set()
                for msg in export_data.get("messages", []):
                    for item in msg.get("media", []):
                        raw = item.get("file_path") or item.get("media_name") or ""
                        if not raw or raw in seen:
                            continue
                        seen.add(raw)
                        cleaned  = strip_media_prefix(raw)
                        abs_path = (active_media_path / cleaned).resolve()
                        if str(abs_path).startswith(str(base)) and abs_path.is_file():
                            media_files.append((abs_path, f"media/{cleaned}"))

            total = len(media_files)
            start_msg = json.dumps({"type": "start", "total": total, "media_available": active_media_path is not None})
            yield f"data: {start_msg}\n\n"

            out_dir = Path(export_dir).expanduser() if export_dir else Path.home() / "Downloads"
            out_dir.mkdir(parents=True, exist_ok=True)
            base_name = f"chat_{chat_id}_export"
            zip_path  = out_dir / f"{base_name}.zip"
            counter   = 1
            while zip_path.exists():
                zip_path = out_dir / f"{base_name}_{counter}.zip"
                counter += 1

            skipped = 0
            zf = _zipfile.ZipFile(zip_path, 'w', _zipfile.ZIP_DEFLATED)
            try:
                zf.writestr(f"{base_name}.wachat",
                            json.dumps(export_data, ensure_ascii=False, indent=2))

                for i, (abs_path, zip_rel) in enumerate(media_files):
                    try:
                        ext = abs_path.suffix.lower()
                        compress = _zipfile.ZIP_STORED if ext in STORE_EXTS else _zipfile.ZIP_DEFLATED
                        zf.write(abs_path, zip_rel, compress_type=compress)
                    except Exception as e:
                        logger.warning(f"Skipping {abs_path}: {e}")
                        skipped += 1

                    if (i + 1) % 10 == 0 or (i + 1) == total:
                        prog_msg = json.dumps({"type": "progress", "current": i + 1, "total": total})
                        yield f"data: {prog_msg}\n\n"
                        await asyncio.sleep(0)
            finally:
                zf.close()

            bundled = total - skipped
            logger.info(f"Export ZIP: {zip_path} ({bundled} bundled, {skipped} skipped)")
            done_msg = json.dumps({"type": "done", "saved_to": str(zip_path), "filename": zip_path.name, "media_bundled": bundled, "media_skipped": skipped})
            yield f"data: {done_msg}\n\n"

        except Exception as e:
            logger.error(f"Stream export failed: {e}", exc_info=True)
            err_msg2 = json.dumps({"type": "error", "message": str(e)})
            yield f"data: {err_msg2}\n\n"

    return _StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ─── MEDIA FILES ──────────────────────────────────────────────────────────────
@app.get("/api/media/{media_path:path}")
async def get_media_file(media_path: str):
    active_media_path = None
    
    if db_manager and db_manager.media_path:
        active_media_path = db_manager.media_path
    elif imported_media_path:
        active_media_path = imported_media_path
    
    if not active_media_path:
        raise HTTPException(status_code=400, detail="Media path not configured")
    
    try:
        cleaned   = strip_media_prefix(media_path)
        # same lookup the search cards use, so 'found' there means it loads here
        requested = resolve_media_file(active_media_path, media_path)
        if requested is None:
            raise HTTPException(status_code=404, detail=f"Not found: {cleaned}")
        if not requested.is_file():
            raise HTTPException(status_code=400, detail="Not a file")
        return FileResponse(requested)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── HEALTH ───────────────────────────────────────────────────────────────────
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "database_initialized": db_manager is not None,
        "import_loaded": imported_chat_cache is not None,
        "media_configured": (db_manager and db_manager.media_path) or imported_media_path is not None,
        "wadecrypt_available": check_wadecrypt_installed(),
    }

# ─── ENTRY ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = 8765
    if len(sys.argv) > 2 and sys.argv[1] == "--port":
        try:
            port = int(sys.argv[2])
            if not (1024 <= port <= 65535):
                logger.error("Port must be between 1024 and 65535")
                sys.exit(1)
        except ValueError:
            logger.error("Invalid port number")
            sys.exit(1)
    logger.info(f"Starting server on port {port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
