import { useState, useRef, useEffect, useCallback } from "react";
import { Message, api } from "../api/client";

interface MessageBubbleProps {
  message: Message;
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
export default function MessageBubble({ message }: MessageBubbleProps) {
  const [isMediaVisible, setIsMediaVisible]   = useState(false);
  const [expandedIdx, setExpandedIdx]         = useState<number | null>(null);
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

  const renderMedia = (media: any, idx: number) => {
    const path    = media.file_path || media.media_name || "";
    const url     = api.getMediaUrl(path);
    const failed  = failedSet.has(idx);
    const expanded = expandedIdx === idx;

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
        <InlineAudioPlayer
          key={idx}
          src={url}
          mimeType={media.mime_type}
          caption={media.caption}
          messageId={message.id}
          mediaPath={path}
          onError={() => markFailed(idx)}
        />
      );
    }

    if (media.mime_type?.startsWith("image/")) {
      return (
        <span key={idx}>
          <img
            src={url}
            alt={media.media_name || "Image"}
            className="message-image"
            loading="lazy"
            onClick={() => setExpandedIdx(expanded ? null : idx)}
            onError={() => markFailed(idx)}
            title="Click to expand"
          />
          {expanded && (
            <div className="media-modal" onClick={() => setExpandedIdx(null)}>
              <div className="media-modal-inner" onClick={e => e.stopPropagation()}>
                <img src={url} alt={media.media_name || "Image"} />
                {media.caption && <p className="modal-caption">{media.caption}</p>}
              </div>
              <button className="close-modal" onClick={() => setExpandedIdx(null)}>✕ Close</button>
            </div>
          )}
        </span>
      );
    }

    if (media.mime_type?.startsWith("video/")) {
      return (
        <span key={idx}>
          <div className="video-thumb-wrapper" onClick={() => setExpandedIdx(expanded ? null : idx)} title="Click to play">
            <video className="message-video" preload="metadata"
              onError={() => markFailed(idx)}
            >
              <source src={url} type={media.mime_type} />
            </video>
            <div className="video-play-overlay">▶</div>
          </div>
          {expanded && (
            <div className="media-modal" onClick={() => setExpandedIdx(null)}>
              <div className="media-modal-inner" onClick={e => e.stopPropagation()}>
                <video controls autoPlay className="modal-video">
                  <source src={url} type={media.mime_type} />
                </video>
                {media.caption && <p className="modal-caption">{media.caption}</p>}
              </div>
              <button className="close-modal" onClick={() => setExpandedIdx(null)}>✕ Close</button>
            </div>
          )}
        </span>
      );
    }

    return (
      <a key={idx} href={url} download={media.media_name} className="message-document">
        📎 {media.media_name || "Document"}
      </a>
    );
  };

  return (
    <>
      {/* Outer wrapper: full width, used to push bubble left or right */}
      <div style={{ display: 'flex', justifyContent: message.from_me ? 'flex-end' : 'flex-start', padding: '1px 0' }}>
        <div
          className={`message-bubble ${message.from_me ? "sent" : "received"}`}
          title={fmtFull(message.timestamp)}
        >
          {message.quoted_text && (
            <div className="quoted-message">
              <div className="quoted-bar" />
              <div className="quoted-text">{message.quoted_text}</div>
            </div>
          )}

          {message.text && <div className="message-text">{message.text}</div>}

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
