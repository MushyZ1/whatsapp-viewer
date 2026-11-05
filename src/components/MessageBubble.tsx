import { useState, useRef, useEffect, useCallback } from "react";
import { Message, api } from "../api/client";
import { getMessageKind, systemText, deletedText, unsupportedText } from "../utils/messageKind";

interface MessageBubbleProps {
  message: Message;
  highlightTerms?: string[];
  /** "View in gallery": open attachment number `mediaIndex` of this message in the media gallery. */
  onViewInGallery?: (message: Message, mediaIndex: number) => void;
  /** Click on an image / video: open it in the full-screen viewer (which can step through the chat's media). */
  onOpenMedia?: (message: Message, mediaIndex: number) => void;
  /** Clicking a reply's quote: jump to the message it replies to. */
  onJumpToQuoted?: (messageId: number) => void;
}

// ─── WHATSAPP-STYLE AUDIO PLAYER ────────────────────────────────────────────
function InlineAudioPlayer({ src, mimeType, caption: _caption, messageId: _messageId, mediaPath, onError }:
  { src: string; mimeType: string; caption?: string | null; messageId: number; mediaPath: string; onError: () => void }) {

  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying]   = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]     = useState(0);
  const [speed, setSpeed]           = useState(1);
  const [loadError, setLoadError]   = useState(false);
  const [isDurationKnown, setIsDurationKnown] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onMeta = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        setIsDurationKnown(true);
      }
    };
    const onDurationChange = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        setIsDurationKnown(true);
      }
    };
    const onTime  = () => setCurrentTime(audio.currentTime);
    const onEnd   = () => { setIsPlaying(false); setCurrentTime(0); audio.currentTime = 0; };
    const onErr   = () => { setLoadError(true); onError(); };
    const onPlay  = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onErr);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onErr);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [onError]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); }
    else { try { await audio.play(); } catch (e) { console.error("Audio play failed:", e); } }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !isDurationKnown) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * duration;
  };

  const cycleSpeed = () => {
    const audio = audioRef.current;
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audio) audio.playbackRate = next;
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return "0:00";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  };

  const progress = isDurationKnown && duration > 0 ? (currentTime / duration) * 100 : 0;

  if (loadError) {
    return (
      <div className="audio-load-error">
        🎵 Audio unavailable — <span style={{color:"#ff6b6b"}}>check media folder</span>
        <div style={{fontSize:"0.75rem", opacity:0.7, marginTop:3}}>{mediaPath}</div>
      </div>
    );
  }

  return (
    <div className="inline-audio-player">
      <audio ref={audioRef} preload="metadata" src={src}>
        <source src={src} type={mimeType} />
      </audio>

      <button className="audio-play-btn" onClick={togglePlay} title={isPlaying ? "Pause" : "Play"}>
        {isPlaying
          ? <svg viewBox="0 0 24 24" fill="white" width="18" height="18"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          : <svg viewBox="0 0 24 24" fill="white" width="18" height="18"><polygon points="5,3 19,12 5,21"/></svg>
        }
      </button>

      <div className="audio-track-area">
        <div className="audio-scrubber" onClick={handleSeek} title="Click to seek">
          <div className="audio-scrubber-bg" />
          <div className="audio-scrubber-fill" style={{ width: `${progress}%` }} />
          <div className="audio-scrubber-thumb" style={{ left: `${progress}%` }} />
        </div>
        <div className="audio-times">
          <span>{fmt(currentTime)}</span>
          <span>{isDurationKnown ? fmt(duration) : "…"}</span>
        </div>
      </div>

      <button className="audio-speed-btn" onClick={cycleSpeed} title="Playback speed">
        {speed}x
      </button>
    </div>
  );
}

