import { useCallback, useEffect, useRef, useState } from "react";
import { resolveWebSocketUrl } from "@/lib/api-base";

export type RemoteTerminalEntry = {
  id: number;
  type: "prompt" | "output" | "error" | "success" | "info";
  text: string;
};

type TerminalMessage =
  | { type: "snapshot"; entries: RemoteTerminalEntry[] }
  | { type: "entry"; entry: RemoteTerminalEntry }
  | { type: "clear" };

export function useRemoteE2ETerminal(serverId: number | null, sessionId: number | null) {
  const [entries, setEntries] = useState<RemoteTerminalEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setEntries([]);
    setConnected(false);
    setConnectionError(null);

    if (!serverId) return;

    const params = new URLSearchParams({ serverId: String(serverId) });
    if (sessionId) {
      params.set("sessionId", String(sessionId));
    }
    const ws = new WebSocket(resolveWebSocketUrl(`/ws/e2e-terminal?${params.toString()}`));
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setConnectionError(null);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as TerminalMessage;
      if (message.type === "snapshot") {
        setEntries(message.entries);
        return;
      }
      if (message.type === "clear") {
        setEntries([]);
        return;
      }
      setEntries((prev) => [...prev, message.entry]);
    };

    ws.onclose = () => {
      setConnected(false);
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };

    ws.onerror = () => {
      setConnectionError("Remote terminal unavailable.");
      ws.close();
    };

    return () => {
      ws.close();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, [serverId, sessionId]);

  const send = useCallback((payload: object) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return false;
    wsRef.current.send(JSON.stringify(payload));
    return true;
  }, []);

  const sendCommand = useCallback((command: string) => send({ type: "command", command }), [send]);
  const clearSession = useCallback(() => send({ type: "clear" }), [send]);

  return {
    entries,
    connected,
    connectionError,
    sendCommand,
    clearSession,
  };
}
