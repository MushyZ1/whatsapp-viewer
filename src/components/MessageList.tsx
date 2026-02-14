import { useEffect, useRef, useState } from "react";
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
}: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 20,
  });

  const items = virtualizer.getVirtualItems();

  useEffect(() => {
    if (highlightedMessageId && messages.length > 0) {
      const index = messages.findIndex(m => m.id === highlightedMessageId);
      if (index !== -1) {
        setTimeout(() => {
          virtualizer.scrollToIndex(index, { align: "center" });
        }, 100);
      }
    }
  }, [highlightedMessageId, messages, virtualizer]);

  useEffect(() => {
    if (isLoading || !parentRef.current) return;

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
          contain: "strict",
        }}
      >
        {isLoading && hasMoreUp && (
          <div className="loading-indicator">Loading older messages...</div>
        )}

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
