const API_BASE = "http://127.0.0.1:8765/api";

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out — is the backend running?');
    }
    throw error;
  }
}

export interface Message {
  id: number;
  timestamp: number;
  from_me: boolean;
  text: string | null;
  message_type: number;
  quoted_text?: string | null;
  quoted_key_id?: string | null;
  media: MediaItem[];
}

export interface MediaItem {
  file_path: string | null;
  media_name: string | null;
  mime_type: string | null;
  caption: string | null;
}

export interface MessagePage {
  messages: Message[];
  has_more: boolean;
  next_cursor: number | null;
  prev_cursor: number | null;
  total_count: number;
}

export interface Chat {
  id: number;
  name: string | null;
  message_count: number;
  last_message_time: number;
}

export const api = {
  async checkBackend(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${API_BASE.replace('/api', '')}/health`, {}, 3000);
      return res.ok;
    } catch { return false; }
  },

  async waitForBackend(timeoutMs = 10000): Promise<boolean> {
    const interval = 500;
    const attempts = timeoutMs / interval;
    for (let i = 0; i < attempts; i++) {
      if (await this.checkBackend()) return true;
      await new Promise(r => setTimeout(r, interval));
    }
    return false;
  },

  async checkWadecrypt(): Promise<{ installed: boolean; message: string }> {
    const res = await fetchWithTimeout(`${API_BASE}/check-wadecrypt`);
    if (!res.ok) throw new Error('Failed to check wadecrypt');
    return res.json();
  },

  async decryptDatabase(encryptedDbPath: string, encryptionKey: string): Promise<{
    status: string;
    message: string;
    decrypted_path: string;
    size_mb: number;
  }> {
    const res = await fetchWithTimeout(`${API_BASE}/decrypt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        encrypted_db_path: encryptedDbPath,
        encryption_key: encryptionKey
      }),
    }, 90000); // 90 second timeout for decryption

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Decryption failed: ${error}`);
    }
    return res.json();
  },

  async initDatabase(dbPath: string, mediaPath?: string) {
    const res = await fetchWithTimeout(`${API_BASE}/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ db_path: dbPath, media_path: mediaPath }),
    }, 30000);
    if (!res.ok) throw new Error(`Init failed: ${await res.text()}`);
    return res.json();
  },

  async setMediaPath(mediaPath: string) {
    const res = await fetchWithTimeout(`${API_BASE}/media/configure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_path: mediaPath }),
    });
    if (!res.ok) throw new Error(`Set media path failed: ${await res.text()}`);
    return res.json();
  },

  async importChat(chatPath: string) {
    const res = await fetchWithTimeout(`${API_BASE}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_path: chatPath }),
    }, 30000);
    if (!res.ok) throw new Error(`Import failed: ${await res.text()}`);
    return res.json();
  },

  async getChats(): Promise<Chat[]> {
    const res = await fetchWithTimeout(`${API_BASE}/chats`);
    if (!res.ok) throw new Error(`Fetch chats failed: ${await res.text()}`);
    return res.json();
  },

  async getMessages(
    chatId: number,
    limit = 100,
    cursor?: number,
    direction: "after" | "before" = "after",
  ): Promise<MessagePage> {
    const params = new URLSearchParams({ limit: limit.toString(), direction });
    if (cursor) params.append("cursor", cursor.toString());
    const res = await fetchWithTimeout(`${API_BASE}/chats/${chatId}/messages?${params}`);
    if (!res.ok) throw new Error(`Fetch messages failed: ${await res.text()}`);
    return res.json();
  },

  async searchMessages(
    chatId: number,
    query?: string,
    dateFrom?: string,
    dateTo?: string,
    limit = 100,
    offset = 0,
  ) {
    const res = await fetchWithTimeout(`${API_BASE}/chats/${chatId}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, date_from: dateFrom, date_to: dateTo, limit, offset }),
    });
    if (!res.ok) throw new Error(`Search failed: ${await res.text()}`);
    return res.json();
  },

  getMediaUrl(mediaPath: string): string {
    if (!mediaPath) { console.warn('getMediaUrl called with empty path'); return ''; }
    return `${API_BASE}/media/${encodeURIComponent(mediaPath)}`;
  },

  async getMediaGallery(chatId: number, type: "all" | "images" | "videos" | "audios" = "all") {
    const res = await fetchWithTimeout(`${API_BASE}/chats/${chatId}/media?type=${type}`, {}, 30000);
    if (!res.ok) throw new Error(`Gallery failed: ${await res.text()}`);
    return res.json();
  },

  async exportChat(chatId: number, exportDir = ""): Promise<{ saved_to: string; filename: string }> {
    const url = exportDir
      ? `${API_BASE}/chats/${chatId}/export?export_dir=${encodeURIComponent(exportDir)}`
      : `${API_BASE}/chats/${chatId}/export`;
    const res = await fetchWithTimeout(url, {}, 60000);
    if (!res.ok) throw new Error(`Export failed: ${await res.text()}`);
    return res.json();
  },

  async exportChatWithMedia(
    chatId: number,
    exportDir: string,
    onProgress: (current: number, total: number) => void,
    onDone: (result: { saved_to: string; filename: string; media_bundled: number; media_skipped: number }) => void,
    onError: (msg: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = exportDir
      ? `${API_BASE}/chats/${chatId}/export-media-stream?export_dir=${encodeURIComponent(exportDir)}`
      : `${API_BASE}/chats/${chatId}/export-media-stream`;
    const res = await fetch(url, { signal });
    if (!res.ok) { onError(`Export failed: ${await res.text()}`); return; }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.type === "progress") onProgress(evt.current, evt.total);
          else if (evt.type === "start")  onProgress(0, evt.total);
          else if (evt.type === "done")   onDone(evt);
          else if (evt.type === "error")  onError(evt.message);
        } catch { /* ignore malformed event */ }
      }
    }
  },
};
