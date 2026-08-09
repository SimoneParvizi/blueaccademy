import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatComposerInput } from "@/components/chat/chat-composer-input";
import { toast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Send,
  Trash2,
  Loader2,
  Zap,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentReference } from "@/contexts/current-reference";
import { attachReferenceToMessage } from "@/lib/reference-token";
import { resolveApiUrl } from "@/lib/api-base";
import type { ChatMessage } from "@/lib/api-types";

const SESSION_ID = "dev-session";
const CHAT_EDGE_GAP = 16;
const CHAT_TOP_GAP = 56;
const CHAT_MODAL_WIDTH = 400;
const CHAT_MODAL_HEIGHT = 560;

type Message = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

type ModalPosition = {
  x: number;
  y: number;
};

type ModalSize = {
  width: number;
  height: number;
};

type ResizeHandle = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const RESIZE_HANDLES: Array<{
  key: ResizeHandle;
  className: string;
  gripClassName: string;
}> = [
  {
    key: "top-left",
    className: "left-0 top-0 cursor-nwse-resize",
    gripClassName: "left-0 top-0 border-l border-t",
  },
  {
    key: "top-right",
    className: "right-0 top-0 cursor-nesw-resize",
    gripClassName: "right-0 top-0 border-r border-t",
  },
  {
    key: "bottom-left",
    className: "bottom-0 left-0 cursor-nesw-resize",
    gripClassName: "bottom-0 left-0 border-b border-l",
  },
  {
    key: "bottom-right",
    className: "bottom-0 right-0 cursor-nwse-resize",
    gripClassName: "bottom-0 right-0 border-b border-r",
  },
];

// ── Markdown-lite renderer ─────────────────────────────────────────────────
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code
          key={`${keyPrefix}-c${i}`}
          className="bg-muted/60 px-1 py-0.5 rounded text-[11px] font-mono text-primary"
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    return <span key={`${keyPrefix}-t${i}`}>{p}</span>;
  });
}

const LOOSE_CODE_LANGUAGES = new Set([
  "bash",
  "sh",
  "zsh",
  "shell",
  "yaml",
  "yml",
  "json",
  "typescript",
  "ts",
  "javascript",
  "js",
  "python",
  "py",
]);

function normalizeLooseCodeBlocks(content: string) {
  const lines = content.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      out.push(rawLine);
      continue;
    }

    if (!inFence && LOOSE_CODE_LANGUAGES.has(trimmed.toLowerCase())) {
      const next = lines[i + 1]?.trim() ?? "";
      if (!next) {
        out.push(rawLine);
        continue;
      }

      const codeLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "") {
        codeLines.push(lines[j].replace(/^\s{2,}/, ""));
        j++;
      }

      out.push(`\`\`\`${trimmed.toLowerCase()}`);
      out.push(codeLines.join("\n"));
      out.push("```");
      if (j < lines.length) out.push("");
      i = j;
      continue;
    }

    out.push(rawLine);
  }

  return out.join("\n");
}

function normalizeSectionSpacing(content: string) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith("```")) return part;
      return part
        .replace(/^(\*\*TL;DR:\*\*|\*\*Short answer:\*\*|\*\*What it means:\*\*|\*\*Example:\*\*)\s*\n{2,}/gim, "$1\n")
        .replace(/^(TL;DR:|Short answer:|What it means:|Example:)\s*\n{2,}/gim, "$1\n");
    })
    .join("");
}

