import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  RotateCcw,
  ArrowLeft,
  Search,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSharedTerminal } from "@/hooks/useSharedTerminal";
import { useCurrentReference } from "@/contexts/current-reference";
import k8sIcon from "../../imgs/k8s.svg";
import dockerIcon from "../../imgs/docker.png";
import pulumiIcon from "../../imgs/pulumi.png";
import githubActionsIcon from "../../imgs/ghactions.png";

type Exercise = {
  id: number;
  title: string;
  description: string;
  track: string;
  difficulty: string;
  scenario: string;
  objectives: string;
  validCommands: string;
  initialOutput: string;
  completionMessage: string;
  progress: {
    completed: boolean;
    completedAt?: number;
    attempts: number;
  } | null;
};

type TerminalLine = {
  type: "prompt" | "output" | "error" | "success" | "completion" | "info" | "meta";
  text: string;
};

type GuidedTerminalSnapshot = {
  lines: TerminalLine[];
  input: string;
  history: string[];
  histIdx: number;
  completed: boolean;
};

type ExerciseCommandResponse = {
  output: string;
  valid: boolean;
  completes: boolean;
  completionMessage?: string;
  matchedCommand?: string;
};

function normalizeGuidedExerciseCommand(command: string) {
  return command
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bk\b/g, "kubectl")
    .replace(/\bpo\b/g, "pods")
    .replace(/\bpod\b/g, "pods")
    .replace(/\bdeploy\b/g, "deployments")
    .replace(/\bdeployment\b/g, "deployments")
    .replace(/\bsvc\b/g, "service")
    .replace(/\bns\b/g, "namespace");
}

