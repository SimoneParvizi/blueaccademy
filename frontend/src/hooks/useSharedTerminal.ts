import { useCallback, useEffect, useRef, useState } from "react";
import { resolveWebSocketUrl } from "@/lib/api-base";

export type SharedTerminalEntry = {
  id: number;
  type: "prompt" | "output" | "error" | "success" | "info";
  text: string;
};

type TerminalMessage =
  | { type: "snapshot"; entries: SharedTerminalEntry[] }
  | { type: "entry"; entry: SharedTerminalEntry }
  | { type: "clear" };

export function useSharedTerminal() {
  const [entries, setEntries] = useState<SharedTerminalEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      const ws = new WebSocket(resolveWebSocketUrl("/ws/terminal"));
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        retryCountRef.current = 0;
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
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        setConnected(false);
        retryCountRef.current += 1;
        if (retryCountRef.current >= 3) {
          setConnectionError("Shared terminal unavailable. Restart `npm run dev` to load the backend terminal session.");
        }
        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connect, 1000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((payload: object) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return false;
    wsRef.current.send(JSON.stringify(payload));
    return true;
  }, []);

  const sendCommand = useCallback((command: string) => {
    return send({ type: "command", command });
  }, [send]);

  const clearSession = useCallback(() => {
    return send({ type: "clear" });
  }, [send]);

  return {
    entries,
    connected,
    connectionError,
    sendCommand,
    clearSession,
  };
}
