import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatComposerInput } from "@/components/chat/chat-composer-input";
import { toast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Send,
  Trash2,
  Loader2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentReference } from "@/contexts/current-reference";
import { attachReferenceToMessage } from "@/lib/reference-token";
import { resolveApiUrl } from "@/lib/api-base";
import type { ChatMessage } from "@/lib/api-types";

const SESSION_ID = "dev-session";

type Message = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

// ── Markdown-lite renderer ─────────────────────────────────────────────────
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={`${keyPrefix}-b${i}`} className="font-semibold">{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith('`') && p.endsWith('`')) {
      return (
        <code key={`${keyPrefix}-c${i}`} className="bg-muted/60 px-1 py-0.5 rounded text-xs font-mono text-primary">
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
    return <div key={key} className="mb-1 mt-2 text-sm font-semibold text-foreground">{renderInline(h3[1], `${key}-h3`)}</div>;
  }

  const h2 = line.match(/^##\s+(.+)$/);
  if (h2) {
    return <div key={key} className="mb-1 mt-2 text-base font-semibold text-foreground">{renderInline(h2[1], `${key}-h2`)}</div>;
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
    <div className="text-sm leading-relaxed space-y-2">
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const inner = part.slice(3, -3);
          const nl = inner.indexOf("\n");
          const lang = nl > -1 ? inner.slice(0, nl).trim() : "";
          const code = nl > -1 ? inner.slice(nl + 1) : inner;
          return (
            <pre
              key={i}
              className="bg-muted/60 dark:bg-muted/30 rounded-md px-3 py-2.5 overflow-x-auto text-xs font-mono text-foreground leading-5"
            >
              {lang && (
                <span className="block text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">
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

// ── Message bubble ──────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div
      data-testid={`message-${msg.role}`}
      className={cn("flex", isUser && "justify-end")}
    >
      {/* Bubble */}
      <div
        className={cn(
          "max-w-[82%]",
          isUser
            ? "rounded-xl px-4 py-3 bg-primary/10 text-foreground rounded-tr-sm"
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
          <span className="inline-block w-1 h-4 bg-primary ml-0.5 animate-pulse align-text-bottom" />
        )}
      </div>
    </div>
  );
}

// ── Suggested prompts ───────────────────────────────────────────────────────
const SUGGESTIONS = [
  "Explain Kubernetes Pod restart policies",
  "Show me a multi-stage Docker build example",
  "How does Pulumi manage state?",
  "What's the difference between ClusterIP and NodePort?",
];

// ── Chat page ────────────────────────────────────────────────────────────────
export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [referenceAttached, setReferenceAttached] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const { reference } = useCurrentReference();
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  // Load history on mount
  const { data: history, isLoading: histLoading } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat/history", SESSION_ID],
    queryFn: () =>
      apiRequest("GET", `/api/chat/history?sessionId=${SESSION_ID}`).then((r) => r.json()),
  });

  useEffect(() => {
    if (history && messages.length === 0) {
      setMessages(
        history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      );
    }
  }, [history]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !shouldAutoScrollRef.current) return;
    container.scrollTop = container.scrollHeight;
    lastScrollTopRef.current = container.scrollTop;
  }, [messages]);

  const clearMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/chat/history?sessionId=${SESSION_ID}`),
    onMutate: async () => {
      setMessages([]);
      queryClient.setQueryData<ChatMessage[]>(
        ["/api/chat/history", SESSION_ID],
        [],
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/history", SESSION_ID] });
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

      // Optimistically add user message
      const userMsg: Message = { role: "user", content: finalText };
      const assistantMsg: Message = { role: "assistant", content: "", streaming: true };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setReferenceAttached(false);
      setStreaming(true);

      // Close any existing SSE
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const params = new URLSearchParams({
        sessionId: SESSION_ID,
        message: finalText,
      });

      // Use EventSource for SSE
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
            queryClient.invalidateQueries({ queryKey: ["/api/chat/history", SESSION_ID] });
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
              content: last.content || "Failed to get a response. Make sure HF_API_KEY or ANTHROPIC_API_KEY is set.",
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

  const isEmpty = messages.length === 0 && !histLoading;

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
    <div className="flex flex-col h-screen max-h-screen px-0">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight flex items-center gap-2" data-testid="text-chat-title">
            <MessageSquare size={18} className="text-primary" />
            AI Chat
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ask anything about K8s, Docker, and Pulumi
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending || streaming}
            data-testid="button-clear-chat"
            className="text-muted-foreground hover:text-foreground"
          >
            <Trash2 size={13} className="mr-1.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto px-8 py-6 space-y-5"
        onScroll={handleMessagesScroll}
      >
        {histLoading ? (
          <div className="space-y-4">
            {Array(3).fill(0).map((_, i) => (
              <div key={i} className={cn("flex gap-3", i % 2 !== 0 && "flex-row-reverse")}>
                <Skeleton className="w-7 h-7 rounded-full shrink-0" />
                <Skeleton className="h-16 rounded-xl" style={{ width: `${45 + i * 12}%` }} />
              </div>
            ))}
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
              <Zap size={22} className="text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground mb-1">BlueAccademy Assistant</h2>
            <p className="text-sm text-muted-foreground max-w-xs mb-8">
              Expert help for Kubernetes, Docker, and Pulumi. Ask anything — concepts, commands, debugging.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  data-testid={`button-suggestion-${s.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`}
                  onClick={() => sendMessage(s)}
                  className="text-left text-xs text-muted-foreground bg-card hover:bg-accent border border-border rounded-lg px-3 py-2.5 transition-colors"
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

      {/* Input area */}
      <div className="px-8 py-4 border-t border-border shrink-0 bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-3 items-end">
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
                className="text-sm"
              />
            </div>
            <Button
              size="icon"
              data-testid="button-send"
              onClick={() => sendMessage(input)}
              disabled={(!input.trim() && !referenceAttached) || streaming}
              className="h-11 w-11 shrink-0"
            >
              {streaming ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Send size={15} />
              )}
            </Button>
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground/40 mt-2">
          Powered by BlueAccademy AI — technical answers with real examples
        </p>
      </div>
    </div>
  );
}
