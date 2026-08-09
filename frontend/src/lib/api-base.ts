const PYTHON_API_BASE = (import.meta.env.VITE_PYTHON_API_BASE_URL ?? "").replace(/\/+$/, "");
const PYTHON_API_PREFIX = "/api/v1";

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isApiPath(path: string): boolean {
  return path.startsWith("/api/");
}

function withPythonApiPrefix(path: string): string {
  if (!isApiPath(path) || path.startsWith(`${PYTHON_API_PREFIX}/`) || path === PYTHON_API_PREFIX) {
    return path;
  }

  return `${PYTHON_API_PREFIX}${path.slice("/api".length)}`;
}

export function resolveApiUrl(path: string): string {
  if (isAbsoluteUrl(path)) return path;
  if (isApiPath(path)) {
    const normalizedPath = withPythonApiPrefix(path);
    if (PYTHON_API_BASE.length > 0) return `${PYTHON_API_BASE}${normalizedPath}`;
    return normalizedPath;
  }
  return path;
}

export function getConfiguredPythonApiBase(): string {
  return PYTHON_API_BASE;
}

function getPythonWebSocketBase(): string {
  if (!PYTHON_API_BASE) return "";
  return PYTHON_API_BASE.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}

export function resolveWebSocketUrl(path: string): string {
  if (/^wss?:\/\//i.test(path)) return path;

  const pythonWsBase = getPythonWebSocketBase();
  if (pythonWsBase && path.startsWith("/ws/")) {
    return `${pythonWsBase}${path}`;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}
