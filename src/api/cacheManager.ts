import { Message, Chat } from "./client";

const DB_NAME = "WhatsAppViewerCache";
const DB_VERSION = 1;
const MESSAGES_STORE = "messages";
const CHATS_STORE = "chats";
const MEDIA_STORE = "media";

class CacheManager {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        console.log("✅ IndexedDB cache initialized");
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Messages store with compound index
        if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
          const messageStore = db.createObjectStore(MESSAGES_STORE, {
            keyPath: "id",
          });
          messageStore.createIndex("chat_timestamp", ["chat_id", "timestamp"]);
          messageStore.createIndex("chat_id", "chat_id");
        }

        // Chats store
        if (!db.objectStoreNames.contains(CHATS_STORE)) {
          db.createObjectStore(CHATS_STORE, { keyPath: "id" });
        }

        // Media store for thumbnails
        if (!db.objectStoreNames.contains(MEDIA_STORE)) {
          const mediaStore = db.createObjectStore(MEDIA_STORE, {
            keyPath: "path",
          });
          mediaStore.createIndex("message_id", "message_id");
        }

        console.log("🔨 IndexedDB stores created");
      };
    });
  }

  // Cache messages
  async cacheMessages(chatId: number, messages: Message[]): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction(MESSAGES_STORE, "readwrite");
    const store = tx.objectStore(MESSAGES_STORE);

    for (const message of messages) {
      const cachedMessage = {
        ...message,
        chat_id: chatId,
        cached_at: Date.now(),
      };
      store.put(cachedMessage);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log(`💾 Cached ${messages.length} messages for chat ${chatId}`);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // Get cached messages
  async getCachedMessages(
    chatId: number,
    limit: number = 100,
    cursor?: number,
    direction: "after" | "before" = "after"
  ): Promise<Message[] | null> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(MESSAGES_STORE, "readonly");
      const store = tx.objectStore(MESSAGES_STORE);
      const index = store.index("chat_timestamp");

      const messages: Message[] = [];
      let range: IDBKeyRange;

      if (cursor) {
        if (direction === "after") {
          range = IDBKeyRange.bound([chatId, cursor], [chatId, Infinity]);
        } else {
          range = IDBKeyRange.bound([chatId, 0], [chatId, cursor]);
        }
      } else {
        range = IDBKeyRange.bound([chatId, 0], [chatId, Infinity]);
      }

      const request = index.openCursor(range, direction === "before" ? "prev" : "next");

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
        if (cursor && messages.length < limit) {
          messages.push(cursor.value);
          cursor.continue();
        } else {
          console.log(`📂 Retrieved ${messages.length} cached messages`);
          resolve(messages.length > 0 ? messages : null);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // Cache chats list
  async cacheChats(chats: Chat[]): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction(CHATS_STORE, "readwrite");
    const store = tx.objectStore(CHATS_STORE);

    for (const chat of chats) {
      const cachedChat = {
        ...chat,
        cached_at: Date.now(),
      };
      store.put(cachedChat);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log(`💾 Cached ${chats.length} chats`);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // Get cached chats
  async getCachedChats(): Promise<Chat[] | null> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CHATS_STORE, "readonly");
      const store = tx.objectStore(CHATS_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const chats = request.result;
        console.log(`📂 Retrieved ${chats.length} cached chats`);
        resolve(chats.length > 0 ? chats : null);
      };

      request.onerror = () => reject(request.error);
    });
  }

  // Cache media thumbnail
  async cacheMediaThumbnail(
    mediaPath: string,
    messageId: number,
    thumbnailData: string
  ): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction(MEDIA_STORE, "readwrite");
    const store = tx.objectStore(MEDIA_STORE);

    store.put({
      path: mediaPath,
      message_id: messageId,
      thumbnail: thumbnailData,
      cached_at: Date.now(),
    });

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Get cached media thumbnail
  async getCachedThumbnail(mediaPath: string): Promise<string | null> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(MEDIA_STORE, "readonly");
      const store = tx.objectStore(MEDIA_STORE);
      const request = store.get(mediaPath);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.thumbnail : null);
      };

      request.onerror = () => reject(request.error);
    });
  }

  // Clear all cache
  async clearCache(): Promise<void> {
    if (!this.db) await this.init();

    const stores = [MESSAGES_STORE, CHATS_STORE, MEDIA_STORE];
    const tx = this.db!.transaction(stores, "readwrite");

    for (const storeName of stores) {
      tx.objectStore(storeName).clear();
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log("🗑️ Cache cleared");
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // Get cache stats
  async getCacheStats(): Promise<{
    messages: number;
    chats: number;
    media: number;
  }> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(
        [MESSAGES_STORE, CHATS_STORE, MEDIA_STORE],
        "readonly"
      );

      let stats = { messages: 0, chats: 0, media: 0 };
      let completed = 0;

      const checkComplete = () => {
        completed++;
        if (completed === 3) resolve(stats);
      };

      tx.objectStore(MESSAGES_STORE)
        .count()
        .onsuccess = (e) => {
          stats.messages = (e.target as IDBRequest).result;
          checkComplete();
        };

      tx.objectStore(CHATS_STORE)
        .count()
        .onsuccess = (e) => {
          stats.chats = (e.target as IDBRequest).result;
          checkComplete();
        };

      tx.objectStore(MEDIA_STORE)
        .count()
        .onsuccess = (e) => {
          stats.media = (e.target as IDBRequest).result;
          checkComplete();
        };

      tx.onerror = () => reject(tx.error);
    });
  }
}

export const cacheManager = new CacheManager();
