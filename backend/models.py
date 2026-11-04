from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class Message(BaseModel):
    id: int
    timestamp: int
    from_me: bool
    text: Optional[str]
    message_type: int
    quoted_text: Optional[str] = None
    quoted_key_id: Optional[str] = None
    media: List['MediaItem'] = []

class MediaItem(BaseModel):
    file_path: Optional[str]
    media_name: Optional[str]
    mime_type: Optional[str]
    caption: Optional[str]
    thumbnail_path: Optional[str] = None  # We'll generate this
    size_bytes: Optional[int] = None

class Chat(BaseModel):
    id: int
    name: Optional[str] = None  # Can be None for deleted/unknown chats
    message_count: int
    last_message_time: int

class MessagePage(BaseModel):
    messages: List[Message]
    has_more: bool
    next_cursor: Optional[int]
    prev_cursor: Optional[int]
    total_count: int

class SearchParams(BaseModel):
    query: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    limit: int = 100
    offset: int = 0
    sort: str = "time"  # "time" = oldest first, "relevance" = best match first