// ─── MEDIA ERROR DIALOG ───────────────────────────────────────────────────────
function MediaErrorDialog({ media, messageId, mediaUrl, onClose }:
  { media: any; messageId: number; mediaUrl: string; onClose: () => void }) {
  return (
    <div className="error-dialog-overlay" onClick={onClose}>
      <div className="error-dialog" onClick={e => e.stopPropagation()}>
        <div className="error-dialog-header">
          <h3>❌ Media Load Error</h3>
          <button className="error-dialog-x" onClick={onClose}>✕</button>
        </div>
        <div className="error-dialog-body">
          <div className="error-field"><label>Message ID</label><code>{messageId}</code></div>
          <div className="error-field"><label>File Path</label><code>{media.file_path || "—"}</code></div>
          <div className="error-field"><label>Media Name</label><code>{media.media_name || "—"}</code></div>
          <div className="error-field"><label>MIME Type</label><code>{media.mime_type || "unknown"}</code></div>
          <div className="error-field"><label>Request URL</label><code className="url-code">{mediaUrl}</code></div>
          <div className="error-reasons-section">
            <strong>Likely reasons:</strong>
            <ul>
              <li>File doesn't exist at the path above</li>
              <li>Media folder not configured — click <strong>⚙️ Media</strong> in the header</li>
              <li>Wrong media folder selected (should contain <em>WhatsApp Video/</em>, <em>WhatsApp Images/</em> etc.)</li>
              <li>File was deleted or moved from your phone's storage</li>
            </ul>
          </div>
          <div className="error-fix-section">
            <strong>How to fix:</strong>
            <ol>
              <li>Click <strong>⚙️ Media</strong> and select your WhatsApp <em>Media</em> folder</li>
              <li>Open the backend terminal — look for 404 lines or path errors</li>
            </ol>
          </div>
        </div>
        <div className="error-dialog-footer">
          <button className="error-dialog-close-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN BUBBLE ─────────────────────────────────────────────────────────────
// Wraps matches of the search words in <mark>. Returns the plain text when there
// is nothing to highlight, so normal chat rendering is unchanged.
function highlightText(text: string, terms?: string[]): React.ReactNode {
  if (!terms || terms.length === 0) return text;
  const parts = terms
    .map(t => t.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(t => t.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
  if (parts.length === 0) return text;
  let re: RegExp;
  try {
    re = new RegExp(`(${parts.join("|")})`, "gi");
  } catch {
    return text;
  }
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <mark key={key++} style={{ background: "rgba(255, 214, 0, 0.45)", color: "inherit", borderRadius: 2, padding: "0 1px" }}>
        {m[0]}
      </mark>
    );
    last = m.index + m[0].length;
  }
  if (out.length === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function MessageBubble({ message, highlightTerms, onViewInGallery, onOpenMedia, onJumpToQuoted }: MessageBubbleProps) {
  const [isMediaVisible, setIsMediaVisible]   = useState(false);
  const [errorIdx, setErrorIdx]               = useState<number | null>(null);
  const [failedSet, setFailedSet]             = useState<Set<number>>(new Set());
  const mediaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!message.media.length || !mediaRef.current) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setIsMediaVisible(true); obs.disconnect(); }
    }, { rootMargin: "300px" });
    obs.observe(mediaRef.current);
    return () => obs.disconnect();
  }, [message.media.length]);

  const markFailed = useCallback((i: number) => {
    setFailedSet(p => new Set([...p, i]));
    console.error(`❌ Media load failed — msg ${message.id}, index ${i}`);
  }, [message.id]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const fmtFull = (ts: number) => new Date(ts).toLocaleString();

  // the original message this reply points at (only clickable when we know where it is)
  const quotedTarget = onJumpToQuoted ? message.quoted_message_id ?? null : null;
  const jumpToQuoted = (messageId: number) => onJumpToQuoted?.(messageId);

  const viewInGallery = (idx: number) => onViewInGallery?.(message, idx);

  // small 🖼 button on the attachment (visible on hover)
  const galleryButton = (idx: number) => onViewInGallery && (
    <button
      className="media-gallery-btn"
      title="View in gallery"
      onClick={e => { e.stopPropagation(); viewInGallery(idx); }}
    >🖼</button>
  );

  const renderMedia = (media: any, idx: number) => {
    const path    = media.file_path || media.media_name || "";
    const url     = api.getMediaUrl(path);
    const failed  = failedSet.has(idx);

    if (!isMediaVisible) {
      const icon = media.mime_type?.startsWith("image/") ? "🖼️"
        : media.mime_type?.startsWith("video/") ? "🎥"
        : media.mime_type?.startsWith("audio/") ? "🎵" : "📎";
      return <div key={idx} className="media-placeholder">{icon} Loading…</div>;
    }

    if (failed) {
      return (
        <div key={idx} className="media-error-thumb" onClick={() => setErrorIdx(idx)} title="Click for details">
          <span className="media-error-icon-sm">❌</span>
          <span className="media-error-label">Failed — tap for details</span>
        </div>
      );
    }

    if (media.mime_type?.startsWith("audio/")) {
      return (
        <div key={idx} className="media-with-actions">
          <InlineAudioPlayer
            src={url}
            mimeType={media.mime_type}
            caption={media.caption}
            messageId={message.id}
            mediaPath={path}
            onError={() => markFailed(idx)}
          />
          {galleryButton(idx)}
        </div>
      );
    }

    if (media.mime_type?.startsWith("image/")) {
      return (
        <span key={idx}>
          <div className="media-with-actions">
            <img
              src={url}
              alt={media.media_name || "Image"}
              className="message-image"
              loading="lazy"
              onClick={(e) => { e.stopPropagation(); onOpenMedia?.(message, idx); }}
              onError={() => markFailed(idx)}
              title="Click to expand"
            />
            {galleryButton(idx)}
          </div>
        </span>
      );
    }

    if (media.mime_type?.startsWith("video/")) {
      return (
        <span key={idx}>
          <div className="media-with-actions">
            <div className="video-thumb-wrapper" onClick={(e) => { e.stopPropagation(); onOpenMedia?.(message, idx); }} title="Click to play">
              <video className="message-video" preload="metadata"
                onError={() => markFailed(idx)}
              >
                <source src={url} type={media.mime_type} />
              </video>
              <div className="video-play-overlay">▶</div>
            </div>
            {galleryButton(idx)}
          </div>
        </span>
      );
    }

    return (
      <a key={idx} href={url} download={media.media_name} className="message-document">
        📎 {media.media_name || "Document"}
      </a>
    );
  };

  const kind = getMessageKind(message);
  if (kind === "system" || kind === "deleted" || kind === "unsupported") {
    const label = kind === "system" ? systemText(message) : kind === "deleted" ? deletedText(message) : unsupportedText(message);
    return (
      <div className="message-notice-row">
        <div className={`message-notice message-notice-${kind}`} title={fmtFull(message.timestamp)}>
          {kind === "deleted" && <span className="message-notice-icon">🚫</span>}
          {kind === "system"
            ? highlightText(label, highlightTerms)
            : label}
          <span className="message-notice-time">{fmtTime(message.timestamp)}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Outer wrapper: full width, used to push bubble left or right */}
      <div style={{ display: 'flex', justifyContent: message.from_me ? 'flex-end' : 'flex-start', padding: '1px 0' }}>
        <div
          className={`message-bubble ${message.from_me ? "sent" : "received"}${kind === "sticker" ? " message-bubble-sticker" : ""}`}
          title={fmtFull(message.timestamp)}
        >
          {(message.quoted_text || message.quoted_message_id != null) && (
            <div
              className={`quoted-message${quotedTarget != null ? " quoted-clickable" : ""}`}
              {...(quotedTarget != null ? {
                role: "button",
                tabIndex: 0,
                title: "Jump to the original message",
                onClick: (e: React.MouseEvent) => { e.stopPropagation(); jumpToQuoted(quotedTarget); },
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); jumpToQuoted(quotedTarget); }
                },
              } : {})}
            >
              <div className="quoted-bar" />
              {/* replies to attachments have no quoted text: still show something to click */}
              <div className="quoted-text">{message.quoted_text || "Original message"}</div>
            </div>
          )}

          {message.text && <div className="message-text">{highlightText(message.text, highlightTerms)}</div>}

          {message.media.length > 0 && (
            <div className="message-media" ref={mediaRef}>
              {message.media.map((m, i) => renderMedia(m, i))}
            </div>
          )}

          {/* Timestamp floated right inside the bubble, WhatsApp-style */}
          <div className="message-timestamp">{fmtTime(message.timestamp)}</div>
        </div>
      </div>

      {errorIdx !== null && (
        <MediaErrorDialog
          media={message.media[errorIdx]}
          messageId={message.id}
          mediaUrl={api.getMediaUrl(message.media[errorIdx]?.file_path || message.media[errorIdx]?.media_name || "")}
          onClose={() => setErrorIdx(null)}
        />
      )}
    </>
  );
}
