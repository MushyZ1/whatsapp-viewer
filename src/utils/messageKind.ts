import type { Message } from "../api/client";

/**
 * How a message should be drawn.
 *  - normal:      ordinary bubble (text and/or media)
 *  - system:      centered notice (group events, encryption notices, ...)
 *  - deleted:     "This message was deleted"
 *  - sticker:     bubble-less sticker image
 *  - unsupported: row with neither text nor media that we can't classify (never a blank bubble)
 *
 * Only message_type codes that are well known are mapped; everything else is decided from what the row
 * actually contains, so an unfamiliar code degrades to a harmless placeholder instead of a wrong label.
 * Run tools/msgtype_diagnostic.py on a real database to see which codes it actually uses.
 */
export type MessageKind = "normal" | "system" | "deleted" | "sticker" | "unsupported";

const TYPE_SYSTEM = 7;
const TYPE_DELETED = new Set([15, 64]);   // deleted for everyone (by the sender / by an admin)
const TYPE_STICKER = 20;

export function isStickerMedia(m: { media_name?: string | null; mime_type?: string | null }): boolean {
  return m.mime_type === "image/webp" && /(^|[\\/])STK-|sticker/i.test(m.media_name || "");
}

export function getMessageKind(m: Message): MessageKind {
  if (TYPE_DELETED.has(m.message_type)) return "deleted";
  if (m.message_type === TYPE_SYSTEM) return "system";
  const media = m.media ?? [];
  if (m.message_type === TYPE_STICKER || (media.length > 0 && !m.text && media.every(isStickerMedia))) return "sticker";
  if (!m.text && media.length === 0) {
    // A blank row: no text, no attachment, no quote. Nothing meaningful to draw as a bubble.
    return m.quoted_text || m.quoted_message_id != null ? "normal" : "unsupported";
  }
  return "normal";
}

export function systemText(m: Message): string {
  return (m.text && m.text.trim()) || "System message";
}

export function deletedText(m: Message): string {
  return m.from_me ? "You deleted this message" : "This message was deleted";
}

export function unsupportedText(m: Message): string {
  return `Unsupported message (type ${m.message_type})`;
}