function InlineCopyCode({ value }: { value: string }) {
  const writeClipboardText = async () => {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  };

  const copyValue = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    await writeClipboardText();
  };

  return (
    <span className="group relative inline-flex max-w-full align-baseline">
      <code className="rounded bg-black/5 px-1 py-0.5 pr-5 font-mono text-[11px] text-foreground dark:bg-white/5">
        {value}
      </code>
      <button
        type="button"
        onClick={copyValue}
        className="absolute right-0.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded opacity-0 transition-opacity hover:bg-black/10 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-primary group-hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-white/10"
        aria-label={`Copy ${value}`}
        title="Copy"
      >
        <Copy size={10} aria-hidden="true" />
      </button>
    </span>
  );
}

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-b${index}`} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <InlineCopyCode key={`${keyPrefix}-c${index}`} value={part.slice(1, -1)} />;
    }
    return <span key={`${keyPrefix}-t${index}`}>{part}</span>;
  });
}

function RichTextBlock({ text, className, toneClassName }: { text: string; className?: string; toneClassName?: string }) {
  return (
    <div className={cn("whitespace-pre-line", className, toneClassName)}>
      {text.split("\n").map((line, lineIndex, lines) => (
        <span key={lineIndex}>
          {renderInline(line, `line-${lineIndex}`)}
          {lineIndex < lines.length - 1 && <br />}
        </span>
      ))}
    </div>
  );
}

// ── Track / Difficulty info ────────────────────────────────────────────────
const TRACK_INFO: Record<string, { iconSrc: string; badgeClass: string }> = {
  kubernetes: { iconSrc: k8sIcon, badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  docker: { iconSrc: dockerIcon, badgeClass: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  pulumi: { iconSrc: pulumiIcon, badgeClass: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  "github-actions": { iconSrc: githubActionsIcon, badgeClass: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
};

const DIFF_INFO: Record<string, { label: string; badgeClass: string }> = {
  easy: { label: "EASY", badgeClass: "bg-emerald-500/10 text-emerald-400" },
  medium: { label: "MED", badgeClass: "bg-amber-500/10 text-amber-400" },
  hard: { label: "HARD", badgeClass: "bg-red-500/10 text-red-400" },
};

type Level = 1 | 2 | 3;
type TrackFilter = "all" | "kubernetes" | "docker" | "pulumi" | "github-actions";

const TERMINAL_TRACK_FILTER_STORAGE_KEY = "terminal-track-filter";
const TERMINAL_LEVEL_FILTER_STORAGE_KEY = "terminal-level-filter";

function getStoredTrackFilter(): TrackFilter {
  if (typeof window === "undefined") return "all";
  const stored = window.localStorage.getItem(TERMINAL_TRACK_FILTER_STORAGE_KEY);
  if (
    stored === "all" ||
    stored === "kubernetes" ||
    stored === "docker" ||
    stored === "pulumi" ||
    stored === "github-actions"
  ) {
    return stored;
  }
  return "all";
}

function getStoredLevelFilter(): "all" | Level {
  if (typeof window === "undefined") return "all";
  const stored = window.localStorage.getItem(TERMINAL_LEVEL_FILTER_STORAGE_KEY);
  if (stored === "1") return 1;
  if (stored === "2") return 2;
  if (stored === "3") return 3;
  return "all";
}

const LEVEL_META: Record<Level, { label: string; subtitle: string; accentClass: string; softClass: string }> = {
  1: {
    label: "Level 1",
    subtitle: "Foundations",
    accentClass: "text-emerald-400",
    softClass: "bg-emerald-500/10",
  },
  2: {
    label: "Level 2",
    subtitle: "Intermediate",
    accentClass: "text-amber-400",
    softClass: "bg-amber-500/10",
  },
  3: {
    label: "Level 3",
    subtitle: "Advanced",
    accentClass: "text-red-400",
    softClass: "bg-red-500/10",
  },
};

function difficultyToLevel(difficulty: string): Level {
  if (difficulty === "easy") return 1;
  if (difficulty === "medium") return 2;
  return 3;
}

function getObjectiveStats(exercise: Exercise) {
  const total = JSON.parse(exercise.objectives || "[]").length;
  const done = exercise.progress?.completed ? total : 0;
  return { total, done };
}

function getDifficultyContourClass(difficulty: string) {
  if (difficulty === "easy") return "border-emerald-500/60 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]";
  if (difficulty === "medium") return "border-amber-500/60 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]";
  return "border-red-500/60 shadow-[0_0_0_1px_rgba(239,68,68,0.15)]";
}

function buildGuidedInitialLines(exercise: Exercise): TerminalLine[] {
  const initial: TerminalLine[] = [
    {
      type: "meta",
      text: "Guided terminal: only the expected commands in sequence will be accepted.",
    },
    { type: "meta", text: "" },
  ];
  if (exercise.initialOutput) {
    exercise.initialOutput.split("\n").forEach((line) => {
      initial.push({ type: "output", text: line });
    });
  }
  return initial;
}

// ── Terminal Emulator (Guided) ─────────────────────────────────────────────
function TerminalEmulator({
  exercise,
  onMatchedCommand,
  onReset,
  snapshot,
  onSnapshotChange,
}: {
  exercise: Exercise;
  onMatchedCommand?: (command: string) => void;
  onReset?: () => void;
  snapshot?: GuidedTerminalSnapshot;
  onSnapshotChange?: (snapshot: GuidedTerminalSnapshot) => void;
}) {
  const [lines, setLines] = useState<TerminalLine[]>(
    () => snapshot?.lines ?? buildGuidedInitialLines(exercise),
  );
  const [input, setInput] = useState(snapshot?.input ?? "");
  const [history, setHistory] = useState<string[]>(snapshot?.history ?? []);
  const [histIdx, setHistIdx] = useState(snapshot?.histIdx ?? -1);
  const [completed, setCompleted] = useState(snapshot?.completed ?? (exercise.progress?.completed ?? false));
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    onSnapshotChange?.({ lines, input, history, histIdx, completed });
  }, [completed, histIdx, history, input, lines, onSnapshotChange]);

  const commandMutation = useMutation({
    mutationFn: (command: string) =>
      apiRequest("POST", `/api/exercises/${exercise.id}/command`, { command }).then((r) => r.json() as Promise<ExerciseCommandResponse>),
    onSuccess: (data, command) => {
      const commandUsedForProgress =
        data.matchedCommand ??
        (data.valid && !data.output.includes("isn't part of the current exercise objectives.")
          ? command
          : undefined);

      if (commandUsedForProgress) {
        onMatchedCommand?.(commandUsedForProgress);
      }
      if (data.completes) {
        setCompleted(true);
        setLines((l) => [
          ...l,
          { type: "success", text: data.output },
          { type: "completion", text: `✓ ${data.completionMessage ?? "Exercise complete!"}` },
        ]);
      } else if (data.valid) {
        setLines((l) => [...l, { type: "output", text: data.output }]);
      } else {
        setLines((l) => [...l, { type: "error", text: data.output }]);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
    onError: () => {
      setLines((l) => [...l, { type: "error", text: "Error connecting to backend" }]);
    },
  });

  useEffect(() => {
    if (commandMutation.isPending) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [commandMutation.isPending, lines.length]);

  const resetMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/exercises/${exercise.id}/reset`),
    onSuccess: () => {
      setLines(buildGuidedInitialLines(exercise));
      setCompleted(false);
      setHistory([]);
      setHistIdx(-1);
      setInput("");
      onReset?.();
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      inputRef.current?.focus();
    },
  });

  const submit = () => {
    const cmd = input.trim();
    if (!cmd) return;
    setLines((l) => [...l, { type: "prompt", text: `$ ${cmd}` }]);
    setHistory((h) => [cmd, ...h]);
    setHistIdx(-1);
    setInput("");
    if (cmd === "clear") { setLines([]); return; }
    if (cmd === "help") {
      setLines((l) => [
        ...l,
        { type: "info", text: "Available tools: kubectl, docker, pulumi, helm" },
        { type: "info", text: "Type commands related to the exercise objectives." },
      ]);
      return;
    }
    commandMutation.mutate(cmd);
  };

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

  const lineColors: Record<string, string> = {
    prompt: "text-sky-300",
    output: "text-slate-200",
    error: "text-red-400",
    success: "text-sky-300",
    completion: "text-emerald-400",
    info: "text-blue-300",
    meta: "text-white/45",
  };

  const focusInputIfNotSelecting = () => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
      return;
    }
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#2b2b2b]">
      <div className="flex items-center gap-1.5 border-b border-[#3c3f41] bg-[#313335] px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
          <Button
            variant="ghost"
            size="icon"
            className="ml-1 h-5 w-5 text-white/35 hover:text-white/65"
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
            data-testid="button-terminal-reset"
            title="Reset exercise"
          >
            <RotateCcw size={11} />
          </Button>
        </div>
        <span className="ml-3 text-[11px] font-mono text-white/40 flex-1 text-center truncate">
          {exercise.track} — {exercise.title}
        </span>
        <div className="h-5 w-5 shrink-0" aria-hidden="true" />
      </div>

      <div className="flex-1 overflow-auto px-5 py-4 space-y-0.5" onClick={focusInputIfNotSelecting}>
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "text-xs leading-5 whitespace-pre-wrap break-all font-mono",
              line.type === "completion" && "inline-block rounded-none border border-emerald-400/80 px-2 py-1",
              lineColors[line.type],
            )}
          >
            {line.text}
          </div>
        ))}
        {commandMutation.isPending && (
          <div className="animate-pulse text-xs font-mono text-white/40">
            simulating terminal output...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 border-t border-[#3c3f41] bg-[#313335] px-5 py-2.5 shrink-0">
        <span className="text-xs font-mono text-primary shrink-0">$</span>
        <input
          ref={inputRef}
          data-testid="input-terminal-command"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={commandMutation.isPending}
          placeholder={completed ? "exercise complete - keep exploring with commands..." : "type a command..."}
          className="flex-1 bg-transparent text-xs font-mono text-slate-100 placeholder:text-white/20 outline-none caret-sky-300"
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// ── Free Terminal (WebSocket) ──────────────────────────────────────────────
function FreeTerminal() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const { entries, connected, connectionError, sendCommand, clearSession } = useSharedTerminal();
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  const submit = useCallback(() => {
    const cmd = input.trim();
    if (!cmd || !connected) return;
    setHistory((h) => [cmd, ...h]);
    setHistIdx(-1);
    setInput("");
    if (cmd === "clear") { clearSession(); return; }
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

  const lineColors: Record<string, string> = {
    prompt: "text-sky-300",
    output: "text-slate-200",
    error: "text-red-400",
    success: "text-sky-300",
    info: "text-blue-300",
  };

  const focusInputIfNotSelecting = () => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
      return;
    }
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#2b2b2b]">
      <div className="flex items-center gap-1.5 border-b border-[#3c3f41] bg-[#313335] px-4 py-2.5 shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
        <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
        <span className="ml-3 text-[11px] font-mono text-white/40 flex-1 text-center">blueaccademy — free terminal</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-white/35 hover:text-white/65"
          onClick={clearSession}
          data-testid="button-free-terminal-clear"
          title="Clear terminal"
        >
          <RotateCcw size={11} />
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-5 py-4 space-y-0.5" onClick={focusInputIfNotSelecting}>
        {entries.map((entry) => (
          <div key={entry.id} className={cn("text-xs leading-5 whitespace-pre-wrap break-all font-mono", lineColors[entry.type])}>
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

      <div className="flex items-center gap-2 border-t border-[#3c3f41] bg-[#313335] px-5 py-2.5 shrink-0">
        <span className="text-xs font-mono text-primary shrink-0">$</span>
        <input
          ref={inputRef}
          data-testid="input-free-terminal"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!connected}
          placeholder={connected ? "type any command…" : "connecting shared shell…"}
          className="flex-1 bg-transparent text-xs font-mono text-slate-100 placeholder:text-white/20 outline-none caret-sky-300"
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// ── YAML Exercise (GitHub Actions) ────────────────────────────────────────
const YAML_STARTER = `name:

on:

jobs:
  build:
    runs-on:
    steps:
      - uses: actions/checkout@v4
      - name:
`;

type YamlRule = { command: string; response: string; completes?: boolean };

function YamlExercise({
  exercise,
  onValidated,
}: {
  exercise: Exercise;
  onValidated: (passed: boolean[]) => void;
}) {
  const [content, setContent] = useState(YAML_STARTER);
  const [results, setResults] = useState<Array<{ description: string; passed: boolean }>>([]);
  const [validated, setValidated] = useState(false);
  const [completed, setCompleted] = useState(exercise.progress?.completed ?? false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumRef = useRef<HTMLDivElement>(null);

  // Validation rules = validCommands minus the __yaml_complete__ sentinel
  const rules: YamlRule[] = useMemo(
    () =>
      (JSON.parse(exercise.validCommands || "[]") as YamlRule[]).filter(
        (v) => v.command !== "__yaml_complete__",
      ),
    [exercise.validCommands],
  );

  // Reset when exercise changes
  useEffect(() => {
    setContent(YAML_STARTER);
    setResults([]);
    setValidated(false);
    setCompleted(exercise.progress?.completed ?? false);
  }, [exercise.id, exercise.progress?.completed]);

  const completeMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/exercises/${exercise.id}/command`, {
        command: "__yaml_complete__",
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
  });

  const syncScroll = () => {
    if (editorRef.current && lineNumRef.current) {
      lineNumRef.current.scrollTop = editorRef.current.scrollTop;
    }
  };

  const handleTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = content.substring(0, start) + "  " + content.substring(end);
    setContent(next);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + 2;
    });
  };

  const validate = () => {
    const lower = content.toLowerCase();
    const checks = rules.map((rule) => ({
      description: rule.response,
      passed: lower.includes(rule.command.toLowerCase()),
    }));
    setResults(checks);
    setValidated(true);
    onValidated(checks.map((c) => c.passed));
    if (!completed && checks.every((c) => c.passed)) {
      setCompleted(true);
      completeMutation.mutate();
    }
  };

  const reset = () => {
    setContent(YAML_STARTER);
    setResults([]);
    setValidated(false);
    onValidated(rules.map(() => false));
  };

  const lineCount = Math.max(content.split("\n").length, 24);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#2b2b2b]">
      {/* Header bar */}
      <div className="flex items-center gap-1.5 border-b border-[#3c3f41] bg-[#313335] px-4 py-2.5 shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
        <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
        <span className="ml-3 text-[11px] font-mono text-white/40 flex-1 text-center">
          .github/workflows/workflow.yml
        </span>
        <div className="ml-3 flex items-center gap-2 shrink-0">
          <button
            onClick={validate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary/15 text-primary text-[11px] font-medium border border-primary/30 hover:bg-primary/25 transition-colors"
          >
            ▶ Validate Workflow
          </button>
          <button
            onClick={reset}
            className="text-[11px] font-mono text-white/45 hover:text-white/70 transition-colors"
          >
            ↺ Reset
          </button>
          {completed && (
            <span className="text-[10px] font-mono text-emerald-400">
              ✓ Complete
            </span>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Line numbers */}
        <div
          ref={lineNumRef}
          className="w-[38px] shrink-0 select-none overflow-hidden border-r border-[#3c3f41] py-2"
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
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setValidated(false);
          }}
          onScroll={syncScroll}
          onKeyDown={handleTab}
          className="flex-1 resize-none bg-transparent p-2 font-mono text-[12px] leading-[18px] text-slate-200 outline-none caret-sky-300"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>

      {validated && results.length > 0 && (
        <div className="shrink-0 border-t border-[#3c3f41] bg-[#1e2228] px-5 py-3">
          <div className="space-y-1">
            {results.map((r, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-2 text-[11px] font-mono",
                  r.passed ? "text-emerald-400" : "text-red-400/80",
                )}
              >
                <span className="shrink-0">{r.passed ? "✓" : "✗"}</span>
                <span>{r.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page root ──────────────────────────────────────────────────────────────
export default function Terminal() {
  const params = useParams<{ exerciseId?: string }>();
  const [view, setView] = useState<"grid" | "terminal">(
    params.exerciseId ? "terminal" : "grid"
  );
  const [activeFilter, setActiveFilter] = useState<TrackFilter>(() => getStoredTrackFilter());
  const [activeLevel, setActiveLevel] = useState<"all" | Level>(() => getStoredLevelFilter());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | undefined>(
    params.exerciseId ? Number(params.exerciseId) : undefined
  );
  const [resettingExerciseId, setResettingExerciseId] = useState<number | null>(null);
  const [guidedSnapshots, setGuidedSnapshots] = useState<Record<number, GuidedTerminalSnapshot>>({});
  const [objectiveStates, setObjectiveStates] = useState<boolean[]>([]);
  const { setReference, clearReference } = useCurrentReference();

  const { data: exercises, isLoading } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
  });

  const selected = exercises?.find((e) => e.id === selectedId);

  // Derive objectives from selected exercise
  const objectivesStr = selected?.objectives ?? "";
  const objectives: string[] = useMemo(
    () => (objectivesStr ? JSON.parse(objectivesStr).slice(0, 4) : []),
    [objectivesStr],
  );

  const validCommandsStr = selected?.validCommands ?? "";
  const objectiveCommands: string[] = useMemo(() => {
    if (!validCommandsStr) return [];
    const parsed: Array<{ command: string }> = JSON.parse(validCommandsStr);
    return parsed
      .slice(0, objectives.length)
      .map((entry) => normalizeGuidedExerciseCommand(entry.command));
  }, [validCommandsStr, objectives.length]);

  const matchedCommandsRef = useRef<Set<string>>(new Set());

  const scenarioText = useMemo(
    () => (selected ? selected.scenario.replace(/^##\s+Scenario\s*\n+/i, "").trim() : ""),
    [selected?.scenario],
  );

  // Reset objective checkboxes when exercise changes
  useEffect(() => {
    if (!selected) {
      matchedCommandsRef.current.clear();
      setObjectiveStates([]);
      return;
    }
    matchedCommandsRef.current.clear();
    setObjectiveStates(objectives.map(() => Boolean(selected.progress?.completed)));
  }, [selected?.id, objectives, selected?.progress?.completed]);

  // Filtered exercises + counts
  const filtered = useMemo(() => {
    if (!exercises) return [];
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return exercises
      .filter((e) => activeFilter === "all" || e.track === activeFilter)
      .filter((e) => activeLevel === "all" || difficultyToLevel(e.difficulty) === activeLevel)
      .filter((e) => {
        if (!normalizedSearch) return true;
        const searchable = [
          e.track, // tag-like category
          e.difficulty, // tag-like difficulty
          e.title,
          e.description,
          e.scenario,
          e.objectives,
        ]
          .join(" ")
          .toLowerCase();
        return searchable.includes(normalizedSearch);
      });
  }, [exercises, activeFilter, activeLevel, searchQuery]);

  const counts = useMemo(() => {
    if (!exercises) return { all: 0, kubernetes: 0, docker: 0, pulumi: 0, "github-actions": 0 };
    return {
      all: exercises.length,
      kubernetes: exercises.filter((e) => e.track === "kubernetes").length,
      docker: exercises.filter((e) => e.track === "docker").length,
      pulumi: exercises.filter((e) => e.track === "pulumi").length,
      "github-actions": exercises.filter((e) => e.track === "github-actions").length,
    };
  }, [exercises]);

  const levelCounts = useMemo(() => {
    if (!exercises) return { 1: 0, 2: 0, 3: 0 };
    return {
      1: exercises.filter((e) => difficultyToLevel(e.difficulty) === 1).length,
      2: exercises.filter((e) => difficultyToLevel(e.difficulty) === 2).length,
      3: exercises.filter((e) => difficultyToLevel(e.difficulty) === 3).length,
    };
  }, [exercises]);

  useEffect(() => {
    window.localStorage.setItem(TERMINAL_TRACK_FILTER_STORAGE_KEY, activeFilter);
  }, [activeFilter]);

  useEffect(() => {
    window.localStorage.setItem(
      TERMINAL_LEVEL_FILTER_STORAGE_KEY,
      activeLevel === "all" ? "all" : String(activeLevel),
    );
  }, [activeLevel]);

  const groupedByLevel = useMemo(() => {
    return ([1, 2, 3] as Level[])
      .map((level) => ({
        level,
        meta: LEVEL_META[level],
        exercises: filtered.filter((ex) => difficultyToLevel(ex.difficulty) === level),
      }))
      .filter((group) => group.exercises.length > 0);
  }, [filtered]);

  const getLevelProgress = useCallback((levelExercises: Exercise[]) => {
    return levelExercises.reduce(
      (acc, ex) => {
        const { total, done } = getObjectiveStats(ex);
        return { total: acc.total + total, done: acc.done + done };
      },
      { total: 0, done: 0 },
    );
  }, []);

  // Reference context for AI chat
  useEffect(() => {
    if (view !== "terminal" || !selected) { clearReference(); return; }
    setReference({
      kind: "terminal",
      sourceLabel: "Terminal Lab scenario",
      title: selected.title,
      content: scenarioText,
    });
    return () => clearReference();
  }, [clearReference, view, selected, setReference, scenarioText]);

  const handleMatchedCommand = useCallback(
    (matchedCommand: string) => {
      const normalized = normalizeGuidedExerciseCommand(matchedCommand);
      if (matchedCommandsRef.current.has(normalized)) {
        return;
      }
      const objectiveIndex = objectiveCommands.findIndex(
        (objectiveCommand) => objectiveCommand === normalized,
      );
      if (objectiveIndex === -1) {
        return;
      }

      setObjectiveStates((cur) => {
        if (cur[objectiveIndex]) return cur;
        matchedCommandsRef.current.add(normalized);
        return cur.map((checked, i) => (i === objectiveIndex ? true : checked));
      });
    },
    [objectiveCommands],
  );

  const resetObjectives = useCallback(() => {
    matchedCommandsRef.current.clear();
    setObjectiveStates(objectives.map(() => false));
  }, [objectives]);

  const handleYamlValidated = useCallback((passed: boolean[]) => {
    setObjectiveStates((prev) => prev.map((v, i) => v || (passed[i] ?? false)));
  }, []);

  const openExercise = (id: number) => {
    setSelectedId(id);
    setView("terminal");
  };

  const clearGuidedSnapshot = useCallback((exerciseId: number) => {
    setGuidedSnapshots((current) => {
      if (!(exerciseId in current)) return current;
      const next = { ...current };
      delete next[exerciseId];
      return next;
    });
  }, []);

  const saveGuidedSnapshot = useCallback((exerciseId: number, snapshot: GuidedTerminalSnapshot) => {
    setGuidedSnapshots((current) => ({ ...current, [exerciseId]: snapshot }));
  }, []);

  const resetExerciseMutation = useMutation({
    mutationFn: (exerciseId: number) => apiRequest("POST", `/api/exercises/${exerciseId}/reset`),
    onMutate: (exerciseId) => {
      setResettingExerciseId(exerciseId);
    },
    onSuccess: (_, exerciseId) => {
      clearGuidedSnapshot(exerciseId);
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
    onSettled: () => {
      setResettingExerciseId(null);
    },
  });

  const backToGrid = () => {
    setSelectedId(undefined);
    setView("grid");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center border-b border-border px-5 py-3.5 shrink-0">
        <div>
          <h1
            className="text-lg font-semibold text-foreground tracking-tight md:text-xl"
            data-testid="text-terminal-title"
          >
            Terminal Simulation Lab
          </h1>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside
          className={cn(
            "shrink-0 border-r border-border overflow-y-auto transition-[width] duration-300",
            selected && view === "terminal" ? "w-[300px]" : "w-56",
          )}
        >
          {/* Filters — only in grid view (or terminal with no exercise) */}
          {!(selected && view === "terminal") && (
            <div className="p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.12em] mb-2.5 font-medium">
                Filter
              </p>
              {(["all", "kubernetes", "docker", "pulumi", "github-actions"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setActiveFilter(f);
                    if (view === "terminal" && !selected) setView("grid");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 rounded text-xs transition-colors mb-0.5",
                    activeFilter === f
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-accent/50",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {f !== "all" && (
                      <img
                        src={TRACK_INFO[f]?.iconSrc}
                        alt={`${f} icon`}
                        className={cn(
                          "shrink-0 object-contain",
                          f === "kubernetes" || f === "docker"
                            ? "h-8 w-8"
                            : "h-6 w-6",
                        )}
                      />
                    )}
                    <span>{f === "github-actions" ? "GitHub Actions" : f === "all" ? "all" : f}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {counts[f]}
                  </span>
                </button>
              ))}

              <div className="mt-4 border-t border-border pt-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-[0.12em] mb-2.5 font-medium">
                  Level
                </p>
                <button
                  onClick={() => setActiveLevel("all")}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 rounded text-xs transition-colors mb-0.5",
                    activeLevel === "all"
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-accent/50",
                  )}
                >
                  <span>All levels</span>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {counts.all}
                  </span>
                </button>

                {([1, 2, 3] as Level[]).map((level) => {
                  const meta = LEVEL_META[level];
                  const levelExercises = (exercises ?? []).filter(
                    (e) => difficultyToLevel(e.difficulty) === level,
                  );
                  const levelProgress = getLevelProgress(levelExercises);
                  return (
                    <button
                      key={level}
                      onClick={() => setActiveLevel(activeLevel === level ? "all" : level)}
                      className={cn(
                        "flex w-full items-start justify-between px-3 py-2 rounded text-xs transition-colors mb-0.5",
                        activeLevel === level
                          ? "bg-primary/10 text-primary"
                          : "text-foreground hover:bg-accent/50",
                      )}
                    >
                      <div className="flex-1 text-left">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={cn("text-[11px] font-semibold", meta.accentClass)}>
                              {level}
                            </span>
                            <span>{meta.subtitle}</span>
                          </span>
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {levelCounts[level]}
                          </span>
                        </div>
                        <div className="mt-1.5 h-[2px] w-full rounded-full bg-border overflow-hidden">
                          <div
                            className="h-full rounded-full transition-[width] duration-300"
                            style={{
                              width:
                                levelProgress.total > 0
                                  ? `${(levelProgress.done / levelProgress.total) * 100}%`
                                  : "0%",
                              background: "hsl(var(--primary))",
                            }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Active exercise details — replaces filters in terminal view */}
          {selected && view === "terminal" && (
            <div className="p-4">
              <button
                onClick={backToGrid}
                className="mb-3 w-full flex items-center justify-center gap-1.5 border border-white bg-white text-black text-[11px] py-2 rounded hover:bg-white/90 transition-colors"
              >
                <ArrowLeft size={10} />
                Back to exercises
              </button>
              <div className="flex gap-1.5 mb-4">
                <span
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded font-semibold tracking-[0.05em]",
                    DIFF_INFO[selected.difficulty]?.badgeClass,
                  )}
                >
                  {DIFF_INFO[selected.difficulty]?.label}
                </span>
                <span
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded border inline-flex items-center gap-1.5",
                    TRACK_INFO[selected.track]?.badgeClass,
                  )}
                >
                  {TRACK_INFO[selected.track]?.iconSrc && (
                    <img
                      src={TRACK_INFO[selected.track].iconSrc}
                      alt={`${selected.track} icon`}
                      className="h-4 w-4 shrink-0 object-contain"
                    />
                  )}
                  {selected.track}
                </span>
              </div>

              <div className="mt-4">
                <div className="rounded-md border border-border bg-card px-3 py-2.5">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Scenario
                  </p>
                  <RichTextBlock
                    text={scenarioText}
                    className="text-[12px] leading-relaxed"
                    toneClassName="text-[color:var(--terminal-sidebar-text)]"
                  />
                </div>
              </div>

            </div>
          )}
        </aside>

        {/* ── Main content ────────────────────────────────────────────── */}
        <main className="flex-1 min-h-0 overflow-auto">
          {/* GRID VIEW */}
          {view === "grid" && (
            <div className="p-6">
              {isLoading ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                  {Array(6)
                    .fill(0)
                    .map((_, i) => (
                      <Skeleton key={i} className="h-36 rounded-lg" />
                    ))}
                </div>
              ) : groupedByLevel.length === 0 ? (
                <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">No terminal simulation lab exercises yet.</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {groupedByLevel.map((group, groupIndex) => {
                    const levelProgress = getLevelProgress(group.exercises);
                    const completedExercises = group.exercises.filter((exercise) => exercise.progress?.completed).length;
                    return (
                      <section key={group.level}>
                        <div className="mb-3 flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <span className={cn("text-xl font-bold opacity-40", group.meta.accentClass)}>
                              {group.level}
                            </span>
                            <div>
                              <p className="text-sm font-semibold text-foreground leading-tight">
                                {group.meta.subtitle}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                <span className="text-emerald-400">{completedExercises}</span>
                                /{group.exercises.length} exercise{group.exercises.length !== 1 ? "s" : ""}
                              </p>
                            </div>
                          </div>
                          <div className="relative flex-1">
                            <div className="h-px w-full bg-border" />
                            {groupIndex === 0 && (
                              <div className="absolute right-0 top-1/2 -translate-y-1/2 bg-background pl-2">
                                <label className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1">
                                  <Search size={11} className="text-muted-foreground" />
                                  <input
                                    data-testid="input-terminal-exercise-search"
                                    type="text"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="Search exercises..."
                                    className="w-48 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/70 outline-none"
                                  />
                                </label>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                          {group.exercises.map((ex) => {
                            const { total: totalObj, done: doneObj } = getObjectiveStats(ex);
                            const track = TRACK_INFO[ex.track];
                            const contourClass = getDifficultyContourClass(ex.difficulty);

                            return (
                              <button
                                key={ex.id}
                                data-testid={`card-exercise-${ex.id}`}
                                onClick={() => openExercise(ex.id)}
                                className={cn(
                                  "group text-left rounded-lg border p-[18px] transition-all relative overflow-hidden animate-[lab-card-in_0.35s_ease_both]",
                                  ex.progress?.completed
                                    ? "bg-[#e6dfcf] border-emerald-500/70 shadow-[0_0_0_1px_rgba(16,185,129,0.25)] hover:border-emerald-500/85 hover:bg-[#ded6c3] dark:bg-[#232323] dark:hover:bg-[#2a2a2a]"
                                    : "bg-card border-border hover:border-muted-foreground/30 hover:bg-accent/30",
                                )}
                              >
                                <div className="flex items-center gap-1.5 mb-3">
                                  <span
                                    className={cn(
                                      "h-11 w-11 rounded-md border flex items-center justify-center bg-card/70",
                                      contourClass,
                                    )}
                                    title={ex.track}
                                    aria-label={ex.track}
                                  >
                                    {track?.iconSrc && (
                                      <img
                                        src={track.iconSrc}
                                        alt={`${ex.track} icon`}
                                        className={cn(
                                          "shrink-0 object-contain",
                                          ex.track === "docker" ? "h-8 w-8" : "h-7 w-7",
                                        )}
                                      />
                                    )}
                                  </span>
                                  <span className="ml-auto" />
                                  {ex.progress?.completed && (
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      aria-label={`Restart ${ex.title}`}
                                      title="Restart exercise"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (resettingExerciseId === ex.id) return;
                                        resetExerciseMutation.mutate(ex.id, {
                                          onSuccess: () => openExercise(ex.id),
                                        });
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key !== "Enter" && event.key !== " ") return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        if (resettingExerciseId === ex.id) return;
                                        resetExerciseMutation.mutate(ex.id, {
                                          onSuccess: () => openExercise(ex.id),
                                        });
                                      }}
                                      className={cn(
                                        "inline-flex h-5 w-5 items-center justify-center rounded-sm border border-border bg-white text-slate-700 shadow-none transition-colors",
                                        resettingExerciseId === ex.id
                                          ? "cursor-not-allowed opacity-60"
                                          : "hover:bg-slate-100",
                                      )}
                                    >
                                      <RotateCcw size={10} className={cn(resettingExerciseId === ex.id && "animate-spin")} />
                                    </span>
                                  )}
                                </div>

                                <h3 className="text-sm font-medium text-foreground mb-1 leading-snug">
                                  {ex.title}
                                </h3>
                                <p className="text-[11px] text-muted-foreground leading-relaxed mb-3.5 line-clamp-2">
                                  {ex.description}
                                </p>

                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-[3px] bg-border rounded-full overflow-hidden">
                                    <div
                                      className="h-full rounded-full transition-[width] duration-300"
                                      style={{
                                        width: `${totalObj > 0 ? (doneObj / totalObj) * 100 : 0}%`,
                                        background:
                                          doneObj === totalObj && totalObj > 0
                                            ? "hsl(var(--primary))"
                                            : "hsl(var(--muted-foreground))",
                                      }}
                                    />
                                  </div>
                                  <span
                                    className={cn(
                                      "text-[10px] font-medium",
                                      doneObj > 0 ? "text-primary" : "text-muted-foreground",
                                    )}
                                  >
                                    {doneObj}/{totalObj}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TERMINAL VIEW */}
          {view === "terminal" && (
            <div className="flex flex-col h-full">
              {selected ? (
                <>
                  {selected.track === "github-actions" ? (
                    <YamlExercise
                      key={selected.id}
                      exercise={selected}
                      onValidated={handleYamlValidated}
                    />
                  ) : (
                    <TerminalEmulator
                      key={selected.id}
                      exercise={selected}
                      onMatchedCommand={handleMatchedCommand}
                      onReset={resetObjectives}
                      snapshot={guidedSnapshots[selected.id]}
                      onSnapshotChange={(snapshot) => saveGuidedSnapshot(selected.id, snapshot)}
                    />
                  )}
                </>
              ) : (
                <>
                  <FreeTerminal />
                  <div className="shrink-0 border-t border-border bg-card px-5 py-3">
                    <p className="text-xs text-muted-foreground">
                      Sandboxed shell — run kubectl, docker, and pulumi commands freely.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
