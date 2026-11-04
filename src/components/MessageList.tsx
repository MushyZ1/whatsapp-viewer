import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Message } from "../api/client";
import MessageBubble from "./MessageBubble";

interface MessageListProps {
  messages: Message[];
  onLoadMore: (direction: "up" | "down") => void;
  onJumpToTop: () => void;
  onJumpToBottom: () => void;
  isLoading: boolean;
  hasMoreUp: boolean;
  hasMoreDown: boolean;
  highlightedMessageId?: number | null;
  jumpNonce?: number;
}

export default function MessageList({
  messages,
  onLoadMore,
  onJumpToTop: _onJumpToTop,
  onJumpToBottom,
  isLoading,
  hasMoreUp,
  hasMoreDown,
  highlightedMessageId,
  jumpNonce,
}: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  // Last jump we already scrolled to. Starts at the current value so that
  // re-mounting the list (e.g. coming back from search) doesn't re-scroll.
  const handledJumpRef = useRef(jumpNonce ?? 0);
  // True while a jump is settling: auto-loading is paused so nothing is
  // inserted above the target and shifts it out of view.
  const settlingRef = useRef(false);
  // Always-current copies, so delayed callbacks never use a stale list.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const highlightedIdRef = useRef(highlightedMessageId);
  highlightedIdRef.current = highlightedMessageId;
  const [isScrolling, setIsScrolling] = useState(false);

  // Stable key per message, so measured heights follow the message when
  // others are inserted above it. Duplicate ids get a suffix to stay unique.
  const itemKeys = useMemo(() => {
    const seen = new Set<number>();
    return messages.map((m, i) => {
      if (seen.has(m.id)) return `${m.id}#${i}`;
      seen.add(m.id);
      return m.id;
    });
  }, [messages]);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    getItemKey: (index: number) => itemKeys[index] ?? index,
    overscan: 20,
  });

  const items = virtualizer.getVirtualItems();

  // When older messages are inserted ABOVE the current ones, push the scroll
  // position down by what was added so the message you were reading stays put.
  // (Newly added rows are unmeasured, so each is estimateSize = 80px; the
  // virtualizer corrects the small differences itself as rows get measured.)
  const firstIdRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const prevFirst = firstIdRef.current;
    firstIdRef.current = messages.length > 0 ? messages[0].id : null;
    const el = parentRef.current;
    if (prevFirst === null || !el || messages.length === 0) return;
    if (messages[0].id === prevFirst) return;
    const added = messages.findIndex(m => m.id === prevFirst);
    // added <= 0: list was replaced (jump / chat change), not extended upward.
    if (added > 0) el.scrollTop += added * 80;
  }, [messages]);

  useEffect(() => {
    // Scroll to the jump target once per jump (see apply_scroll_fix_v2.py).
    // Runs only when a new jump completes, never when messages merely load.
    if (!jumpNonce || jumpNonce === handledJumpRef.current) return;
    handledJumpRef.current = jumpNonce;

    const targetId = highlightedIdRef.current;
    if (!targetId) return;

    settlingRef.current = true;
    const el = parentRef.current;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // End the settling phase (also on any manual scroll / click / key press).
    const finish = () => {
      settlingRef.current = false;
      timers.forEach(clearTimeout);
      el?.removeEventListener("wheel", finish);
      el?.removeEventListener("touchstart", finish);
      el?.removeEventListener("pointerdown", finish);
      el?.removeEventListener("keydown", finish);
    };
    el?.addEventListener("wheel", finish, { passive: true });
    el?.addEventListener("touchstart", finish, { passive: true });
    el?.addEventListener("pointerdown", finish);
    el?.addEventListener("keydown", finish);

    // Aim at the target's CURRENT index (never a remembered one).
    const aim = () => {
      const idx = messagesRef.current.findIndex(m => m.id === targetId);
      if (idx !== -1) virtualizer.scrollToIndex(idx, { align: "center" });
    };
    timers.push(setTimeout(aim, 100));
    timers.push(setTimeout(aim, 400));
    timers.push(setTimeout(aim, 900));
    timers.push(setTimeout(finish, 1000));

    return finish;
  }, [jumpNonce]);

  useEffect(() => {
    if (isLoading || !parentRef.current || settlingRef.current) return;

    const element = parentRef.current;
    const scrollTop = element.scrollTop;
    const scrollHeight = element.scrollHeight;
    const clientHeight = element.clientHeight;

    if (scrollTop < 200 && hasMoreUp && !isScrolling) {
      setIsScrolling(true);
      onLoadMore("up");
      setTimeout(() => setIsScrolling(false), 300);
    }

    if (scrollTop + clientHeight > scrollHeight - 200 && hasMoreDown && !isScrolling) {
      setIsScrolling(true);
      onLoadMore("down");
      setTimeout(() => setIsScrolling(false), 300);
    }
  }, [virtualizer.scrollOffset, isLoading, hasMoreUp, hasMoreDown, onLoadMore, isScrolling]);

  return (
    <>
      <div
        ref={parentRef}
        className="message-list-container"
        style={{
          height: "100%",
          overflow: "auto",
          overflowAnchor: "none",
          contain: "strict",
        }}
      >
        {/* Zero-height holder: the bar floats over the top edge instead of
            pushing the messages down while it is visible. */}
        <div style={{ position: "sticky", top: 0, height: 0, zIndex: 2, overflow: "visible" }}>
          {isLoading && hasMoreUp && (
            <div className="loading-indicator" style={{ position: "absolute", top: 0, left: 0, right: 0, pointerEvents: "none" }}>
              Loading older messages...
            </div>
          )}
        </div>

        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {items.map((virtualItem) => {
            const message = messages[virtualItem.index];
            const isHighlighted = message.id === highlightedMessageId;

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                className={isHighlighted ? "highlighted-message" : ""}
              >
                <MessageBubble message={message} />
              </div>
            );
          })}
        </div>

        {isLoading && hasMoreDown && (
          <div className="loading-indicator">Loading newer messages...</div>
        )}
      </div>

      {/* Only the jump-to-bottom button */}
      <div className="scroll-buttons-fixed">
        <button
          className="scroll-button scroll-to-bottom"
          onClick={onJumpToBottom}
          title="Jump to newest message"
          disabled={isLoading}
        >
          ↓
        </button>
      </div>
    </>
  );
}
