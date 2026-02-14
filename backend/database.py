import aiosqlite
from typing import List, Optional, Tuple, Dict
from datetime import datetime
import logging
from pathlib import Path
import json
import re

logger = logging.getLogger(__name__)

class DatabaseManager:
    def __init__(self, db_path: str, media_path: Optional[str] = None):
        self.db_path = db_path
        self.media_path = Path(media_path) if media_path else None
        self.schema_cache = {}
        self._connection = None
    
    async def init(self):
        """Initialize database connection and detect schema"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            
            cursor = await db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='message_media'"
            )
            self.schema_cache['has_message_media'] = await cursor.fetchone() is not None
            
            cursor = await db.execute("PRAGMA table_info(message)")
            cols = await cursor.fetchall()
            self.schema_cache['message_columns'] = [row[1] for row in cols]
            
            if 'from_me' in self.schema_cache['message_columns']:
                self.schema_cache['from_me_col'] = 'from_me'
            elif 'key_from_me' in self.schema_cache['message_columns']:
                self.schema_cache['from_me_col'] = 'key_from_me'
            else:
                raise ValueError("Database missing from_me/key_from_me column")
            
            cursor = await db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='message_fts'"
            )
            self.schema_cache['has_fts'] = await cursor.fetchone() is not None
            
            logger.info(f"Schema detected: {self.schema_cache}")
    
    def _get_from_me_col(self) -> str:
        """Get the correct from_me column name"""
        return self.schema_cache.get('from_me_col', 'from_me')
    
    async def get_chats(self, limit: int = 1000) -> List[dict]:
        """Get all chats with message counts"""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            
            queries = [
                """
                SELECT c._id as id, 
                       COALESCE(c.subject, 'Chat ' || c._id) as name,
                       COUNT(m._id) as message_count, 
                       MAX(m.timestamp) as last_message_time
                FROM chat c 
                LEFT JOIN message m ON c._id = m.chat_row_id
                GROUP BY c._id 
                HAVING COUNT(m._id) > 0
                ORDER BY last_message_time DESC
                LIMIT ?
                """,
                """
                SELECT jid._id as id, 
                       COALESCE(jid.raw_string, 'Chat ' || jid._id) as name,
                       COUNT(message._id) as message_count,
                       MAX(message.timestamp) as last_message_time
                FROM jid 
                LEFT JOIN message ON jid._id = message.chat_row_id
                GROUP BY jid._id 
                HAVING COUNT(message._id) > 0
                ORDER BY last_message_time DESC
                LIMIT ?
                """
            ]
            
            for query in queries:
                try:
                    cursor = await db.execute(query, (limit,))
                    rows = await cursor.fetchall()
                    if rows:
                        return [dict(row) for row in rows]
                except Exception as e:
                    logger.debug(f"Query failed: {e}")
                    continue
            
            return []
    
    async def get_message_count(self, chat_id: int) -> int:
        """Get total message count for pagination"""
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "SELECT COUNT(*) FROM message WHERE chat_row_id = ?",
                (chat_id,)
            )
            result = await cursor.fetchone()
            return result[0] if result else 0
    
    async def get_messages_page(
        self,
        chat_id: int,
        limit: int = 100,
        cursor_timestamp: Optional[int] = None,
        direction: str = "after"
    ) -> Tuple[List[dict], Optional[int], Optional[int]]:
        """Get paginated messages using cursor-based pagination"""
        from_me_col = self._get_from_me_col()
        limit = min(max(1, limit), 500)
        
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            
            if cursor_timestamp is None:
                query = f"""
                SELECT _id, timestamp, {from_me_col} as from_me, 
                       text_data, message_type
                FROM message 
                WHERE chat_row_id = ?
                ORDER BY timestamp DESC
                LIMIT ?
                """
                cursor = await db.execute(query, (chat_id, limit))
                messages = await cursor.fetchall()
                messages = list(reversed([dict(row) for row in messages]))
                
            elif direction == "after":
                query = f"""
                SELECT _id, timestamp, {from_me_col} as from_me,
                       text_data, message_type
                FROM message 
                WHERE chat_row_id = ? AND timestamp > ?
                ORDER BY timestamp ASC
                LIMIT ?
                """
                cursor = await db.execute(query, (chat_id, cursor_timestamp, limit))
                messages = [dict(row) for row in await cursor.fetchall()]
                
            else:
                query = f"""
                SELECT _id, timestamp, {from_me_col} as from_me,
                       text_data, message_type
                FROM message 
                WHERE chat_row_id = ? AND timestamp < ?
                ORDER BY timestamp DESC
                LIMIT ?
                """
                cursor = await db.execute(query, (chat_id, cursor_timestamp, limit))
                messages = list(reversed([dict(row) for row in await cursor.fetchall()]))
            
            next_cursor = messages[-1]['timestamp'] if messages else None
            prev_cursor = messages[0]['timestamp'] if messages else None
            
            return messages, next_cursor, prev_cursor
    
    async def get_media_for_messages(self, message_ids: List[int]) -> dict:
        """Get media for multiple messages efficiently"""
        if not self.schema_cache.get('has_message_media') or not message_ids:
            return {}
        
        # SQLite has a limit of 999 variables, so batch the queries
        BATCH_SIZE = 900  # Safe margin below 999
        result = {}
        
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            
            # Process in batches
            for i in range(0, len(message_ids), BATCH_SIZE):
                batch = message_ids[i:i + BATCH_SIZE]
                placeholders = ','.join('?' * len(batch))
                query = f"""
                SELECT message_row_id, file_path, media_name, 
                       mime_type, media_caption
                FROM message_media 
                WHERE message_row_id IN ({placeholders})
                """
                
                cursor = await db.execute(query, tuple(batch))
                rows = await cursor.fetchall()
                
                for row in rows:
                    msg_id = row['message_row_id']
                    if msg_id not in result:
                        result[msg_id] = []
                    result[msg_id].append(dict(row))
            
            logger.info(f"✅ Loaded media for {len(message_ids)} messages in {(len(message_ids) + BATCH_SIZE - 1) // BATCH_SIZE} batches")
            return result
    
    async def get_quoted_messages(self, message_ids: List[int]) -> dict:
        """Get quoted/reply data for messages"""
        if not message_ids:
            return {}
        
        # SQLite has a limit of 999 variables, so batch the queries
        BATCH_SIZE = 900
        result = {}
        
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            
            # Process in batches
            for i in range(0, len(message_ids), BATCH_SIZE):
                batch = message_ids[i:i + BATCH_SIZE]
                placeholders = ','.join('?' * len(batch))
                query = f"""
                SELECT message_row_id, text_data, key_id
                FROM message_quoted 
                WHERE message_row_id IN ({placeholders})
                """
                
                try:
                    cursor = await db.execute(query, tuple(batch))
                    rows = await cursor.fetchall()
                    
                    for row in rows:
                        result[row['message_row_id']] = {
                            'text': row['text_data'],
                            'key_id': row['key_id']
                        }
                except Exception as e:
                    logger.warning(f"Failed to get quoted messages for batch: {e}")
                    continue
            
            return result
    
    def _prepare_search_query(self, query: str) -> str:
        """
        Prepare search query WhatsApp-style:
        - Match partial words
        - Match phrases
        - Case insensitive
        """
        # Remove extra spaces
        query = ' '.join(query.split())
        
        # Escape SQL wildcards
        query = query.replace('%', '\\%').replace('_', '\\_')
        
        # Split into words
        words = query.split()
        
        if len(words) == 1:
            # Single word: match partial
            return f"%{words[0]}%"
        else:
            # Multiple words: match as phrase
            return f"%{query}%"
    
    async def search_messages(
        self,
        chat_id: int,
        query: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[dict], int]:
        """
        Search messages with WhatsApp-style matching:
        - Partial word matching
        - Phrase matching
        - Case insensitive
        """
        from_me_col = self._get_from_me_col()
        limit = min(max(1, limit), 500)
        offset = max(0, offset)
        
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            
            if query:
                search_pattern = self._prepare_search_query(query)
                logger.info(f"ðŸ” Search pattern: '{query}' â†’ '{search_pattern}'")
                
                base_query = f"""
                SELECT _id, timestamp, {from_me_col} as from_me,
                       text_data, message_type
                FROM message
                WHERE chat_row_id = ? AND text_data LIKE ? ESCAPE '\\'
                """
                params = [chat_id, search_pattern]
            else:
                base_query = f"""
                SELECT _id, timestamp, {from_me_col} as from_me,
                       text_data, message_type
                FROM message
                WHERE chat_row_id = ?
                """
                params = [chat_id]
            
            if date_from:
                try:
                    date_timestamp = int(datetime.strptime(date_from, '%Y-%m-%d').timestamp() * 1000)
                    base_query += " AND timestamp >= ?"
                    params.append(date_timestamp)
                except ValueError:
                    logger.warning(f"Invalid date_from: {date_from}")
            
            if date_to:
                try:
                    date_timestamp = int(datetime.strptime(date_to, '%Y-%m-%d').timestamp() * 1000)
                    base_query += " AND timestamp <= ?"
                    params.append(date_timestamp)
                except ValueError:
                    logger.warning(f"Invalid date_to: {date_to}")
            
            try:
                count_query = base_query.replace(
                    f"SELECT _id, timestamp, {from_me_col} as from_me, text_data, message_type",
                    "SELECT COUNT(*)"
                )
                
                cursor = await db.execute(count_query, tuple(params))
                result = await cursor.fetchone()
                total_count = result[0] if result else 0
                
                logger.info(f"âœ… Search found {total_count} total matches")
            except Exception as e:
                logger.error(f"Count query failed: {e}")
                total_count = 0
            
            base_query += " ORDER BY timestamp ASC LIMIT ? OFFSET ?"
            params.extend([limit, offset])
            
            try:
                cursor = await db.execute(base_query, tuple(params))
                messages = [dict(row) for row in await cursor.fetchall()]
            except Exception as e:
                logger.error(f"Search query failed: {e}")
                messages = []
            
            return messages, total_count
    
    async def get_media_gallery(
        self,
        chat_id: int,
        media_type: Optional[str] = None
    ) -> List[Dict]:
        """Get all media from a chat, grouped by month"""
        if not self.schema_cache.get('has_message_media'):
            return []
        
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            
            query = """
            SELECT mm.message_row_id, mm.file_path, mm.media_name,
                   mm.mime_type, mm.media_caption, m.timestamp
            FROM message_media mm
            INNER JOIN message m ON mm.message_row_id = m._id
            WHERE m.chat_row_id = ?
            """
            params = [chat_id]
            
            if media_type == "images":
                query += " AND mm.mime_type LIKE 'image/%'"
            elif media_type == "videos":
                query += " AND mm.mime_type LIKE 'video/%'"
            elif media_type == "audios":
                query += " AND (mm.mime_type LIKE 'audio/%' OR mm.mime_type = 'application/ogg')"
            else:
                # "all" mode: only show real media, exclude NULL/unknown mime_types
                # WhatsApp stores thumbnail cache rows with NULL mime_type + numeric names
                query += """ AND mm.mime_type IS NOT NULL
                AND (
                    mm.mime_type LIKE 'image/%'
                    OR mm.mime_type LIKE 'video/%'
                    OR mm.mime_type LIKE 'audio/%'
                    OR mm.mime_type = 'application/ogg'
                )"""
            
            query += " ORDER BY m.timestamp DESC"
            
            cursor = await db.execute(query, tuple(params))
            rows = await cursor.fetchall()
            
            media_by_month = {}
            for row in rows:
                timestamp = row['timestamp']
                date = datetime.fromtimestamp(timestamp / 1000)
                month_key = date.strftime('%Y-%m')
                month_label = date.strftime('%B %Y')
                
                if month_key not in media_by_month:
                    media_by_month[month_key] = {
                        'month': month_label,
                        'items': []
                    }
                
                # Guess mime_type from extension if NULL
                mime = row['mime_type']
                if not mime:
                    fname = (row['file_path'] or row['media_name'] or '').lower()
                    if fname.endswith(('.jpg', '.jpeg')): mime = 'image/jpeg'
                    elif fname.endswith('.png'):           mime = 'image/png'
                    elif fname.endswith('.gif'):           mime = 'image/gif'
                    elif fname.endswith('.webp'):          mime = 'image/webp'
                    elif fname.endswith('.mp4'):           mime = 'video/mp4'
                    elif fname.endswith('.mov'):           mime = 'video/quicktime'
                    elif fname.endswith('.avi'):           mime = 'video/avi'
                    elif fname.endswith(('.mp3', '.m4a')): mime = 'audio/mp4'
                    elif fname.endswith('.opus'):          mime = 'audio/ogg; codecs=opus'
                    elif fname.endswith('.aac'):           mime = 'audio/aac'
                    elif fname.endswith('.ogg'):           mime = 'audio/ogg'

                # Skip items we still can't categorise
                if not mime:
                    logger.debug(f"Skipping media with no mime_type: {row['file_path'] or row['media_name']}")
                    continue

                media_by_month[month_key]['items'].append({
                    'message_id': row['message_row_id'],
                    'file_path': row['file_path'],
                    'media_name': row['media_name'],
                    'mime_type': mime,
                    'caption': row['media_caption'],
                    'timestamp': timestamp
                })
            
            result = [
                {'month': v['month'], 'items': v['items']}
                for k, v in sorted(media_by_month.items(), reverse=True)
            ]
            
            return result
    
    async def export_chat(self, chat_id: int) -> Dict:
        """Export entire chat to JSON format"""
        from_me_col = self._get_from_me_col()
        
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            
            chat_query = """
            SELECT _id as id, COALESCE(subject, 'Chat ' || _id) as name
            FROM chat WHERE _id = ?
            """
            try:
                cursor = await db.execute(chat_query, (chat_id,))
                chat_info = await cursor.fetchone()
                if not chat_info:
                    chat_query = """
                    SELECT _id as id, COALESCE(raw_string, 'Chat ' || _id) as name
                    FROM jid WHERE _id = ?
                    """
                    cursor = await db.execute(chat_query, (chat_id,))
                    chat_info = await cursor.fetchone()
                
                chat_name = dict(chat_info)['name'] if chat_info else f"Chat {chat_id}"
            except Exception as e:
                logger.error(f"Failed to get chat name: {e}")
                chat_name = f"Chat {chat_id}"
            
            messages_query = f"""
            SELECT _id, timestamp, {from_me_col} as from_me,
                   text_data, message_type
            FROM message
            WHERE chat_row_id = ?
            ORDER BY timestamp ASC
            """
            cursor = await db.execute(messages_query, (chat_id,))
            messages = [dict(row) for row in await cursor.fetchall()]
            
            message_ids = [msg['_id'] for msg in messages]
            media_dict = await self.get_media_for_messages(message_ids)
            quotes_dict = await self.get_quoted_messages(message_ids)
            
            export_data = {
                'version': '1.0',
                'export_date': datetime.now().isoformat(),
                'chat_id': chat_id,
                'chat_name': chat_name,
                'message_count': len(messages),
                'messages': []
            }
            
            for msg in messages:
                msg_id = msg['_id']
                export_msg = {
                    'id': msg_id,
                    'timestamp': msg['timestamp'],
                    'from_me': bool(msg['from_me']),
                    'text': msg.get('text_data'),
                    'message_type': msg['message_type'],
                    'media': media_dict.get(msg_id, []),
                    'quoted_text': quotes_dict.get(msg_id, {}).get('text'),
                    'quoted_key_id': quotes_dict.get(msg_id, {}).get('key_id')
                }
                export_data['messages'].append(export_msg)
            
            return export_data
    
    async def get_message_by_id(self, message_id: int) -> Optional[dict]:
        """Get a single message by ID"""
        from_me_col = self._get_from_me_col()
        
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            
            query = f"""
            SELECT _id, timestamp, {from_me_col} as from_me,
                   text_data, message_type, chat_row_id
            FROM message 
            WHERE _id = ?
            """
            
            cursor = await db.execute(query, (message_id,))
            row = await cursor.fetchone()
            return dict(row) if row else None
    
    async def get_message_position(self, chat_id: int, message_id: int) -> int:
        """Get the position/index of a message in the chat"""
        async with aiosqlite.connect(self.db_path) as db:
            query = """
            SELECT COUNT(*) FROM message 
            WHERE chat_row_id = ? AND timestamp <= (
                SELECT timestamp FROM message WHERE _id = ?
            )
            """
            cursor = await db.execute(query, (chat_id, message_id))
            result = await cursor.fetchone()
            return result[0] if result else 0
