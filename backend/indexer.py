"""
Database indexer - creates optimized indexes on startup
Run once when app starts to ensure fast queries
"""
import aiosqlite
import logging

logger = logging.getLogger(__name__)

async def create_indexes(db_path: str):
    """Create performance indexes if they don't exist"""
    
    indexes = [
        # Critical indexes for pagination
        ("idx_message_chat_timestamp", 
         "CREATE INDEX IF NOT EXISTS idx_message_chat_timestamp ON message(chat_row_id, timestamp)"),
        
        ("idx_message_timestamp", 
         "CREATE INDEX IF NOT EXISTS idx_message_timestamp ON message(timestamp)"),
        
        ("idx_message_id", 
         "CREATE INDEX IF NOT EXISTS idx_message_id ON message(_id)"),
        
        # Index for media lookups
        ("idx_media_message", 
         "CREATE INDEX IF NOT EXISTS idx_media_message ON message_media(message_row_id)"),
        
        ("idx_media_chat", 
         "CREATE INDEX IF NOT EXISTS idx_media_chat ON message_media(chat_row_id)"),
        
        # Index for quoted messages
        ("idx_quoted_message", 
         "CREATE INDEX IF NOT EXISTS idx_quoted_message ON message_quoted(message_row_id)"),

        # Reply -> original message: quoted rows only store the original's key_id
        ("idx_message_key_id",
         "CREATE INDEX IF NOT EXISTS idx_message_key_id ON message(key_id)"),
    ]
    
    async with aiosqlite.connect(db_path) as db:
        for name, sql in indexes:
            try:
                await db.execute(sql)
                logger.info(f"✓ Index created: {name}")
            except Exception as e:
                logger.warning(f"✗ Index {name} failed: {e}")
        
        await db.commit()

    # Full-text search: see fts_index.py (separate file; the user's database is not modified for it)

async def analyze_database(db_path: str):
    """Run ANALYZE to update query planner statistics"""
    async with aiosqlite.connect(db_path) as db:
        await db.execute("ANALYZE")
        await db.commit()
        logger.info("✓ Database analyzed")