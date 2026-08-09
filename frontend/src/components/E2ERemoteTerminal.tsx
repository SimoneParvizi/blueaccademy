import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, TerminalSquare } from "lucide-react";
import { useRemoteE2ETerminal } from "@/hooks/useRemoteE2ETerminal";

const LINE_CLASSES: Record<string, string> = {
  prompt: "text-sky-300",
  output: "text-slate-200",
  error: "text-red-400",
  success: "text-emerald-300",
  info: "text-slate-400",
};

type Props = {
  serverId: number | null;
  sessionId: number | null;
  ready: boolean;
};

export default function E2ERemoteTerminal({ serverId, sessionId, ready }: Props) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const { entries, connected, connectionError, sendCommand, clearSession } = useRemoteE2ETerminal(serverId, sessionId);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  useEffect(() => {
    if (ready) {
      inputRef.current?.focus();
    }
  }, [ready, connected]);

  const statusLabel = useMemo(() => {
    if (!serverId) return "No host connected";
    if (!ready) return "Waiting for the host to be ready";
    if (!connected) return "Connecting to host shell";
    return sessionId ? "Sandbox session attached" : "Host shell connected";
  }, [serverId, ready, connected, sessionId]);

  const submit = () => {
    const cmd = input.trim();
    if (!cmd || !ready || !connected) return;
    setHistory((prev) => [cmd, ...prev]);
    setHistIdx(-1);
    setInput("");
    if (cmd === "clear") {
      clearSession();
      return;
    }
    sendCommand(cmd);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[#3c3f41] bg-[#2b2b2b]">
      <div className="flex items-center justify-between border-b border-[#3c3f41] px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          </div>
          <TerminalSquare size={14} className="text-white/40" />
          <span className="font-mono text-[11px] text-white/40">terminal · e2e-lab</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-white/40">{statusLabel}</span>
          <button
            type="button"
            onClick={() => clearSession()}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/60 transition-colors hover:bg-white/5 hover:text-white"
          >
            <RotateCcw size={12} />
            Clear
          </button>
        </div>
      </div>

      <div className="h-[455px] bg-[#1E1E1E] px-4 py-3 font-mono text-sm text-[#D4D4D4]">
        <div className="h-full overflow-auto">
          {!entries.length ? (
            <div className="text-[#8b949e]">Remote workspace is ready. Commands run on the Hetzner host.</div>
          ) : null}
          {entries.map((entry) => (
            <pre
              key={entry.id}
              className={`whitespace-pre-wrap break-words leading-6 ${LINE_CLASSES[entry.type] ?? "text-slate-200"}`}
            >
              {entry.text}
            </pre>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-[#3c3f41] bg-[#252526] px-4 py-3">
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#1E1E1E] px-3 py-2">
          <span className="font-mono text-sm text-emerald-300">$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submit();
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                const idx = Math.min(histIdx + 1, history.length - 1);
                setHistIdx(idx);
                setInput(history[idx] ?? "");
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                const idx = Math.max(histIdx - 1, -1);
                setHistIdx(idx);
                setInput(idx === -1 ? "" : history[idx] ?? "");
              }
            }}
            disabled={!ready}
            placeholder={
              ready
                ? sessionId
                  ? "type a command..."
                  : "type a host command..."
                : "wait for the host to be ready"
            }
            className="w-full bg-transparent font-mono text-sm text-[#D4D4D4] outline-none placeholder:text-[#6b7280] disabled:cursor-not-allowed"
          />
          {!connected && ready ? <Loader2 size={14} className="animate-spin text-white/40" /> : null}
        </div>
        {connectionError ? <p className="mt-2 text-xs text-red-400">{connectionError}</p> : null}
      </div>
    </div>
  );
}
