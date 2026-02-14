import { useState, useEffect } from "react";
import { api, Chat } from "../api/client";

interface ChatListProps {
  onChatSelect: (chatId: number) => void;
  selectedChatId: number | null;
}

export default function ChatList({ onChatSelect, selectedChatId }: ChatListProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadChats();
  }, []);

  const loadChats = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const chatList = await api.getChats();
      setChats(chatList);
      console.log(`✅ Loaded ${chatList.length} chats`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to load chats";
      setError(errorMsg);
      console.error("Failed to load chats:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const getAvatarLetter = (chat: Chat) => {
    if (chat.name) return chat.name.charAt(0).toUpperCase();
    return String(chat.id).charAt(0);
  };

  // Avatar color based on chat id for visual variety
  const getAvatarColor = (id: number) => {
    const colors = [
      '#00a884', '#25d366', '#128c7e', '#075e54',
      '#34b7f1', '#0070ba', '#7d3cff', '#e91e8c',
      '#ff6b35', '#f7b731'
    ];
    return colors[id % colors.length];
  };

  const filteredChats = searchQuery.trim()
    ? chats.filter(c =>
        (c.name || `Chat ${c.id}`).toLowerCase().includes(searchQuery.toLowerCase())
      )
    : chats;

  if (isLoading) {
    return (
      <div className="chat-list">
        <div className="chat-list-header">
          <h2>WhatsApp</h2>
        </div>
        <div className="loading-state">Loading chats...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="chat-list">
        <div className="chat-list-header">
          <h2>WhatsApp</h2>
        </div>
        <div className="error-state">
          <p>{error}</p>
          <button onClick={loadChats}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-list">
      <div className="chat-list-header">
        <h2>WhatsApp</h2>
        <span className="chat-count-badge">{chats.length}</span>
      </div>

      <div className="chat-list-search-wrap">
        <input
          type="text"
          className="chat-list-search"
          placeholder="Search or start new chat"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="chat-list-scroll">
        {filteredChats.length === 0 && (
          <div className="empty-state">No chats found</div>
        )}
        {filteredChats.map((chat) => (
          <div
            key={chat.id}
            className={`chat-item ${selectedChatId === chat.id ? 'active' : ''}`}
            onClick={() => onChatSelect(chat.id)}
          >
            <div
              className="chat-avatar"
              style={{ background: getAvatarColor(chat.id) }}
            >
              {getAvatarLetter(chat)}
            </div>
            <div className="chat-details">
              <div className="chat-details-row">
                <div className="chat-name">{chat.name || `Chat ${chat.id}`}</div>
                {chat.last_message_time > 0 && (
                  <div className="chat-time">{formatDate(chat.last_message_time)}</div>
                )}
              </div>
              <div className="chat-info">
                {chat.message_count.toLocaleString()} messages
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
