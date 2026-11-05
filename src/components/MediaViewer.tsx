import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";

// Full-screen viewer for images / videos (and audio, via renderAudio), shared by the
// media gallery and the chat. Owns the toolbar, the ‹ › buttons and the ← / → keys.
// "Next" simply means the next entry of `items`, so each caller picks the order.

export interface ViewerItem {
  message_id: number;
  file_path: string | null;
  media_name: string | null;
  mime_type: string | null;
  caption: string | null;
  timestamp: number;
}

// One message can have several attachments, so the message id alone isn't unique.
export const viewerItemKey = (item: ViewerItem) =>
  `${item.message_id}|${item.file_path || item.media_name || ""}`;

export interface ViewerAction {
  label: string;
  onClick: (item: ViewerItem) => void;
  accent?: boolean;
}

interface MediaViewerProps {
  /** The item being shown. */
  item: ViewerItem;
  /** Items ← / → step through, in order. May be just [item] while the list is loading. */
  items: ViewerItem[];
  onNavigate: (item: ViewerItem) => void;
  onClose: () => void;
  /** Extra toolbar buttons (shown before Close). */
  actions?: ViewerAction[];
  /** How to show audio. Without it, audio items show nothing. */
  renderAudio?: (item: ViewerItem) => React.ReactNode;
}

export default function MediaViewer({ item, items, onNavigate, onClose, actions, renderAudio }: MediaViewerProps) {
  const key = viewerItemKey(item);
  const pos = items.findIndex(i => viewerItemKey(i) === key);
  const prevItem = pos > 0 ? items[pos - 1] : null;
  const nextItem = pos >= 0 && pos < items.length - 1 ? items[pos + 1] : null;

  // Keys: Esc closes, ← / → go to the previous / next item. Capture phase + preventDefault
  // so a focused <video> doesn't seek instead and nothing underneath reacts.
  // The handler reads the latest values from a ref so the listener is attached only once.
  const latest = useRef({ prevItem, nextItem, onNavigate, onClose });
  latest.current = { prevItem, nextItem, onNavigate, onClose };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const { prevItem, nextItem, onNavigate, onClose } = latest.current;
      if (e.key === "Escape") {
        e.stopPropagation(); onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault(); e.stopPropagation(); if (prevItem) onNavigate(prevItem);
      } else if (e.key === "ArrowRight") {
        e.preventDefault(); e.stopPropagation(); if (nextItem) onNavigate(nextItem);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const mime = item.mime_type || "";
  const url = api.getMediaUrl(item.file_path || item.media_name || "");

  // Drawn on document.body: inside the app layout the chat header painted over the buttons.
  return createPortal(
    <div className="media-modal" onClick={onClose}>
      <div className="gallery-viewer-bar" onClick={e => e.stopPropagation()}>
        <div className="gallery-viewer-info">
          <span className="gallery-viewer-title">{item.media_name || "Media"}</span>
          <span className="gallery-viewer-sub">
            {new Date(item.timestamp).toLocaleString()}
            {pos >= 0 && items.length > 1 && ` · ${pos + 1} / ${items.length}`}
          </span>
        </div>
        <div className="gallery-viewer-actions">
          {actions?.map(a => (
            <button key={a.label}
                    className={`viewer-btn${a.accent ? " viewer-btn-accent" : ""}`}
                    onClick={e => { e.stopPropagation(); a.onClick(item); }}>
              {a.label}
            </button>
          ))}
          <button className="viewer-btn" onClick={e => { e.stopPropagation(); onClose(); }}>✕ Close</button>
        </div>
      </div>

      <button className="viewer-nav viewer-nav-prev" title="Previous (←)" disabled={!prevItem}
              onClick={e => { e.stopPropagation(); if (prevItem) onNavigate(prevItem); }}>‹</button>
      <button className="viewer-nav viewer-nav-next" title="Next (→)" disabled={!nextItem}
              onClick={e => { e.stopPropagation(); if (nextItem) onNavigate(nextItem); }}>›</button>

      {(mime.startsWith("audio/") || mime === "application/ogg") ? (
        renderAudio?.(item) ?? null
      ) : mime.startsWith("image/") ? (
        <div className="media-modal-inner gallery-viewer-content" onClick={e => e.stopPropagation()}>
          <img key={key} src={url} alt={item.media_name || "Image"} />
          {item.caption && <p className="modal-caption">{item.caption}</p>}
        </div>
      ) : mime.startsWith("video/") ? (
        <div className="media-modal-inner gallery-viewer-content" onClick={e => e.stopPropagation()}>
          <video key={key} controls autoPlay className="modal-video">
            <source src={url} type={mime} />
          </video>
          {item.caption && <p className="modal-caption">{item.caption}</p>}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
