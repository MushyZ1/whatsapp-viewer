import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import ChatList from "./components/ChatList";
import MessageList from "./components/MessageList";
import MediaGallery from "./components/MediaGallery";
import SearchBar from "./components/SearchBar";
import MessageBubble from "./components/MessageBubble";
import { useMessages } from "./hooks/useMessages";
import { api, Message, Chat } from "./api/client";
import "./styles/chat.css";

type InitMode = "database" | "import" | "decrypt" | null;

function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initMode, setInitMode] = useState<InitMode>(null);
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [searchHighlight, setSearchHighlight] = useState<string[]>([]);
  // message id -> attached files that matched the search (name, location, exists)
  const [fileMatches, setFileMatches] = useState<Record<string, { name: string; path: string | null; location: string | null; exists: boolean | null }[]>>({});
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const lastSearchRef = useRef<{ query: string; dateFrom?: string; dateTo?: string; sort: "time" | "relevance" } | null>(null);
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [mediaFolderStatus, setMediaFolderStatus] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  // id -> display name, filled by ChatList once it has loaded the chats.
  const [chatNameMap, setChatNameMap] = useState<Record<number, string>>({});

  // Decrypt mode states
  const [encryptedDbPath, setEncryptedDbPath] = useState<string>("");
  const [encryptionKey, setEncryptionKey] = useState<string>("");
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptStatus, setDecryptStatus] = useState<string | null>(null);

  const {
    messages, isLoading, loadMore, hasMoreUp, hasMoreDown,
    totalCount, highlightedMessageId, jumpToMessage, jumpToTop, jumpToBottom,
    jumpNonce,
  } = useMessages(selectedChatId);

  const handleChatsLoaded = useCallback((loaded: Chat[]) => {
    const map: Record<number, string> = {};
    loaded.forEach(c => { map[c.id] = c.name || `Chat ${c.id}`; });
    setChatNameMap(map);
  }, []);

  const addDebug = (msg: string) => {
    const ts   = new Date().toLocaleTimeString();
    const line = `${ts}: ${msg}`;
    console.log(`[DEBUG] ${line}`);
    setDebugLog(prev => [...prev.slice(-100), line]);
  };

  // ─── DATABASE INIT ──────────────────────────────────────────────────────────
  const handleDatabaseInit = async () => {
    setIsInitializing(true);
    setInitError(null);
    setDebugLog([]);
    try {
      addDebug("Opening file picker...");
      const dbPath = await invoke<string>("select_database");
      addDebug(`Database: ${dbPath}`);

      addDebug("Waiting for backend...");
      const ok = await api.waitForBackend(10000);
      if (!ok) throw new Error("Backend failed to start. Please try again or restart the app.");

      addDebug("Initializing...");
      const result = await api.initDatabase(dbPath, undefined);
      addDebug(`Done: ${JSON.stringify(result)}`);

      setIsInitialized(true);
      setMediaFolderStatus(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInitError(msg);
      addDebug(`Failed: ${msg}`);
    } finally {
      setIsInitializing(false);
    }
  };

  // ─── IMPORT .wachat ─────────────────────────────────────────────────────────
  const handleImportChat = async () => {
    setIsInitializing(true);
    setInitError(null);
    setDebugLog([]);
    try {
      addDebug("Opening file picker...");
      const chatPath = await invoke<string>("select_chat_import");
      addDebug(`File: ${chatPath}`);
      addDebug("Importing...");
      const result = await api.importChat(chatPath);
      addDebug(`Imported: ${result.chat_name}, ${result.message_count} messages`);
      setIsInitialized(true);
      setMediaFolderStatus(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInitError(msg);
      addDebug(`Failed: ${msg}`);
    } finally {
      setIsInitializing(false);
    }
  };

  // ─── DECRYPT DATABASE ───────────────────────────────────────────────────────
  const handleSelectEncryptedDb = async () => {
    try {
      const path = await invoke<string>("select_encrypted_database");
      setEncryptedDbPath(path);
      addDebug(`Selected encrypted DB: ${path}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes("cancel")) {
        setInitError(msg);
      }
    }
  };

  const handleDecrypt = async () => {
    if (!encryptedDbPath || !encryptionKey.trim()) {
      setInitError("Please select an encrypted database and enter the encryption key");
      return;
    }

    setIsDecrypting(true);
    setInitError(null);
    setDecryptStatus(null);

    try {
      addDebug("Starting decryption...");
      setDecryptStatus("Checking wa-crypt-tools...");
      
      const checkResult = await api.checkWadecrypt();
      if (!checkResult.installed) {
        setDecryptStatus("Installing wa-crypt-tools... This may take a minute...");
        addDebug("wa-crypt-tools not found, will auto-install during decryption");
      }

      setDecryptStatus("Decrypting database... This may take a minute...");
      const result = await api.decryptDatabase(encryptedDbPath, encryptionKey);
      
      addDebug(`✅ Decrypted successfully: ${result.decrypted_path}`);
      setDecryptStatus(`✅ Decryption successful!\n\nDecrypted database saved to:\n${result.decrypted_path}\n\nSize: ${result.size_mb} MB`);
      
      // Auto-open the decrypted database
      setTimeout(async () => {
        try {
          await api.initDatabase(result.decrypted_path, undefined);
          setIsInitialized(true);
          setInitMode(null);
        } catch (err) {
          addDebug(`Auto-init failed: ${err}`);
        }
      }, 2000);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInitError(msg);
      addDebug(`Decryption failed: ${msg}`);
      setDecryptStatus(null);
    } finally {
      setIsDecrypting(false);
    }
  };

  // ─── MEDIA FOLDER ───────────────────────────────────────────────────────────
  const handleAddMedia = async () => {
    try {
      addDebug("Opening media folder picker...");
      const mediaPath = await invoke<string>("select_media_folder");
      addDebug(`Folder: ${mediaPath}`);
      const result = await api.setMediaPath(mediaPath);
      addDebug(`Media configured: ${JSON.stringify(result)}`);
      setMediaFolderStatus(`configured:${mediaPath}`);
      // re-run the last search so the file cards show the exact paths right away
      const last = lastSearchRef.current;
      if (last && searchResults) { void handleSearch(last.query, last.dateFrom, last.dateTo, last.sort); }
      alert("Media folder configured!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addDebug(`Media setup: ${msg}`);
      if (!msg.toLowerCase().includes("cancel") && !msg.toLowerCase().includes("no file")) {
        alert(`Media folder failed:\n\n${msg}`);
      }
    }
  };

  // ─── CHAT SELECT ────────────────────────────────────────────────────────────
  const handleChatSelect = (chatId: number) => {
    addDebug(`Selected chat ${chatId}`);
    setSelectedChatId(chatId);
    setSearchResults(null);
    setShowMediaGallery(false);
  };

  // ─── SEARCH ─────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async (query: string, dateFrom?: string, dateTo?: string, sort: "time" | "relevance" = "time") => {
    if (!selectedChatId) return;
    if (!query && !dateFrom && !dateTo) { setSearchResults(null); return; }
    setIsSearching(true);
    try {
      addDebug(`Search: "${query}" from=${dateFrom} to=${dateTo}`);
      const result = await api.searchMessages(selectedChatId, query || undefined, dateFrom, dateTo, 100, 0, sort);
      addDebug(`Found ${result.messages.length} results`);
      setSearchResults(result.messages);
      setSearchTotal(typeof result.total_count === "number" ? result.total_count : result.messages.length);
      setSearchHighlight(Array.isArray(result.highlight) ? result.highlight : []);
      setFileMatches(result.file_matches && typeof result.file_matches === "object" ? result.file_matches : {});
      lastSearchRef.current = { query, dateFrom, dateTo, sort };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      addDebug(`Search failed: ${msg}`);
      alert(`Search failed: ${msg}`);
    } finally {
      setIsSearching(false);
    }
  }, [selectedChatId]);

  const handleLoadMoreResults = async () => {
    const last = lastSearchRef.current;
    if (!selectedChatId || !last || !searchResults || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const more = await api.searchMessages(
        selectedChatId, last.query || undefined, last.dateFrom, last.dateTo,
        100, searchResults.length, last.sort,
      );
      addDebug(`Loaded ${more.messages.length} more results`);
      setFileMatches(prev => ({ ...prev, ...(more.file_matches || {}) }));
      setSearchResults(prev => {
        if (!prev) return prev;
        const seen = new Set(prev.map(m => m.id));
        return [...prev, ...more.messages.filter((m: Message) => !seen.has(m.id))];
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      addDebug(`Load more failed: ${msg}`);
      alert(`Could not load more results: ${msg}`);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleJumpToMessage = (message: Message) => {
    if (!selectedChatId) return;
    addDebug(`Jump to msg ${message.id}`);
    setSearchResults(null);
    setShowMediaGallery(false);
    jumpToMessage(message);
  };

  // ─── EXPORT ─────────────────────────────────────────────────────────────────
  const handleExportChat = async (includeMedia = false) => {
    if (!selectedChatId) return;
    // Ask user where to save
    let exportDir = "";
    try {
      exportDir = await invoke<string>("select_export_folder");
    } catch {
      return; // user cancelled folder picker
    }

    if (includeMedia) {
      const abort = new AbortController();
      exportAbortRef.current = abort;
      setExportProgress({ current: 0, total: 0 });
      addDebug(`Exporting chat ${selectedChatId} with media to ${exportDir}...`);
      await api.exportChatWithMedia(
        selectedChatId,
        exportDir,
        (current, total) => setExportProgress({ current, total }),
        (result) => {
          setExportProgress(null);
          exportAbortRef.current = null;
          addDebug(`Saved: ${result.saved_to}`);
          const skipped = result.media_skipped > 0 ? `, ${result.media_skipped} missing/skipped` : "";
          alert(`Chat + Media exported!\n\nSaved to:\n${result.saved_to}\n\n📁 ${result.media_bundled} files bundled${skipped}.\n\nUnzip and share the .wachat + media/ folder.`);
        },
        (msg) => {
          setExportProgress(null);
          exportAbortRef.current = null;
          addDebug(`Export failed: ${msg}`);
          alert(`Export failed: ${msg}`);
        },
        abort.signal,
      );
      return;
    }
    try {
      addDebug(`Exporting chat ${selectedChatId} to ${exportDir}...`);
      const result = await api.exportChat(selectedChatId, exportDir);
      addDebug(`Saved: ${result.saved_to}`);
      alert(`Chat exported!\n\nSaved to:\n${result.saved_to}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addDebug(`Export failed: ${msg}`);
      alert(`Export failed: ${msg}`);
    }
  };

  // ─── INIT SCREEN — mode selection ───────────────────────────────────────────
  if (!isInitialized && initMode === null) {
    return (
      <div className="init-screen">
        <div className="init-content">
          <div className="init-logo">💬</div>
          <h1>WhatsApp Viewer</h1>
          <p className="subtitle">View and search your WhatsApp chat history</p>
          
          <div className="init-mode-selection">
            <button className="init-mode-button decrypt" onClick={() => setInitMode("decrypt")}>
              <div className="mode-icon">🔓</div>
              <div className="mode-title">Decrypt Database</div>
              <div className="mode-description">
                For encrypted WhatsApp backup files
              </div>
              <div className="mode-details">
                Decrypt <code>.crypt14</code> or <code>.crypt15</code> files using your 64-digit encryption key
              </div>
            </button>

            <button className="init-mode-button database" onClick={() => setInitMode("database")}>
              <div className="mode-icon">📁</div>
              <div className="mode-title">Open Database</div>
              <div className="mode-description">
                For decrypted WhatsApp database
              </div>
              <div className="mode-details">
                Open <code>msgstore.db</code> files directly
              </div>
            </button>

            <button className="init-mode-button import" onClick={() => setInitMode("import")}>
              <div className="mode-icon">📥</div>
              <div className="mode-title">Import Chat</div>
              <div className="mode-description">
                For exported .wachat files
              </div>
              <div className="mode-details">
                Import chats exported from this app
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── DECRYPT MODE SCREEN ─────────────────────────────────────────────────────
  if (initMode === "decrypt") {
    return (
      <div className="init-screen">
        <div className="init-content decrypt-content">
          <button className="back-button" onClick={() => { setInitMode(null); setInitError(null); setDecryptStatus(null); }}>
            ← Back
          </button>

          <div className="decrypt-header">
            <div className="mode-icon large">🔓</div>
            <h1>Decrypt WhatsApp Database</h1>
          </div>

          <div className="decrypt-form">
            <div className="instruction-box">
              <h3>📋 Instructions</h3>
              <ol>
                <li>
                  <strong>Find encrypted database:</strong>
                  <br/>On your phone: <code>/WhatsApp/Databases/msgstore.db.crypt15</code>
                  <br/><small>Copy this file to your computer</small>
                </li>
                <li>
                  <strong>Get 64-digit encryption key:</strong>
                  <br/>Open WhatsApp → Settings → Chats → Chat backup → End-to-end encrypted backup
                  <br/><small>Copy the 64-digit key (or take a photo of the QR code and extract it)</small>
                </li>
                <li>
                  <strong>Select encrypted database file and enter key below</strong>
                </li>
              </ol>
            </div>

            <div className="form-group">
              <label>1. Select Encrypted Database File</label>
              <div className="file-selector">
                <button onClick={handleSelectEncryptedDb} className="select-file-btn">
                  📂 Select .crypt14/.crypt15 File
                </button>
                {encryptedDbPath && (
                  <div className="selected-file">{encryptedDbPath}</div>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>2. Enter 64-Digit Encryption Key</label>
              <input
                type="text"
                className="key-input"
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                value={encryptionKey}
                onChange={(e) => setEncryptionKey(e.target.value)}
                maxLength={79}
              />
              <small>Paste the 64-digit key from WhatsApp settings (dashes optional)</small>
            </div>

            {initError && (
              <div className="error-message">
                <p style={{ whiteSpace: 'pre-wrap' }}>{initError}</p>
              </div>
            )}

            {decryptStatus && (
              <div className="success-message">
                <p style={{ whiteSpace: 'pre-wrap' }}>{decryptStatus}</p>
              </div>
            )}

            <button
              onClick={handleDecrypt}
              disabled={isDecrypting || !encryptedDbPath || !encryptionKey.trim()}
              className="decrypt-button"
            >
              {isDecrypting ? "⏳ Decrypting..." : "🔓 Decrypt Database"}
            </button>

            <div className="requirement-note">
              <strong>ℹ️ Auto-Installation:</strong> The app will automatically install <code>wa-crypt-tools</code> if not present.
              <br/>If auto-install fails, you can manually install with: <code>pip install wa-crypt-tools</code>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── INIT SCREEN — loading ───────────────────────────────────────────────────
  if (!isInitialized) {
    return (
      <div className="init-screen">
        <div className="init-content">
          <button className="back-button" onClick={() => { setInitMode(null); setInitError(null); }}>
            ← Back
          </button>
          <h1>{initMode === "database" ? "📁 Select Database File" : "📥 Import Chat"}</h1>
          {initError && (
            <div className="error-message">
              <p style={{ whiteSpace: 'pre-wrap' }}>{initError}</p>
            </div>
          )}
          <button
            onClick={initMode === "database" ? handleDatabaseInit : handleImportChat}
            disabled={isInitializing}
            className="init-button"
          >
            {isInitializing
              ? "⏳ Loading..."
              : initMode === "database"
                ? "📂 Select File"
                : "📥 Select .wachat File"}
          </button>
          {debugLog.length > 0 && (
            <div className="debug-info">
              <h3>🪲 Log</h3>
              <div className="debug-log">
                {debugLog.map((l, i) => <div key={i} className="debug-line">{l}</div>)}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── MAIN APP ────────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      <ChatList onChatSelect={handleChatSelect} selectedChatId={selectedChatId} onChatsLoaded={handleChatsLoaded} />

      <div className="message-area">
        {selectedChatId ? (
          <>
            {/* Header */}
            <div className="message-header">
              <div className="message-header-left">
                <div className="message-header-avatar">
                  {(chatNameMap[selectedChatId] ?? String(selectedChatId))
                    .replace(/^[^\p{L}\p{N}]+/u, "").charAt(0).toUpperCase()}
                </div>
                <div className="message-header-info">
                  <h2>{chatNameMap[selectedChatId] ?? `Chat #${selectedChatId}`}</h2>
                  {!searchResults && !showMediaGallery && (
                    <div className="message-header-sub">{totalCount.toLocaleString()} messages</div>
                  )}
                </div>
              </div>

              <div className="header-actions">
                {mediaFolderStatus && (
                  <div className="media-status" title={mediaFolderStatus}>
                    Media: {mediaFolderStatus.startsWith("configured:") ? "✅" : "⚙"}
                  </div>
                )}
                <button className="action-button" onClick={() => setShowMediaGallery(!showMediaGallery)}>
                  {showMediaGallery ? "💬 Messages" : "🖼 Media"}
                </button>
                <button className="action-button" onClick={handleAddMedia} title="Set media folder">
                  ⚙️ Media
                </button>
                <button className="action-button" onClick={() => handleExportChat(false)} title="Export chat as .wachat file">
                  ⬇️ Export
                </button>
                <button className="action-button" onClick={() => handleExportChat(true)} title="Export chat + media files as .zip">
                  📦 +Media
                </button>
                <button
                  className={`action-button ${showDebugPanel ? 'active' : ''}`}
                  onClick={() => setShowDebugPanel(!showDebugPanel)}
                  title="Toggle debug panel"
                >
                  🪲 {debugLog.length}
                </button>
              </div>
            </div>

            {/* Search bar (hidden in media gallery view) */}
            {!showMediaGallery && (
              <SearchBar onSearch={handleSearch} isSearching={isSearching} />
            )}

            {/* Content area */}
            {showMediaGallery ? (
              <MediaGallery chatId={selectedChatId} />
            ) : searchResults ? (
              <div className="search-results">
                <div className="search-results-header">
                  <h3>🔍 {(searchTotal ?? searchResults.length).toLocaleString()} result{(searchTotal ?? searchResults.length) !== 1 ? 's' : ''}{searchTotal !== null && searchTotal > searchResults.length ? ` (showing ${searchResults.length.toLocaleString()})` : ''}</h3>
                  <button className="clear-search-button" onClick={() => setSearchResults(null)}>
                    ✕ Clear
                  </button>
                </div>
                {searchResults.length === 0 ? (
                  <div className="empty-state">No messages found</div>
                ) : (
                  <div className="message-list-simple">
                    {searchResults.map(message => (
                      <div key={message.id} className="search-result-item"
                           onClick={() => handleJumpToMessage(message)}>
                        <MessageBubble message={message} highlightTerms={searchHighlight} />
                        {(fileMatches[String(message.id)] || []).map((f, i) => (
                          <div
                            key={i}
                            style={{ margin: "4px 12px 8px", padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(128,128,128,0.35)", fontSize: "0.8rem", wordBreak: "break-all" }}
                          >
                            <div>
                              <strong>{f.name}</strong>
                              {" - "}
                              <span style={{ color: f.exists === true ? "#25a244" : f.exists === false ? "#d64545" : "inherit", opacity: f.exists == null ? 0.7 : 1 }}>
                                {f.exists === true ? "found in media folder" : f.exists === false ? "not found in media folder" : "media folder not set - click Media at the top"}
                              </span>
                            </div>
                            <div style={{ opacity: 0.8, userSelect: "text" }}>{f.location || f.path}</div>
                            <button
                              className="jump-button"
                              style={{ marginTop: 4 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                try { navigator.clipboard?.writeText(f.location || f.path || "")?.catch(() => {}); } catch { /* clipboard unavailable */ }
                              }}
                            >
                              Copy path
                            </button>
                          </div>
                        ))}
                        <button className="jump-button">↩ Jump to message</button>
                      </div>
                    ))}
                    {searchTotal !== null && searchResults.length < searchTotal && (
                      <button
                        className="jump-button"
                        style={{ margin: "12px auto", display: "block" }}
                        onClick={handleLoadMoreResults}
                        disabled={isLoadingMore}
                      >
                        {isLoadingMore ? "Loading..." : `Load more (${(searchTotal - searchResults.length).toLocaleString()} remaining)`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <MessageList
                messages={messages}
                onLoadMore={loadMore}
                onJumpToTop={jumpToTop}
                onJumpToBottom={jumpToBottom}
                isLoading={isLoading}
                hasMoreUp={hasMoreUp}
                hasMoreDown={hasMoreDown}
                highlightedMessageId={highlightedMessageId}
                jumpNonce={jumpNonce}
              />
            )}
          </>
        ) : (
          <div className="empty-chat-state">
            <div className="empty-content">
              <div className="empty-content-icon">💬</div>
              <h2>WhatsApp Viewer</h2>
              <p>Select a chat from the sidebar to start reading</p>
            </div>
          </div>
        )}
      </div>

      {/* Export progress overlay */}
      {exportProgress !== null && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
        }}>
          <div style={{
            background: "#1e2a35", borderRadius: 12, padding: "32px 40px",
            minWidth: 340, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.5)"
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📦</div>
            <div style={{ color: "#e9edef", fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
              Exporting media...
            </div>
            {exportProgress.total > 0 ? (
              <>
                <div style={{ color: "#8696a0", fontSize: 13, marginBottom: 12 }}>
                  {exportProgress.current} / {exportProgress.total} files
                </div>
                <div style={{ background: "#2a3942", borderRadius: 6, height: 8, overflow: "hidden" }}>
                  <div style={{
                    background: "#00a884", height: "100%", borderRadius: 6,
                    width: `${Math.round((exportProgress.current / exportProgress.total) * 100)}%`,
                    transition: "width 0.2s"
                  }} />
                </div>
                <div style={{ color: "#8696a0", fontSize: 12, marginTop: 8 }}>
                  {Math.round((exportProgress.current / exportProgress.total) * 100)}%
                </div>
              </>
            ) : (
              <div style={{ color: "#8696a0", fontSize: 13 }}>Preparing files...</div>
            )}
            <button
              onClick={() => { exportAbortRef.current?.abort(); setExportProgress(null); }}
              style={{
                marginTop: 20, background: "transparent", border: "1px solid #8696a0",
                color: "#8696a0", borderRadius: 6, padding: "6px 20px", cursor: "pointer", fontSize: 13
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Debug panel */}
      {showDebugPanel && (
        <div className="debug-panel">
          <div className="debug-panel-header">
            <h3>🪲 Debug Log ({debugLog.length})</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setDebugLog([])}>Clear</button>
              <button onClick={() => setShowDebugPanel(false)}>✕</button>
            </div>
          </div>
          <div className="debug-panel-content">
            {debugLog.map((msg, i) => <div key={i} className="debug-entry">{msg}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
