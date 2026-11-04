import { useState, useEffect, useCallback } from "react";
import { api, Message } from "../api/client";

export function useMessages(chatId: number | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [prevCursor, setPrevCursor] = useState<number | null>(null);
  const [hasMoreUp, setHasMoreUp] = useState(true);
  const [hasMoreDown, setHasMoreDown] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);

  useEffect(() => {
    if (!chatId) return;

    const loadInitial = async () => {
      setIsLoading(true);
      try {
        const page = await api.getMessages(chatId, 100);
        setMessages(page.messages);
        setNextCursor(page.next_cursor);
        setPrevCursor(page.prev_cursor);
        setTotalCount(page.total_count);
        setHasMoreUp(page.prev_cursor !== null);
        setHasMoreDown(page.next_cursor !== null);
      } catch (error) {
        console.error("Failed to load messages:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitial();
  }, [chatId]);

  const loadMore = useCallback(
    async (direction: "up" | "down") => {
      if (!chatId || isLoading) return;
      if (direction === "up" && !hasMoreUp) return;
      if (direction === "down" && !hasMoreDown) return;

      setIsLoading(true);
      try {
        const cursor = direction === "up" ? prevCursor : nextCursor;
        const apiDirection = direction === "up" ? "before" : "after";

        const page = await api.getMessages(
          chatId,
          100,
          cursor || undefined,
          apiDirection,
        );

        setMessages((prev) => {
          if (direction === "up") {
            return [...page.messages, ...prev];
          } else {
            return [...prev, ...page.messages];
          }
        });

        if (direction === "up") {
          setPrevCursor(page.prev_cursor);
          setHasMoreUp(page.prev_cursor !== null);
        } else {
          setNextCursor(page.next_cursor);
          setHasMoreDown(page.next_cursor !== null);
        }
      } catch (error) {
        console.error("Failed to load more messages:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [chatId, isLoading, nextCursor, prevCursor, hasMoreUp, hasMoreDown],
  );

  // INSTANT JUMP - Uses search result directly!
  const jumpToMessage = useCallback(
    async (targetMessage: Message) => {
      if (!chatId) return;

      console.log(`ðŸŽ¯ INSTANT jump to message ${targetMessage.id}`);
      console.log(`ðŸ“ Timestamp: ${targetMessage.timestamp}`);

      setIsLoading(true);
      setHighlightedMessageId(targetMessage.id);

      try {
        const ts = targetMessage.timestamp;

        const [beforeBatch, afterBatch] = await Promise.all([
          api.getMessages(chatId, 50, ts, "before"),
          api.getMessages(chatId, 50, ts + 1, "after"),
        ]);

        console.log(`âœ… Loaded ${beforeBatch.messages.length} before, ${afterBatch.messages.length} after`);

        const combined = [
          ...beforeBatch.messages,
          targetMessage,
          ...afterBatch.messages,
        ];

        const unique = Array.from(
          new Map(combined.map(m => [m.id, m])).values()
        ).sort((a, b) => a.timestamp - b.timestamp);

        setMessages(unique);
        setPrevCursor(beforeBatch.prev_cursor);
        setNextCursor(afterBatch.next_cursor);
        setHasMoreUp(beforeBatch.prev_cursor !== null);
        setHasMoreDown(afterBatch.next_cursor !== null);

        console.log(`âœ… Jump complete in <1 second!`);
      } catch (error) {
        console.error("âŒ Jump failed:", error);
        alert(`Failed to jump: ${error}`);
      } finally {
        setIsLoading(false);
      }
    },
    [chatId]
  );

  // NEW: Jump to oldest message (INSTANT - no incremental loading!)
  const jumpToTop = useCallback(async () => {
    if (!chatId || isLoading) return;

    console.log(`â¬†ï¸ INSTANT jump to OLDEST message (chat start)`);
    setIsLoading(true);

    try {
      // Load from the very beginning (no cursor = oldest messages)
      const page = await api.getMessages(chatId, 100, undefined, "after");
      
      console.log(`âœ… Loaded ${page.messages.length} oldest messages instantly`);
      
      setMessages(page.messages);
      setNextCursor(page.next_cursor);
      setPrevCursor(page.prev_cursor);
      setHasMoreUp(false); // At the top!
      setHasMoreDown(page.next_cursor !== null);
      
      // Highlight first message
      if (page.messages.length > 0) {
        setHighlightedMessageId(page.messages[0].id);
      }

      console.log(`âœ… Jump to top complete!`);
    } catch (error) {
      console.error("âŒ Jump to top failed:", error);
      alert(`Failed to jump to top: ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [chatId, isLoading]);

  // NEW: Jump to newest message (INSTANT - no incremental loading!)
  const jumpToBottom = useCallback(async () => {
    if (!chatId || isLoading) return;

    console.log(`â¬‡ï¸ INSTANT jump to NEWEST message (chat end)`);
    setIsLoading(true);

    try {
      // Load newest messages by requesting without cursor but with direction "before" at high timestamp
      // This loads the most recent messages
      const page = await api.getMessages(chatId, 100, 999999999999999, "before");
      
      console.log(`âœ… Loaded ${page.messages.length} newest messages instantly`);
      
      setMessages(page.messages);
      setNextCursor(page.next_cursor);
      setPrevCursor(page.prev_cursor);
      setHasMoreUp(page.prev_cursor !== null);
      setHasMoreDown(false); // At the bottom!
      
      // Highlight last message
      if (page.messages.length > 0) {
        setHighlightedMessageId(page.messages[page.messages.length - 1].id);
      }

      console.log(`âœ… Jump to bottom complete!`);
    } catch (error) {
      console.error("âŒ Jump to bottom failed:", error);
      alert(`Failed to jump to bottom: ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [chatId, isLoading]);

  return {
    messages,
    isLoading,
    loadMore,
    hasMoreUp,
    hasMoreDown,
    totalCount,
    highlightedMessageId,
    jumpToMessage,
    jumpToTop,
    jumpToBottom,
  };
}