function renderPlainLine(line: string, key: string) {
  const h3 = line.match(/^###\s+(.+)$/);
  if (h3) {
    return <div key={key} className="mb-1 mt-2 text-[13px] font-semibold text-foreground">{renderInline(h3[1], `${key}-h3`)}</div>;
  }

  const h2 = line.match(/^##\s+(.+)$/);
  if (h2) {
    return <div key={key} className="mb-1 mt-2 text-sm font-semibold text-foreground">{renderInline(h2[1], `${key}-h2`)}</div>;
  }

  const ordered = line.match(/^(\d+)\.\s+(.+)$/);
  if (ordered) {
    return (
      <div key={key} className="pl-1">
        <span className="text-muted-foreground">{ordered[1]}. </span>
        {renderInline(ordered[2], `${key}-ol`)}
      </div>
    );
  }

  const bullet = line.match(/^[-*]\s+(.+)$/);
  if (bullet) {
    return (
      <div key={key} className="pl-1">
        <span className="text-muted-foreground">- </span>
        {renderInline(bullet[1], `${key}-ul`)}
      </div>
    );
  }

  return <span key={key}>{renderInline(line, key)}</span>;
}

function MdMessage({ content }: { content: string }) {
  const normalized = normalizeSectionSpacing(normalizeLooseCodeBlocks(content));
  const parts = normalized.split(/(```[\s\S]*?```)/g);
  return (
    <div className="text-[13px] leading-relaxed space-y-1.5">
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const inner = part.slice(3, -3);
          const nl = inner.indexOf("\n");
          const lang = nl > -1 ? inner.slice(0, nl).trim() : "";
          const code = nl > -1 ? inner.slice(nl + 1) : inner;
          return (
            <pre
              key={i}
              className="bg-muted/60 dark:bg-muted/30 rounded-md px-2.5 py-2 overflow-x-auto text-[11px] font-mono text-foreground leading-4"
            >
              {lang && (
                <span className="block text-[9px] text-muted-foreground mb-1 uppercase tracking-wider">
                  {lang}
                </span>
              )}
              <code>{code}</code>
            </pre>
          );
        }
        return (
          <span key={i}>
            {part.split("\n").map((line, j, arr) => (
              <span key={j}>
                {renderPlainLine(line, `${i}-${j}`)}
                {j < arr.length - 1 && <br />}
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div
      data-testid={`message-${msg.role}`}
      className={cn("flex", isUser && "justify-end")}
    >
      <div
        className={cn(
          "max-w-[85%]",
          isUser
            ? "rounded-lg px-3 py-2 bg-primary/10 text-foreground rounded-tr-sm"
            : "py-1 text-foreground"
        )}
      >
        {msg.streaming && msg.content === "" ? (
          <div className="flex items-center gap-1.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
          </div>
        ) : (
          <MdMessage content={msg.content} />
        )}
        {msg.streaming && msg.content !== "" && (
          <span className="inline-block w-1 h-3.5 bg-primary ml-0.5 animate-pulse align-text-bottom" />
        )}
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  "Explain Pod restart policies",
  "Multi-stage Docker build",
  "How does Pulumi state work?",
  "ClusterIP vs NodePort",
];

// ── Floating Chat Modal ─────────────────────────────────────────────────────
export default function ChatModal() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [referenceAttached, setReferenceAttached] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [modalPosition, setModalPosition] = useState<ModalPosition | null>(null);
  const [modalSize, setModalSize] = useState<ModalSize | null>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState<ResizeHandle | null>(null);
  const { reference } = useCurrentReference();
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const dragStateRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const resizeStateRef = useRef<{
    pointerId: number;
    direction: ResizeHandle;
    startX: number;
    startY: number;
    startPosition: ModalPosition;
    startSize: ModalSize;
  } | null>(null);

  const getMinModalSize = useCallback(() => {
    const maxWidth = Math.max(240, window.innerWidth - CHAT_EDGE_GAP * 2);
    const maxHeight = Math.max(320, window.innerHeight - CHAT_TOP_GAP - CHAT_EDGE_GAP);

    return {
      width: Math.min(CHAT_MODAL_WIDTH, maxWidth),
      height: Math.min(CHAT_MODAL_HEIGHT, maxHeight),
    };
  }, []);

  const getMaxModalSize = useCallback(() => {
    return {
      width: Math.max(240, window.innerWidth - CHAT_EDGE_GAP * 2),
      height: Math.max(320, window.innerHeight - CHAT_TOP_GAP - CHAT_EDGE_GAP),
    };
  }, []);

  const clampModalSize = useCallback((width: number, height: number) => {
    const minSize = getMinModalSize();
    const maxSize = getMaxModalSize();

    return {
      width: Math.min(Math.max(minSize.width, width), maxSize.width),
      height: Math.min(Math.max(minSize.height, height), maxSize.height),
    };
  }, [getMaxModalSize, getMinModalSize]);

  const getDefaultModalSize = useCallback(() => {
    return clampModalSize(CHAT_MODAL_WIDTH, CHAT_MODAL_HEIGHT);
  }, [clampModalSize]);

  const clampModalPosition = useCallback((x: number, y: number, size: ModalSize) => {
    const maxX = Math.max(CHAT_EDGE_GAP, window.innerWidth - size.width - CHAT_EDGE_GAP);
    const maxY = Math.max(CHAT_TOP_GAP, window.innerHeight - size.height - CHAT_EDGE_GAP);

    return {
      x: Math.min(Math.max(CHAT_EDGE_GAP, x), maxX),
      y: Math.min(Math.max(CHAT_TOP_GAP, y), maxY),
    };
  }, []);

  const getDefaultModalPosition = useCallback((size: ModalSize) => {
    return clampModalPosition(
      window.innerWidth - size.width - CHAT_EDGE_GAP,
      CHAT_TOP_GAP,
      size,
    );
  }, [clampModalPosition]);

  const { data: history, isLoading: histLoading } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat/history", SESSION_ID],
    queryFn: () =>
      apiRequest("GET", `/api/chat/history?sessionId=${SESSION_ID}`).then((r) =>
        r.json()
      ),
    enabled: open,
  });

  useEffect(() => {
    if (history && !historyLoaded) {
      setMessages(
        history.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }))
      );
      setHistoryLoaded(true);
    }
  }, [history, historyLoaded]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !shouldAutoScrollRef.current) return;
    container.scrollTop = container.scrollHeight;
    lastScrollTopRef.current = container.scrollTop;
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;

    const size = modalSize ?? getDefaultModalSize();
    setModalSize(size);
    setModalPosition((current) =>
      current ? clampModalPosition(current.x, current.y, size) : getDefaultModalPosition(size)
    );
  }, [clampModalPosition, getDefaultModalPosition, getDefaultModalSize, modalSize, open]);

  useEffect(() => {
    if (!open) return;

    const handleResize = () => {
      const size = clampModalSize(
        modalSize?.width ?? CHAT_MODAL_WIDTH,
        modalSize?.height ?? CHAT_MODAL_HEIGHT,
      );
      setModalSize(size);
      setModalPosition((current) =>
        current ? clampModalPosition(current.x, current.y, size) : getDefaultModalPosition(size)
      );
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampModalPosition, clampModalSize, getDefaultModalPosition, modalSize, open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (resizeState && resizeState.pointerId === event.pointerId) {
        const minSize = getMinModalSize();
        const deltaX = event.clientX - resizeState.startX;
        const deltaY = event.clientY - resizeState.startY;
        let nextX = resizeState.startPosition.x;
        let nextY = resizeState.startPosition.y;
        let nextWidth = resizeState.startSize.width;
        let nextHeight = resizeState.startSize.height;

        if (resizeState.direction.endsWith("right")) {
          const maxWidth = window.innerWidth - resizeState.startPosition.x - CHAT_EDGE_GAP;
          nextWidth = Math.min(
            Math.max(minSize.width, resizeState.startSize.width + deltaX),
            maxWidth,
          );
        }

        if (resizeState.direction.endsWith("left")) {
          const rightEdge = resizeState.startPosition.x + resizeState.startSize.width;
          const maxX = rightEdge - minSize.width;
          nextX = Math.min(
            Math.max(CHAT_EDGE_GAP, resizeState.startPosition.x + deltaX),
            maxX,
          );
          nextWidth = rightEdge - nextX;
        }

        if (resizeState.direction.startsWith("bottom")) {
          const maxHeight = window.innerHeight - resizeState.startPosition.y - CHAT_EDGE_GAP;
          nextHeight = Math.min(
            Math.max(minSize.height, resizeState.startSize.height + deltaY),
            maxHeight,
          );
        }

        if (resizeState.direction.startsWith("top")) {
          const bottomEdge = resizeState.startPosition.y + resizeState.startSize.height;
          const maxY = bottomEdge - minSize.height;
          nextY = Math.min(
            Math.max(CHAT_TOP_GAP, resizeState.startPosition.y + deltaY),
            maxY,
          );
          nextHeight = bottomEdge - nextY;
        }

        setModalPosition({ x: nextX, y: nextY });
        setModalSize({ width: nextWidth, height: nextHeight });
        return;
      }

      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      const size = modalSize ?? getDefaultModalSize();
      setModalPosition(
        clampModalPosition(
          event.clientX - dragState.offsetX,
          event.clientY - dragState.offsetY,
          size,
        ),
      );
    };

    const stopInteraction = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (resizeState && resizeState.pointerId === event.pointerId) {
        resizeStateRef.current = null;
        setResizing(null);
        return;
      }

      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      dragStateRef.current = null;
      setDragging(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopInteraction);
    window.addEventListener("pointercancel", stopInteraction);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopInteraction);
      window.removeEventListener("pointercancel", stopInteraction);
    };
  }, [clampModalPosition, getDefaultModalSize, getMinModalSize, modalSize, open]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const clearMutation = useMutation({
    mutationFn: () =>
      apiRequest("DELETE", `/api/chat/history?sessionId=${SESSION_ID}`),
    onMutate: async () => {
      setMessages([]);
      setHistoryLoaded(true);
      queryClient.setQueryData<ChatMessage[]>(
        ["/api/chat/history", SESSION_ID],
        [],
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/chat/history", SESSION_ID],
      });
    },
  });

  const sendMessage = useCallback(
    (text: string) => {
      const trimmedText = text.trim();

      if (trimmedText === "/clear") {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        setStreaming(false);
        setInput("");
        setReferenceAttached(false);
        clearMutation.mutate();
        return;
      }

      if ((!trimmedText && !referenceAttached) || streaming) return;
      const resolved = referenceAttached
        ? attachReferenceToMessage(trimmedText, reference)
        : { resolved: trimmedText, usedReference: false };
      if (!resolved) {
        toast({
          title: "No current context available",
          description: "Use @this from an active flashcard, Terminal Lab exercise, or CKAD simulation.",
          variant: "destructive",
        });
        return;
      }

      const finalText = resolved.resolved;
      shouldAutoScrollRef.current = true;
      const userMsg: Message = { role: "user", content: finalText };
      const assistantMsg: Message = {
        role: "assistant",
        content: "",
        streaming: true,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setReferenceAttached(false);
      setStreaming(true);

      if (eventSourceRef.current) eventSourceRef.current.close();

      const params = new URLSearchParams({
        sessionId: SESSION_ID,
        message: finalText,
      });
      const es = new EventSource(resolveApiUrl(`/api/chat/stream?${params}`));
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.text) {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === "assistant") {
                updated[updated.length - 1] = {
                  ...last,
                  content: last.content + data.text,
                };
              }
              return updated;
            });
          }
          if (data.done || data.error) {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === "assistant") {
                updated[updated.length - 1] = { ...last, streaming: false };
              }
              return updated;
            });
            setStreaming(false);
            es.close();
            queryClient.invalidateQueries({
              queryKey: ["/api/chat/history", SESSION_ID],
            });
          }
        } catch (_) {}
      };

      es.onerror = () => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            updated[updated.length - 1] = {
              ...last,
              content:
                last.content ||
                "Failed to get a response. Make sure HF_API_KEY or ANTHROPIC_API_KEY is set.",
              streaming: false,
            };
          }
          return updated;
        });
        setStreaming(false);
        es.close();
      };
    },
    [clearMutation, reference, referenceAttached, streaming]
  );

  const openChat = useCallback(() => {
    const size = modalSize ?? getDefaultModalSize();
    setModalSize(size);
    setModalPosition((current) => current ?? getDefaultModalPosition(size));
    shouldAutoScrollRef.current = true;
    setOpen(true);
    setTimeout(() => composerRef.current?.focus(), 0);
  }, [getDefaultModalPosition, getDefaultModalSize, modalSize]);

  const closeChat = useCallback(() => {
    dragStateRef.current = null;
    resizeStateRef.current = null;
    setDragging(false);
    setResizing(null);
    setOpen(false);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const pressedToggleShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        (event.key === "/" || event.key === "?");

      if (!pressedToggleShortcut) return;

      event.preventDefault();
      if (open) {
        closeChat();
      } else {
        openChat();
      }
    };

    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [closeChat, open, openChat]);

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (!modalRef.current) return;

    const rect = modalRef.current.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    setDragging(true);
  };

  const handleResizePointerDown = (
    direction: ResizeHandle,
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const currentPosition = modalPosition ?? getDefaultModalPosition(modalSize ?? getDefaultModalSize());
    const currentSize = modalSize ?? getDefaultModalSize();
    resizeStateRef.current = {
      pointerId: e.pointerId,
      direction,
      startX: e.clientX,
      startY: e.clientY,
      startPosition: currentPosition,
      startSize: currentSize,
    };
    dragStateRef.current = null;
    setDragging(false);
    setResizing(direction);
  };

  const isEmpty = messages.length === 0 && !histLoading;
  const hasUnread = false; // Could track unread for notifications

  const handleMessagesScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const currentTop = container.scrollTop;
    const distanceFromBottom =
      container.scrollHeight - currentTop - container.clientHeight;

    if (currentTop < lastScrollTopRef.current) {
      shouldAutoScrollRef.current = false;
    } else if (distanceFromBottom <= 4) {
      shouldAutoScrollRef.current = true;
    }

    lastScrollTopRef.current = currentTop;
  };

  return (
    <>
      {/* FAB trigger */}
      {!open && (
        <button
          data-testid="button-open-chat"
          onClick={openChat}
          className="group fixed top-4 right-4 z-50 inline-flex h-11 w-11 items-center overflow-hidden rounded-full border border-primary/30 bg-primary px-2 text-primary-foreground shadow-lg shadow-primary/20 transition-[width,transform,box-shadow] duration-200 ease-out hover:w-[118px] hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label="Open AI Chat"
        >
          <span className="flex h-7 w-7 items-center justify-center shrink-0">
            <MessageSquare size={16} strokeWidth={2.2} />
          </span>
          <span className="ml-0 max-w-0 -translate-x-2 overflow-hidden whitespace-nowrap text-sm font-semibold tracking-tight opacity-0 transition-all duration-200 ease-out group-hover:ml-2 group-hover:max-w-24 group-hover:translate-x-0 group-hover:opacity-100">
            AI Chat
          </span>
        </button>
      )}

      {/* Modal panel */}
      {open && (
        <div
          ref={modalRef}
          className="fixed z-50 flex flex-col overflow-hidden rounded-none border border-border bg-background shadow-2xl"
          data-testid="chat-modal"
          style={
            modalPosition && modalSize
              ? {
                  left: modalPosition.x,
                  top: modalPosition.y,
                  width: modalSize.width,
                  height: modalSize.height,
                }
              : undefined
          }
        >
          {RESIZE_HANDLES.map(({ key, className, gripClassName }) => (
            <div
              key={key}
              className={cn("absolute z-20 h-5 w-5", className)}
              onPointerDown={(e) => handleResizePointerDown(key, e)}
            >
              <span
                className={cn(
                  "pointer-events-none absolute h-2.5 w-2.5 border-primary/40",
                  gripClassName,
                )}
              />
            </div>
          ))}

          {/* Header */}
          <div
            className={cn(
              "flex shrink-0 items-center justify-between border-b border-border bg-card/80 px-4 py-3 backdrop-blur-sm select-none",
              resizing ? "cursor-default" : dragging ? "cursor-grabbing" : "cursor-grab",
            )}
            onPointerDown={handleHeaderPointerDown}
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Zap size={13} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-tight">
                  BlueAccademy AI
                </p>
                <p className="text-[10px] text-muted-foreground">
                  K8s · Docker · Pulumi
                </p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => clearMutation.mutate()}
                  disabled={clearMutation.isPending || streaming}
                  data-testid="button-clear-chat"
                  title="Clear chat"
                >
                  <Trash2 size={12} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={closeChat}
                data-testid="button-close-chat"
                title="Close"
              >
                <X size={14} />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-auto px-4 py-4 space-y-3"
            onScroll={handleMessagesScroll}
          >
            {histLoading ? (
              <div className="space-y-3">
                {Array(3)
                  .fill(0)
                  .map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex gap-2",
                        i % 2 !== 0 && "flex-row-reverse"
                      )}
                    >
                      <Skeleton className="w-6 h-6 rounded-full shrink-0" />
                      <Skeleton
                        className="h-12 rounded-lg"
                        style={{ width: `${45 + i * 12}%` }}
                      />
                    </div>
                  ))}
              </div>
            ) : isEmpty ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                  <Zap size={18} className="text-primary" />
                </div>
                <p className="text-sm font-semibold text-foreground mb-0.5">
                  Ask anything
                </p>
                <p className="text-xs text-muted-foreground max-w-[240px] mb-5">
                  Concepts, commands, debugging — with real examples
                </p>
                <div className="grid grid-cols-1 gap-1.5 w-full">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      data-testid={`button-suggestion-${s
                        .slice(0, 20)
                        .replace(/\s+/g, "-")
                        .toLowerCase()}`}
                      onClick={() => sendMessage(s)}
                      className="text-left text-xs text-muted-foreground bg-card hover:bg-accent border border-border rounded-lg px-3 py-2 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)
            )}
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-border shrink-0 bg-background/80 backdrop-blur-sm">
            <div className="flex gap-2 items-end">
              <div className="relative flex-1">
                <ChatComposerInput
                  ref={composerRef}
                  value={input}
                  onValueChange={setInput}
                  referenceAttached={referenceAttached}
                  onReferenceAttachedChange={setReferenceAttached}
                  reference={reference}
                  onSubmit={() => sendMessage(input)}
                  placeholder="Use @this to attach the current card/exercise."
                  disabled={streaming}
                  className="min-h-[38px] max-h-24 text-[13px]"
                />
              </div>
              <Button
                size="icon"
                data-testid="button-send"
                onClick={() => sendMessage(input)}
                disabled={(!input.trim() && !referenceAttached) || streaming}
                className="h-[38px] w-[38px] shrink-0"
              >
                {streaming ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
