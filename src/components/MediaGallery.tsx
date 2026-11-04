import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";

interface MediaGalleryProps {
  chatId: number;
}

interface MediaItem {
  message_id: number;
  file_path: string | null;
  media_name: string | null;
  mime_type: string | null;
  caption: string | null;
  timestamp: number;
}

interface MonthGroup {
  month: string;
  items: MediaItem[];
}

// ─── AUDIO PLAYER ─────────────────────────────────────────────────────────────
function GalleryAudioPlayer({ item }: { item: MediaItem }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying]         = useState(false);
  const [currentTime, setCurrentTime]     = useState(0);
  const [duration, setDuration]           = useState(0);
  const [durationKnown, setDurationKnown] = useState(false);
  const [speed, setSpeed]                 = useState(1);
  const [hasError, setHasError]           = useState(false);

  const src = api.getMediaUrl(item.file_path || item.media_name || "");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const trySetDuration = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        setDurationKnown(true);
      }
    };
    const onTime  = () => setCurrentTime(audio.currentTime);
    const onPlay  = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnd   = () => { setIsPlaying(false); setCurrentTime(0); if (audio) audio.currentTime = 0; };
    const onErr   = () => { console.error(`Gallery audio error: ${src}`); setHasError(true); };

    audio.addEventListener("loadedmetadata", trySetDuration);
    audio.addEventListener("durationchange", trySetDuration);
    audio.addEventListener("timeupdate",     onTime);
    audio.addEventListener("play",           onPlay);
    audio.addEventListener("pause",          onPause);
    audio.addEventListener("ended",          onEnd);
    audio.addEventListener("error",          onErr);

    return () => {
      audio.removeEventListener("loadedmetadata", trySetDuration);
      audio.removeEventListener("durationchange", trySetDuration);
      audio.removeEventListener("timeupdate",     onTime);
      audio.removeEventListener("play",           onPlay);
      audio.removeEventListener("pause",          onPause);
      audio.removeEventListener("ended",          onEnd);
      audio.removeEventListener("error",          onErr);
    };
  }, [src]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || hasError) return;
    try { isPlaying ? audio.pause() : await audio.play(); }
    catch (e) { console.error("Play failed:", e); }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !durationKnown) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
  };

  const cycleSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const fmt = (s: number) =>
    !isFinite(s) || s < 0 ? "0:00"
    : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const progress = durationKnown && duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="gallery-audio-player" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
      <audio ref={audioRef} src={src} preload="metadata">
        <source src={src} type={item.mime_type || "audio/ogg"} />
      </audio>
      <div className="gallery-audio-header">
        <div className="gallery-audio-icon">🎵</div>
        <div className="gallery-audio-meta">
          <div className="gallery-audio-name">{item.media_name || "Voice message"}</div>
          <div className="gallery-audio-date">{new Date(item.timestamp).toLocaleDateString()}</div>
        </div>
      </div>
      {hasError ? (
        <div className="gallery-audio-error">
          Could not load audio
          <small>{item.file_path || item.media_name}</small>
        </div>
      ) : (
        <div className="gallery-audio-controls">
          <button className="gallery-audio-play-btn" onClick={togglePlay}>
            {isPlaying
              ? <svg viewBox="0 0 24 24" fill="white" width="22" height="22"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              : <svg viewBox="0 0 24 24" fill="white" width="22" height="22"><polygon points="5,3 19,12 5,21"/></svg>
            }
          </button>
          <div className="gallery-audio-track">
            <div className="gallery-audio-scrubber" onClick={handleSeek}
                 style={{ cursor: durationKnown ? "pointer" : "default" }}>
              <div className="gallery-audio-scrubber-bg" />
              <div className="gallery-audio-scrubber-fill" style={{ width: `${progress}%` }} />
              <div className="gallery-audio-scrubber-thumb" style={{ left: `${progress}%` }} />
            </div>
            <div className="gallery-audio-times">
              <span>{fmt(currentTime)}</span>
              <span>{durationKnown ? fmt(duration) : "…"}</span>
            </div>
          </div>
          <button className="gallery-audio-speed" onClick={cycleSpeed}>{speed}x</button>
        </div>
      )}
      {item.caption && <div className="gallery-audio-caption">{item.caption}</div>}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function MediaGallery({ chatId }: MediaGalleryProps) {
  const [filter, setFilter]       = useState<"all" | "images" | "videos" | "audios">("all");
  const [mediaData, setMediaData] = useState<MonthGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<MediaItem | null>(null);
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    // ── FIX: cancelled flag prevents setState after unmount,
    // which was causing the second-visit timeout.
    // When the user switches from gallery -> messages -> gallery,
    // the first fetch is cancelled so it can't conflict with the new one.
    let cancelled = false;

    const loadMedia = async () => {
      setIsLoading(true);
      setError(null);
      setFailedIds(new Set());
      try {
        const result = await api.getMediaGallery(chatId, filter);
        if (cancelled) return;  // component unmounted — don't touch state
        setMediaData(result.months || []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load media");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadMedia();
    return () => { cancelled = true; };  // cleanup: mark as cancelled on unmount/re-run
  }, [chatId, filter]);

  // Esc closes the full-screen viewer
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const markFailed = (id: number) => setFailedIds(prev => new Set([...prev, id]));

  const renderItem = (item: MediaItem) => {
    const url     = api.getMediaUrl(item.file_path || item.media_name || "");
    const isImage = item.mime_type?.startsWith("image/");
    const isVideo = item.mime_type?.startsWith("video/");
    const isAudio = item.mime_type?.startsWith("audio/") || item.mime_type === "application/ogg";
    const failed  = failedIds.has(item.message_id);
    const dateStr = new Date(item.timestamp).toLocaleDateString();

    if (failed) {
      return (
        <div key={item.message_id} className="media-item error" title={item.file_path || ''}>
          <div className="media-error-icon">❌</div>
          <div className="media-error-details"><small>{item.media_name || "Unknown"}</small></div>
        </div>
      );
    }

    if (isAudio) {
      return (
        <div key={item.message_id} className="media-item audio-item"
             onClick={() => setExpanded(item)} title={`${dateStr} — click to play`}>
          <div className="audio-placeholder">
            <div className="audio-icon">🎵</div>
            <div className="audio-name">{item.media_name || "Voice message"}</div>
            <div className="audio-tap-hint">▶ Tap to play</div>
          </div>
          <div className="media-overlay">{dateStr}</div>
        </div>
      );
    }

    if (isImage) {
      return (
        <div key={item.message_id} className="media-item"
             onClick={() => setExpanded(item)} title={`${dateStr} — click to expand`}>
          <img src={url} alt={item.media_name || "Image"} loading="lazy"
               onError={() => markFailed(item.message_id)} />
          <div className="media-overlay">{dateStr}</div>
        </div>
      );
    }

    if (isVideo) {
      return (
        <div key={item.message_id} className="media-item"
             onClick={() => setExpanded(item)} title={`${dateStr} — click to play`}>
          <video src={url} preload="metadata" onError={() => markFailed(item.message_id)} />
          <div className="media-overlay">{dateStr}</div>
          <div className="video-play-icon">▶</div>
        </div>
      );
    }

    return (
      <div key={item.message_id} className="media-item"
           onClick={() => setExpanded(item)} title={dateStr}>
        <div className="file-placeholder">
          <div className="file-icon">📎</div>
          <div className="file-name">{item.media_name || "File"}</div>
        </div>
        <div className="media-overlay">{dateStr}</div>
      </div>
    );
  };

  return (
    <div className="media-gallery">
      {/* Filter tabs */}
      <div className="media-filters">
        {(["all", "images", "videos", "audios"] as const).map(f => (
          <button key={f} className={`filter-btn ${filter === f ? "active" : ""}`}
                  onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "images" ? "Images" : f === "videos" ? "Videos" : "Audio"}
          </button>
        ))}
      </div>

      {isLoading && <div className="loading-state">Loading media…</div>}
      {error && <div className="error-state"><p>{error}</p><button onClick={() => setFilter(filter)}>Retry</button></div>}
      {!isLoading && !error && mediaData.length === 0 && (
        <div className="empty-state">No media found</div>
      )}

      {!isLoading && !error && mediaData.map(group => (
        <div key={group.month} className="month-section">
          <div className="month-header">{group.month}</div>
          <div className="media-grid">{group.items.map(renderItem)}</div>
        </div>
      ))}

      {/* Expanded modal */}
      {expanded && (
        <div className="media-modal" onClick={() => setExpanded(null)}>
          {(expanded.mime_type?.startsWith("audio/") || expanded.mime_type === "application/ogg") ? (
            <GalleryAudioPlayer item={expanded} />
          ) : expanded.mime_type?.startsWith("image/") ? (
            <div className="media-modal-inner" onClick={e => e.stopPropagation()}>
              <img src={api.getMediaUrl(expanded.file_path || expanded.media_name || "")}
                   alt={expanded.media_name || "Image"} />
              {expanded.caption && <p className="modal-caption">{expanded.caption}</p>}
            </div>
          ) : expanded.mime_type?.startsWith("video/") ? (
            <div className="media-modal-inner" onClick={e => e.stopPropagation()}>
              <video controls autoPlay className="modal-video">
                <source src={api.getMediaUrl(expanded.file_path || expanded.media_name || "")}
                        type={expanded.mime_type} />
              </video>
              {expanded.caption && <p className="modal-caption">{expanded.caption}</p>}
            </div>
          ) : null}
          <button className="close-modal" onClick={() => setExpanded(null)}>✕ Close</button>
        </div>
      )}
    </div>
  );
}
