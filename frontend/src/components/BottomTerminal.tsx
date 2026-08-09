import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  TerminalSquare,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  GripHorizontal,
  FileCode2,
  Copy,
  Check,
  Trash2,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSharedTerminal } from "@/hooks/useSharedTerminal";

type EditorTab = {
  id: string;
  name: string;
  content: string;
};

const LINE_COLORS: Record<string, string> = {
  prompt: "text-sky-300 font-mono",
  output: "text-slate-200 font-mono",
  error: "text-red-400 font-mono",
  success: "text-sky-300 font-mono",
  info: "text-blue-300 font-mono",
};

const MIN_HEIGHT = 38;
const DEFAULT_HEIGHT = 300;
const MAX_HEIGHT = 600;
const MIN_EDITOR_W = 200;
const MAX_EDITOR_W = 900;
const DEFAULT_EDITOR_W = 400;

let nextTabId = 2;

export default function BottomTerminal() {
  const [open, setOpen] = useState(true);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const { entries, connected, connectionError, sendCommand, clearSession } = useSharedTerminal();

  // Editor state
  const [showEditor, setShowEditor] = useState(true);
  const [editorWidth, setEditorWidth] = useState(DEFAULT_EDITOR_W);
  const [tabs, setTabs] = useState<EditorTab[]>([
    { id: "1", name: "scratch.yaml", content: "" },
  ]);
  const [activeTabId, setActiveTabId] = useState("1");
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumRef = useRef<HTMLDivElement>(null);
  const tabInputRef = useRef<HTMLInputElement>(null);

  // Vertical resize refs
  const vDragging = useRef(false);
  const vStartY = useRef(0);
  const vStartH = useRef(0);

  // Horizontal resize refs
  const hDragging = useRef(false);
  const hStartX = useRef(0);
  const hStartW = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (editingTabId) {
      setTimeout(() => tabInputRef.current?.focus(), 0);
    }
  }, [editingTabId]);

  // ── Vertical drag-to-resize ──
  const onVMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    vDragging.current = true;
    vStartY.current = e.clientY;
    vStartH.current = height;

    const onMove = (ev: MouseEvent) => {
      if (!vDragging.current) return;
      const delta = vStartY.current - ev.clientY;
      setHeight(Math.min(MAX_HEIGHT, Math.max(120, vStartH.current + delta)));
    };
    const onUp = () => {
      vDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [height]);

  // ── Horizontal drag-to-resize ──
  const onHMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    hDragging.current = true;
    hStartX.current = e.clientX;
    hStartW.current = editorWidth;

    const onMove = (ev: MouseEvent) => {
      if (!hDragging.current) return;
      const delta = hStartX.current - ev.clientX;
      setEditorWidth(Math.min(MAX_EDITOR_W, Math.max(MIN_EDITOR_W, hStartW.current + delta)));
    };
    const onUp = () => {
      hDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [editorWidth]);

  // ── Terminal submit ──
  const submit = useCallback(() => {
    const cmd = input.trim();
    if (!cmd || !connected) return;

    setHistory((h) => [cmd, ...h]);
    setHistIdx(-1);
    setInput("");

    if (cmd === "clear") {
      clearSession();
      return;
    }

    sendCommand(cmd);
  }, [input, connected, clearSession, sendCommand]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      submit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(idx);
      setInput(history[idx] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = Math.max(histIdx - 1, -1);
      setHistIdx(idx);
      setInput(idx === -1 ? "" : history[idx] ?? "");
    }
  };

  // ── Editor / tab helpers ──
  const lineCount = Math.max((activeTab?.content ?? "").split("\n").length, 1);

  const syncScroll = () => {
    if (editorRef.current && lineNumRef.current) {
      lineNumRef.current.scrollTop = editorRef.current.scrollTop;
    }
  };

  const handleTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = activeTab.content;
      updateTabContent(activeTab.id, val.substring(0, start) + "  " + val.substring(end));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(activeTab.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const updateTabContent = (id: string, content: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content } : t)));
  };

  const renameTab = (id: string, name: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)));
  };

  const addTab = () => {
    const id = String(nextTabId++);
    setTabs((prev) => [...prev, { id, name: `file-${id}.yaml`, content: "" }]);
    setActiveTabId(id);
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = { id: String(nextTabId++), name: "scratch.yaml", content: "" };
        setActiveTabId(fresh.id);
        return [fresh];
      }
      if (activeTabId === id) {
        setActiveTabId(next[next.length - 1].id);
      }
      return next;
    });
  };

  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-[#3c3f41] bg-[#2b2b2b]"
      style={{ height: open ? height : MIN_HEIGHT }}
      data-testid="bottom-terminal"
    >
      {/* Header bar */}
      <div
        className={cn(
          "flex items-center gap-2 px-4 shrink-0 select-none",
          open ? "py-0 h-[30px]" : "py-0 h-[38px]"
        )}
      >
        {open && (
          <div
            className="absolute left-0 right-0 -top-[5px] h-[10px] cursor-row-resize flex items-center justify-center z-10"
            onMouseDown={onVMouseDown}
          >
            <GripHorizontal size={14} className="text-white/20" />
          </div>
        )}

        <div className="flex items-center gap-1.5">
          {open && (
            <>
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
            </>
          )}
          <TerminalSquare size={12} className="ml-1 text-white/40" />
          <span className="text-[11px] font-mono text-white/40">terminal</span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {open && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-5 w-5 hover:text-white/60",
                showEditor ? "text-white/60" : "text-white/30",
              )}
              onClick={() => setShowEditor((s) => !s)}
              title={showEditor ? "Hide editor" : "Show editor"}
            >
              <FileCode2 size={10} />
            </Button>
          )}
          {open && entries.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-white/30 hover:text-white/60"
              onClick={clearSession}
              data-testid="button-bottom-terminal-clear"
              title="Clear terminal"
            >
              <RotateCcw size={10} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-white/30 hover:text-white/60"
            onClick={() => setOpen((o) => !o)}
            data-testid="button-bottom-terminal-toggle"
            title={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </Button>
        </div>
      </div>

      {/* Body */}
      {open && (
        <div className="flex flex-1 min-h-0">
          {/* ── Terminal pane ── */}
          <div className="flex flex-col flex-1 min-w-0 bg-[#0e0f11]">
            <div
              className="flex-1 overflow-auto px-4 py-2 space-y-0.5 bg-[#0e0f11]"
              onClick={() => inputRef.current?.focus()}
            >
              {entries.map((entry) => (
                <div key={entry.id} className={cn("text-xs leading-5 whitespace-pre-wrap break-all", LINE_COLORS[entry.type])}>
                  {entry.text}
                </div>
              ))}
              {!connected && (
                <div className="text-xs font-mono text-white/40">
                  {connectionError ?? "connecting shared shell..."}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-[#2a2d31] bg-[#14161a] px-4 py-2">
              <span className="shrink-0 text-xs font-mono text-sky-300">$</span>
              <input
                ref={inputRef}
                data-testid="input-bottom-terminal"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={!connected}
                placeholder={connected ? "type a command…" : "connecting shared shell…"}
                className="flex-1 bg-transparent text-xs font-mono text-slate-100 placeholder:text-white/20 outline-none caret-sky-300"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          {/* ── Editor pane ── */}
          {showEditor && (
            <>
              {/* Draggable vertical divider */}
              <div
                className="group flex w-[5px] shrink-0 cursor-col-resize items-center justify-center transition-colors hover:bg-primary/20"
                onMouseDown={onHMouseDown}
              >
                  <div className="h-full w-px bg-[#3c3f41] transition-colors group-hover:bg-primary/50" />
              </div>

              <div
                className="flex flex-col shrink-0 min-w-[200px]"
                style={{ width: editorWidth }}
              >
                {/* Tab bar */}
                <div className="flex h-[28px] shrink-0 items-center border-b border-[#3c3f41] bg-[#313335]">
                  <div className="flex-1 flex items-center overflow-x-auto min-w-0 scrollbar-none">
                    {tabs.map((tab) => (
                      <div
                        key={tab.id}
                        className={cn(
                          "group flex h-[28px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-[#3c3f41] px-3 transition-colors",
                          tab.id === activeTabId
                            ? "bg-[#3a3d41] text-white/80"
                            : "bg-[#313335] text-white/35 hover:text-white/60"
                        )}
                        onClick={() => setActiveTabId(tab.id)}
                        onDoubleClick={() => setEditingTabId(tab.id)}
                      >
                        <FileCode2 size={10} className="shrink-0 text-sky-300/60" />
                        {editingTabId === tab.id ? (
                          <input
                            ref={tabInputRef}
                            type="text"
                            value={tab.name}
                            onChange={(e) => renameTab(tab.id, e.target.value)}
                            onBlur={() => setEditingTabId(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") setEditingTabId(null);
                            }}
                            className="w-[80px] bg-transparent text-[11px] font-mono text-white/80 outline-none caret-sky-300"
                            spellCheck={false}
                          />
                        ) : (
                          <span className="text-[11px] font-mono truncate max-w-[100px]">
                            {tab.name}
                          </span>
                        )}
                        <button
                          className="opacity-0 group-hover:opacity-100 hover:text-red-400/70 transition-opacity ml-0.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(tab.id);
                          }}
                        >
                          <X size={9} />
                        </button>
                      </div>
                    ))}

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-[28px] w-7 shrink-0 rounded-none border-r border-[#3c3f41] text-white/25 hover:bg-[#3a3d41] hover:text-white/60"
                      onClick={addTab}
                      title="New tab"
                    >
                      <Plus size={10} />
                    </Button>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 px-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 text-white/25 hover:text-white/60"
                      onClick={copyToClipboard}
                      title="Copy to clipboard"
                    >
                      {copied ? <Check size={9} /> : <Copy size={9} />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 text-white/20 hover:text-red-400/70"
                      onClick={() => updateTabContent(activeTab.id, "")}
                      title="Clear editor"
                    >
                      <Trash2 size={9} />
                    </Button>
                  </div>
                </div>

                {/* Editor body */}
                <div className="flex min-h-0 flex-1 bg-[#2b2b2b]">
                  {/* Line numbers */}
                  <div
                    ref={lineNumRef}
                    className="w-[36px] shrink-0 select-none overflow-hidden border-r border-[#3c3f41] py-2"
                  >
                    {Array.from({ length: lineCount }, (_, i) => (
                      <div
                        key={i}
                        className="pr-2 text-right font-mono text-[11px] leading-[18px] text-white/20"
                      >
                        {i + 1}
                      </div>
                    ))}
                  </div>

                  {/* Textarea */}
                  <textarea
                    ref={editorRef}
                    value={activeTab.content}
                    onChange={(e) => updateTabContent(activeTab.id, e.target.value)}
                    onScroll={syncScroll}
                    onKeyDown={handleTab}
                    className="flex-1 resize-none bg-transparent p-2 font-mono text-[12px] leading-[18px] text-slate-200 outline-none caret-sky-300 placeholder:text-white/15"
                    placeholder={`# Write your YAML here\napiVersion: v1\nkind: Pod\nmetadata:\n  name: my-pod\nspec:\n  containers:\n  - name: nginx\n    image: nginx:latest`}
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
