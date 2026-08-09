import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSharedTerminal } from "@/hooks/useSharedTerminal";
import { useCurrentReference } from "@/contexts/current-reference";

// ─── DESIGN TOKENS (matches Terminal Lab) ───
const C = {
  bg: "#F5F1E8",
  surface: "#FFFFFF",
  surfaceHover: "#F0ECE4",
  border: "#E5E3DB",
  borderBright: "#D6D1C8",
  primary: "#2563EB",
  primaryFaint: "rgba(37,99,235,0.10)",
  green: "#2F855A", greenDim: "#276749", greenFaint: "rgba(47,133,90,0.10)", greenGlow: "rgba(47,133,90,0.18)",
  amber: "#B7791F", amberFaint: "rgba(183,121,31,0.12)",
  red: "#C53030", redFaint: "rgba(197,48,48,0.12)",
  cyan: "#2563EB", cyanFaint: "rgba(37,99,235,0.10)",
  text: "#333333",
  textDim: "#888888",
  textBright: "#1F1F1F",
  onDark: "#E0E0E0",
};

const DOMAIN_COLORS: Record<string, { color: string; bg: string }> = {
  "Application Design and Build": { color: C.cyan, bg: C.cyanFaint },
  "Application Deployment": { color: C.green, bg: C.greenFaint },
  "Application Observability and Maintenance": { color: C.amber, bg: C.amberFaint },
  "Application Environment, Configuration and Security": { color: C.primary, bg: C.primaryFaint },
  "Services and Networking": { color: C.red, bg: C.redFaint },
  "Infrastructure as Code": { color: C.primary, bg: C.primaryFaint },
};

const DIFF_COLORS: Record<string, { color: string; bg: string }> = {
  easy: { color: C.green, bg: C.greenFaint },
  medium: { color: C.amber, bg: C.amberFaint },
  hard: { color: C.red, bg: C.redFaint },
};

// ─── TYPES ───
type ValidationResult = {
  description: string;
  passed: boolean;
  output: string;
  expected?: string;
};

type CkadExercise = {
  id: number;
  number: number;
  title: string;
  domain: string;
  difficulty: string;
  timeMinutes: number;
  scenario: string;
  hints: string;
  solution: string;
  validations: string;
  cleanup: string;
  progress: {
    passed: boolean;
    attempts: number;
    lastAttemptAt: number;
    lastResult: string;
  } | null;
};

type KubeconfigInfo = { id: number; name: string; active: boolean; createdAt: number };

type ClusterServerInfo = {
  id: number;
  name: string;
  serverId: string | null;
  serverIp: string | null;
  status: string;
  errorMessage: string | null;
  serverType: string;
  location: string;
  kubeconfigId: number | null;
  minibluePort: number;
  createdAt: number;
};

type ClusterStatus = {
  id: number;
  status: string;
  serverIp: string | null;
  k3sReady: boolean;
  miniblueReady: boolean;
  errorMessage?: string;
};

type ClusterSession = {
  id: number;
  sessionId: string;
  clusterServerId: number;
  namespace: string;
  status: string; // "provisioning" | "ready" | "expired" | "error" | "destroyed"
  nodePort: number | null;
  errorMessage: string | null;
  expiresAt: number;
  createdAt: number;
};

// ─── HELPERS ───
function formatTTL(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── SHARED COMPONENTS ───
const Pill = ({ color, bg, children, style = {} }: { color: string; bg: string; children: React.ReactNode; style?: React.CSSProperties }) => (
  <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 3, background: bg, color, fontWeight: 600, letterSpacing: "0.04em", ...style }}>{children}</span>
);

// Panel collapse/expand icon — left = collapse, right = expand
const CollapseIcon = ({ direction }: { direction: "left" | "right" }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
    <rect x="0.5" y="0.5" width="15" height="15" rx="2.5" stroke="currentColor" strokeOpacity="0.4" />
    <rect x="2" y="2" width="4" height="12" rx="1" fill="currentColor" fillOpacity="0.18" />
    {direction === "left"
      ? <path d="M10 5.5L7.5 8L10 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      : <path d="M7 5.5L9.5 8L7 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    }
  </svg>
);

// ─── CLUSTER MANAGER (inline, matches style) ───
const SERVER_TYPES = [
  { value: "cx23", label: "CX23", desc: "2 vCPU / 4 GB", cost: "~€4.49/mo + IPv4" },
  { value: "cx33", label: "CX33", desc: "4 vCPU / 8 GB", cost: "~€6.99/mo + IPv4" },
] as const;

const LOCATIONS = [
  { value: "fsn1", label: "Falkenstein" },
  { value: "nbg1", label: "Nuremberg" },
  { value: "hel1", label: "Helsinki" },
] as const;

function ClusterPanel() {
  const [open, setOpen] = useState(false);
  const [hetznerToken, setHetznerToken] = useState("");
  const [clusterName, setClusterName] = useState("ckad-lab");
  const [serverType, setServerType] = useState("cx23");
  const [location, setLocation] = useState("nbg1");
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [confirmDestroy, setConfirmDestroy] = useState(false);

  // Manual kubeconfig
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualContent, setManualContent] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: kubeconfigs } = useQuery<KubeconfigInfo[]>({ queryKey: ["/api/kubeconfigs"], queryFn: () => apiRequest("GET", "/api/kubeconfigs").then(r => r.json()) });
  const { data: clusterServers } = useQuery<ClusterServerInfo[]>({ queryKey: ["/api/cluster/servers"], queryFn: () => apiRequest("GET", "/api/cluster/servers").then(r => r.json()) });
  const { data: sessions } = useQuery<ClusterSession[]>({ queryKey: ["/api/cluster/sessions"], queryFn: () => apiRequest("GET", "/api/cluster/sessions").then(r => r.json()), refetchInterval: 10000 });

  const activeKubeconfig = kubeconfigs?.find(k => k.active);
  const activeCluster = clusterServers?.find(s => s.status !== "destroyed");
  const isProvisioning = activeCluster && ["provisioning", "installing"].includes(activeCluster.status);
  const activeSession = sessions?.find(s => activeCluster && s.clusterServerId === activeCluster.id && ["provisioning", "ready"].includes(s.status));
  const isSessionProvisioning = activeSession?.status === "provisioning";

  const { data: clusterStatus } = useQuery<ClusterStatus>({
    queryKey: ["/api/cluster/servers", activeCluster?.id, "status"],
    queryFn: () => apiRequest("GET", `/api/cluster/servers/${activeCluster!.id}/status`).then(r => r.json()),
    enabled: !!activeCluster && ["provisioning", "installing"].includes(activeCluster.status),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (clusterStatus?.status === "ready") {
      queryClient.invalidateQueries({ queryKey: ["/api/kubeconfigs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cluster/servers"] });
    }
  }, [clusterStatus?.status]);

  const provisionMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/cluster/provision", { name: clusterName, hetznerToken, serverType, location }).then(r => { if (!r.ok) return r.json().then((d: any) => Promise.reject(d)); return r.json(); }),
    onSuccess: () => { setProvisionError(null); queryClient.invalidateQueries({ queryKey: ["/api/cluster/servers"] }); },
    onError: (err: any) => setProvisionError(err.detail || err.error || "Provisioning failed"),
  });

  const destroyMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/cluster/servers/${activeCluster!.id}`),
    onSuccess: () => { setConfirmDestroy(false); queryClient.invalidateQueries({ queryKey: ["/api/cluster/servers"] }); queryClient.invalidateQueries({ queryKey: ["/api/kubeconfigs"] }); },
  });

  const addManualMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/kubeconfigs", { name: manualName, content: manualContent, active: true }).then(r => { if (!r.ok) return r.json().then((d: any) => Promise.reject(d)); return r.json(); }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/kubeconfigs"] }); setManualName(""); setManualContent(""); setManualError(null); setManualOpen(false); },
    onError: (err: any) => setManualError(err.detail || err.error || "Connection failed"),
  });

  const createSessionMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/cluster/sessions", { clusterServerId: activeCluster!.id }).then(r => { if (!r.ok) return r.json().then((d: any) => Promise.reject(d)); return r.json(); }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/cluster/sessions"] }); },
  });
  const destroySessionMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/cluster/sessions/${activeSession!.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cluster/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kubeconfigs"] });
    },
  });

  // Poll the active session while provisioning so UI flips to ready automatically
  useQuery<ClusterSession>({
    queryKey: ["/api/cluster/sessions", activeSession?.id],
    queryFn: () => apiRequest("GET", `/api/cluster/sessions/${activeSession!.id}`).then(r => r.json()),
    enabled: !!activeSession && isSessionProvisioning,
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (activeSession?.status === "ready") {
      queryClient.invalidateQueries({ queryKey: ["/api/kubeconfigs"] });
    }
  }, [activeSession?.status]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setManualContent((ev.target?.result as string) || "");
    reader.readAsText(file);
    if (!manualName) setManualName(file.name.replace(/\.ya?ml$/, ""));
  };

  const connected = activeCluster?.status === "ready" || !!activeKubeconfig;
  const statusLabel = activeCluster?.status === "ready"
    ? `${activeCluster.name} (${activeCluster.serverType.toUpperCase()})`
    : isProvisioning ? "Provisioning..." : activeKubeconfig ? activeKubeconfig.name : "No cluster";

  return (
    <div style={{ padding: "0 16px", marginBottom: 16 }}>
      <button onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: connected ? C.greenFaint : C.redFaint, border: `1px solid ${connected ? C.green : C.red}33`, padding: "8px 12px", borderRadius: 5, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? C.green : isProvisioning ? C.amber : C.red, boxShadow: connected ? `0 0 6px ${C.green}` : "none" }} />
        <span style={{ flex: 1, fontSize: 11, color: connected ? C.green : C.text, fontWeight: 500 }}>{statusLabel}</span>
        <span style={{ fontSize: 10, color: C.textDim, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
      </button>

      {open && (
        <div style={{ marginTop: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: 14, animation: "fadeSlideIn 0.2s ease" }}>
          {activeCluster && activeCluster.status !== "destroyed" ? (
            <div>
              {/* Provisioning progress */}
              {["provisioning", "installing"].includes(clusterStatus?.status ?? activeCluster.status) && (
                <div style={{ marginBottom: 12 }}>
                  {[{ key: "provisioning", label: "Creating server" }, { key: "installing", label: "Installing k3s + miniblue" }, { key: "ready", label: "Connected" }].map((step, i) => {
                    const currentIdx = ["provisioning", "installing", "ready"].indexOf(clusterStatus?.status ?? activeCluster.status);
                    const done = i < currentIdx; const active = i === currentIdx;
                    return (
                      <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 10, color: done ? C.green : active ? C.amber : C.textDim }}>{done ? "✓" : active ? "●" : "○"}</span>
                        <span style={{ fontSize: 11, color: done ? C.green : active ? C.textBright : C.textDim, fontWeight: active ? 500 : 400 }}>{step.label}</span>
                      </div>
                    );
                  })}
                  {activeCluster.serverIp && <p style={{ fontSize: 10, color: C.textDim, margin: "4px 0 0 18px" }}>IP: {activeCluster.serverIp}</p>}
                </div>
              )}
              {activeCluster.status === "ready" && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <Pill color={C.green} bg={C.greenFaint}>k3s ready</Pill>
                    <Pill color={clusterStatus?.miniblueReady ? C.green : C.amber} bg={clusterStatus?.miniblueReady ? C.greenFaint : C.amberFaint}>miniblue {clusterStatus?.miniblueReady ? "ready" : "..."}</Pill>
                  </div>
                  <p style={{ fontSize: 10, color: C.textDim, margin: 0 }}>{activeCluster.serverIp} · {activeCluster.serverType.toUpperCase()} · {activeCluster.location}</p>

                  {/* Session management */}
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 8px 0" }}>Practice Session</p>
                    {!activeSession ? (
                      <>
                        <button
                          disabled={createSessionMutation.isPending}
                          onClick={() => createSessionMutation.mutate()}
                          style={{ width: "100%", background: C.primary, border: "none", color: C.surface, padding: "7px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 500, opacity: createSessionMutation.isPending ? 0.6 : 1 }}
                        >
                          {createSessionMutation.isPending ? "Starting..." : "Start Practice Session"}
                        </button>
                        <p style={{ fontSize: 9, color: C.textDim, margin: "6px 0 0 0" }}>Isolated vCluster sandbox · 3h TTL · auto-destroyed</p>
                        {createSessionMutation.isError && (
                          <p style={{ fontSize: 10, color: C.red, margin: "6px 0 0 0" }}>{(createSessionMutation.error as any)?.detail ?? (createSessionMutation.error as any)?.error ?? "Failed to start session"}</p>
                        )}
                      </>
                    ) : activeSession.status === "provisioning" ? (
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.amber, animation: "blink 1s step-end infinite" }} />
                          <span style={{ fontSize: 11, color: C.textBright }}>Provisioning vCluster…</span>
                        </div>
                        <p style={{ fontSize: 9, color: C.textDim, margin: 0 }}>namespace: {activeSession.namespace} · usually ~60–90s</p>
                      </div>
                    ) : activeSession.status === "ready" ? (
                      <div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                          <Pill color={C.green} bg={C.greenFaint}>session active</Pill>
                          <Pill color={C.textDim} bg={C.bg}>TTL {formatTTL(activeSession.expiresAt)}</Pill>
                        </div>
                        <p style={{ fontSize: 10, color: C.textDim, margin: "0 0 8px 0" }}>{activeSession.namespace} · NodePort {activeSession.nodePort}</p>
                        <button
                          disabled={destroySessionMutation.isPending}
                          onClick={() => destroySessionMutation.mutate()}
                          style={{ fontSize: 10, color: C.red, background: C.redFaint, border: `1px solid ${C.red}33`, padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}
                        >
                          {destroySessionMutation.isPending ? "Ending..." : "End Session"}
                        </button>
                      </div>
                    ) : activeSession.status === "error" ? (
                      <div>
                        <div style={{ background: C.redFaint, border: `1px solid ${C.red}33`, borderRadius: 4, padding: 8, marginBottom: 6 }}>
                          <p style={{ margin: 0, fontSize: 10, color: C.red }}>{activeSession.errorMessage ?? "Session failed"}</p>
                        </div>
                        <button
                          onClick={() => destroySessionMutation.mutate()}
                          style={{ fontSize: 10, color: C.textDim, background: "transparent", border: `1px solid ${C.border}`, padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}
                        >
                          {destroySessionMutation.isPending ? "..." : "Dismiss"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
              {activeCluster.status === "error" && (
                <div style={{ background: C.redFaint, border: `1px solid ${C.red}33`, borderRadius: 4, padding: 10, marginBottom: 12 }}>
                  <p style={{ margin: 0, fontSize: 11, color: C.red }}>{activeCluster.errorMessage}</p>
                </div>
              )}
              {!confirmDestroy ? (
                <button onClick={() => setConfirmDestroy(true)} style={{ fontSize: 10, color: C.red, background: C.redFaint, border: `1px solid ${C.red}33`, padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>Destroy Cluster</button>
              ) : (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: C.red }}>Confirm?</span>
                  <button onClick={() => destroyMutation.mutate()} disabled={destroyMutation.isPending} style={{ fontSize: 10, color: C.surface, background: C.red, border: "none", padding: "4px 10px", borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}>{destroyMutation.isPending ? "..." : "Yes"}</button>
                  <button onClick={() => setConfirmDestroy(false)} style={{ fontSize: 10, color: C.textDim, background: "transparent", border: `1px solid ${C.border}`, padding: "4px 8px", borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}>No</button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px 0" }}>Quick Setup — Hetzner</p>
              <input type="password" value={hetznerToken} onChange={e => setHetznerToken(e.target.value)} placeholder="Hetzner API token" style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "7px 10px", fontSize: 11, color: C.textBright, fontFamily: "inherit", marginBottom: 6, outline: "none" }} />
              <input type="text" value={clusterName} onChange={e => setClusterName(e.target.value)} style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 10, color: C.textBright, fontFamily: "inherit", outline: "none", marginBottom: 4 }} />
              <div style={{ display: "flex", gap: 4, marginBottom: 6, minWidth: 0 }}>
                <select value={serverType} onChange={e => setServerType(e.target.value)} style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 6px", fontSize: 10, color: C.textBright, fontFamily: "inherit" }}>
                  {SERVER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label} ({t.cost})</option>)}
                </select>
                <select value={location} onChange={e => setLocation(e.target.value)} style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 6px", fontSize: 10, color: C.textBright, fontFamily: "inherit" }}>
                  {LOCATIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              {provisionError && <p style={{ fontSize: 10, color: C.red, margin: "0 0 6px 0" }}>{provisionError}</p>}
              <button disabled={!hetznerToken || !clusterName || provisionMutation.isPending} onClick={() => { setProvisionError(null); provisionMutation.mutate(); }} style={{ width: "100%", background: C.primary, border: "none", color: C.surface, padding: "8px", borderRadius: 4, cursor: !hetznerToken ? "default" : "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 500, opacity: !hetznerToken ? 0.5 : 1 }}>
                {provisionMutation.isPending ? "Creating server..." : "Provision Cluster"}
              </button>
              <p style={{ fontSize: 9, color: C.textDim, margin: "6px 0 0 0" }}>k3s + miniblue on Hetzner. ~2 min. Hourly billing.</p>

              {/* Manual toggle */}
              <button onClick={() => setManualOpen(!manualOpen)} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 12, background: "transparent", border: "none", color: C.textDim, cursor: "pointer", fontFamily: "inherit", fontSize: 10, padding: 0 }}>
                <span style={{ transition: "transform 0.2s", transform: manualOpen ? "rotate(90deg)" : "rotate(0)" }}>▸</span>
                Manual kubeconfig
              </button>
              {manualOpen && (
                <div style={{ marginTop: 8 }}>
                  <input type="text" value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Cluster name" style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 10, color: C.textBright, fontFamily: "inherit", marginBottom: 6, outline: "none" }} />
                  <input ref={fileRef} type="file" accept=".yaml,.yml" onChange={handleFile} style={{ display: "none" }} />
                  <button onClick={() => fileRef.current?.click()} style={{ width: "100%", background: "transparent", border: `1px solid ${C.border}`, color: C.textDim, padding: "6px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit", marginBottom: 6 }}>Upload kubeconfig</button>
                  <textarea value={manualContent} onChange={e => setManualContent(e.target.value)} placeholder="Or paste YAML..." rows={3} style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "6px 8px", fontSize: 10, color: C.textBright, fontFamily: "inherit", resize: "none", outline: "none", marginBottom: 6 }} />
                  {manualError && <p style={{ fontSize: 10, color: C.red, margin: "0 0 6px 0" }}>{manualError}</p>}
                  <button disabled={!manualName || !manualContent || addManualMutation.isPending} onClick={() => { setManualError(null); addManualMutation.mutate(); }} style={{ width: "100%", background: C.primary, border: "none", color: C.surface, padding: "7px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit", opacity: !manualName || !manualContent ? 0.5 : 1 }}>
                    {addManualMutation.isPending ? "Connecting..." : "Connect"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MAIN CKAD SIM ───
export default function CkadSim() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [showHints, setShowHints] = useState<Record<number, boolean>>({});
  const [showSolution, setShowSolution] = useState<Record<number, boolean>>({});
  const [validateResults, setValidateResults] = useState<Record<number, { passed: boolean; results: ValidationResult[] }>>({});
  const [timers, setTimers] = useState<Record<number, number>>({});
  const [running, setRunning] = useState<Record<number, boolean>>({});
  const [flagged, setFlagged] = useState<Record<number, boolean>>({});
  const [collapsedDomains, setCollapsedDomains] = useState<Record<string, boolean>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [taskCollapsed, setTaskCollapsed] = useState(false);
  const [termInput, setTermInput] = useState("");
  const intervalsRef = useRef<Record<number, NodeJS.Timeout>>({});
  const termRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setReference, clearReference } = useCurrentReference();

  // Shared terminal
  const { entries, connected: termConnected, connectionError, sendCommand, clearSession } = useSharedTerminal();

  // Fetch exercises
  const { data: exercises, isLoading } = useQuery<CkadExercise[]>({
    queryKey: ["/api/ckad/exercises"],
    queryFn: () => apiRequest("GET", "/api/ckad/exercises").then(r => r.json()),
  });

  const q = exercises?.[activeIdx];
  const hints: string[] = q ? JSON.parse(q.hints || "[]") : [];
  const domainColor = q ? DOMAIN_COLORS[q.domain] ?? { color: C.cyan, bg: C.cyanFaint } : { color: C.cyan, bg: C.cyanFaint };
  const diffColor = q ? DIFF_COLORS[q.difficulty] ?? { color: C.text, bg: C.bg } : { color: C.text, bg: C.bg };

  // Group exercises by domain
  const domains = exercises ? Array.from(new Set(exercises.map(e => e.domain))) : [];
  const domainGroups = domains.map(d => ({ domain: d, exercises: exercises!.filter(e => e.domain === d) }));

  // Stats
  const totalQ = exercises?.length ?? 0;
  const completedQ = exercises?.filter(e => e.progress?.passed).length ?? 0;

  // Current exercise result (from validation or from stored progress)
  const displayResult = q ? (validateResults[q.id] ?? (q.progress?.lastResult ? { passed: q.progress.passed, results: JSON.parse(q.progress.lastResult) } : null)) : null;

  // Set current reference for AI chat context
  useEffect(() => {
    if (!q) { clearReference(); return; }
    const requestText = q.scenario.replace(/^##\s+Exercise\s+\d+\s*/i, "").trim();
    setReference({ kind: "ckad", sourceLabel: "CKAD exercise request", title: `Exercise ${q.number}: ${q.title}`, content: requestText });
    return () => clearReference();
  }, [clearReference, q, setReference]);

  // Auto-scroll terminal
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [entries]);

  // Cleanup timer intervals
  useEffect(() => {
    return () => { Object.values(intervalsRef.current).forEach(clearInterval); };
  }, []);

  // Timer controls
  const startTimer = useCallback((qId: number, minutes: number) => {
    if (running[qId]) return;
    const startVal = timers[qId] ?? minutes * 60;
    setTimers(p => ({ ...p, [qId]: startVal }));
    setRunning(p => ({ ...p, [qId]: true }));
    intervalsRef.current[qId] = setInterval(() => {
      setTimers(prev => {
        const next = (prev[qId] ?? startVal) - 1;
        if (next <= 0) { clearInterval(intervalsRef.current[qId]); setRunning(p => ({ ...p, [qId]: false })); return { ...prev, [qId]: 0 }; }
        return { ...prev, [qId]: next };
      });
    }, 1000);
  }, [running, timers]);

  const pauseTimer = useCallback((qId: number) => {
    clearInterval(intervalsRef.current[qId]);
    setRunning(p => ({ ...p, [qId]: false }));
  }, []);

  const resetTimer = useCallback((qId: number, minutes: number) => {
    clearInterval(intervalsRef.current[qId]);
    setRunning(p => ({ ...p, [qId]: false }));
    setTimers(p => ({ ...p, [qId]: minutes * 60 }));
  }, []);

  const formatTime = (sec: number | undefined, defaultMin: number) => {
    const s = sec ?? defaultMin * 60;
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  };

  // Validate mutation
  const validateMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/ckad/exercises/${id}/validate`).then(r => r.json()),
    onSuccess: (data, id) => {
      setValidateResults(p => ({ ...p, [id]: data }));
      queryClient.invalidateQueries({ queryKey: ["/api/ckad/exercises"] });
    },
  });

  // Cleanup mutation
  const cleanupMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/ckad/exercises/${id}/cleanup`).then(r => r.json()),
    onSuccess: (_, id) => {
      setValidateResults(p => { const n = { ...p }; delete n[id]; return n; });
      queryClient.invalidateQueries({ queryKey: ["/api/ckad/exercises"] });
    },
  });

  // Terminal submit
  const handleTermCommand = () => {
    if (!termInput.trim() || !termConnected) return;
    if (termInput.trim() === "clear") { clearSession(); } else { sendCommand(termInput.trim()); }
    setTermInput("");
  };

  if (isLoading) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: C.bg, color: C.textDim, fontFamily: "Inter, sans-serif", fontSize: 13 }}>Loading exercises...</div>;
  }

  if (!exercises || exercises.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          background: C.bg,
          color: C.textDim,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: 13,
          textAlign: "center",
          padding: 24,
        }}
      >
        No CKAD simulation exercises yet.
      </div>
    );
  }

  const currentTime = q ? (timers[q.id] ?? q.timeMinutes * 60) : 0;
  const isRunning = q ? running[q.id] : false;
  const timeColor = currentTime <= 0 && q && timers[q.id] != null ? C.red : currentTime < 60 ? C.red : currentTime < (q?.timeMinutes ?? 7) * 30 ? C.amber : C.text;

  // Parse scenario markdown lite
  const renderScenario = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith("```")) {
        const inner = part.slice(3, -3);
        const nl = inner.indexOf("\n");
        const code = nl > -1 ? inner.slice(nl + 1) : inner;
        return <pre key={i} style={{ background: C.surfaceHover, border: `1px solid ${C.border}`, borderRadius: 4, padding: 12, fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-wrap", margin: "8px 0", overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}><code>{code}</code></pre>;
      }
      return part.split("\n").map((line, j) => {
        if (!line.trim()) return null;
        if (line.startsWith("## ")) return <h2 key={`${i}-${j}`} style={{ fontSize: 14, fontWeight: 600, color: C.textBright, margin: "12px 0 6px 0" }}>{line.slice(3)}</h2>;
        if (line.startsWith("### ")) return <h3 key={`${i}-${j}`} style={{ fontSize: 12, fontWeight: 600, color: C.textBright, margin: "8px 0 4px 0" }}>{line.slice(4)}</h3>;
        if (/^[-\d.]/.test(line)) {
          const text = line.replace(/^[-\d.]+\s*/, "");
          return <div key={`${i}-${j}`} style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 12, color: C.text, lineHeight: 1.6 }}><span style={{ color: C.primary, flexShrink: 0, marginTop: 2 }}>▸</span><span dangerouslySetInnerHTML={{ __html: text.replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${C.textBright}">$1</strong>`).replace(/`([^`]+)`/g, `<code style="background:${C.primaryFaint};padding:1px 5px;border-radius:3px;font-size:11px;color:${C.primary};font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace">$1</code>`) }} /></div>;
        }
        return <p key={`${i}-${j}`} style={{ margin: "4px 0", fontSize: 12, color: C.text, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: line.replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${C.textBright}">$1</strong>`).replace(/`([^`]+)`/g, `<code style="background:${C.primaryFaint};padding:1px 5px;border-radius:3px;font-size:11px;color:${C.primary};font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace">$1</code>`) }} />;
      });
    });
  };

  return (
    <div style={{ display: "flex", height: "100%", background: C.bg, fontFamily: "Inter, sans-serif", color: C.text }}>

      {/* ── LEFT SIDEBAR ── */}
      <aside style={{ width: sidebarCollapsed ? 28 : 260, borderRight: `1px solid ${C.border}`, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", transition: "width 0.2s ease" }}>
        {sidebarCollapsed ? (
          <button onClick={() => setSidebarCollapsed(false)} title="Expand sidebar" style={{ flex: 1, background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 12, color: C.textDim }} >
            <CollapseIcon direction="right" />
          </button>
        ) : (
          <>
            {/* Progress summary */}
            <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 8px 0" }}>CKAD Simulation</p>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: C.textBright, fontWeight: 500 }}>{completedQ}/{totalQ}</span>
                  <span style={{ fontSize: 10, color: C.textDim }}>completed</span>
                </div>
                <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: totalQ > 0 ? `${(completedQ / totalQ) * 100}%` : "0%", background: C.green, borderRadius: 2, transition: "width 0.4s" }} />
                </div>
              </div>
              <button onClick={() => setSidebarCollapsed(true)} title="Collapse sidebar" style={{ background: "transparent", border: "none", cursor: "pointer", color: C.textDim, padding: 2, marginTop: -2 }}>
                <CollapseIcon direction="left" />
              </button>
            </div>

            {/* Cluster status */}
            <ClusterPanel />

            {/* Domain sections */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
              {domainGroups.map(({ domain, exercises: domExs }) => {
                const dc = DOMAIN_COLORS[domain] ?? { color: C.cyan, bg: C.cyanFaint };
                const isDomainCollapsed = collapsedDomains[domain] ?? false;
                return (
                  <div key={domain} style={{ marginBottom: 16 }}>
                    <button
                      onClick={() => setCollapsedDomains(p => ({ ...p, [domain]: !isDomainCollapsed }))}
                      style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: isDomainCollapsed ? 0 : 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", textAlign: "left" }}
                    >
                      <div style={{ width: 3, height: 12, borderRadius: 1, background: dc.color, flexShrink: 0 }} />
                      <p style={{ margin: 0, fontSize: 10, color: C.textDim, letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: 1.2, flex: 1 }}>{domain}</p>
                      <span style={{ fontSize: 9, color: C.textDim, marginRight: 2 }}>{domExs.length}</span>
                      <span style={{ fontSize: 9, color: C.textDim, transition: "transform 0.15s", transform: isDomainCollapsed ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>▲</span>
                    </button>
                    {!isDomainCollapsed && domExs.map(ex => {
                      const globalIdx = exercises.indexOf(ex);
                      const isActive = globalIdx === activeIdx;
                      const isDone = ex.progress?.passed;
                      const isFlagged = flagged[ex.id];
                      return (
                        <button key={ex.id} onClick={() => setActiveIdx(globalIdx)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: isActive ? dc.bg : "transparent", border: "none", padding: "7px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit", marginBottom: 1, textAlign: "left", transition: "all 0.15s" }}>
                          <span style={{ width: 18, height: 18, borderRadius: 3, border: `1.5px solid ${isDone ? C.green : isActive ? C.amber : C.borderBright}`, background: isDone ? C.greenFaint : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: C.green, flexShrink: 0 }}>
                            {isDone ? "✓" : isFlagged ? "⚑" : ex.number}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 11, color: isActive ? C.textBright : C.text, fontWeight: isActive ? 500 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ex.title}</p>
                          </div>
                          <Pill color={DIFF_COLORS[ex.difficulty]?.color ?? C.text} bg={DIFF_COLORS[ex.difficulty]?.bg ?? C.bg} style={{ fontSize: 8 }}>{ex.difficulty.toUpperCase()}</Pill>
                        </button>
                      );
                    })}
                  </div>
                );
              })}

            </div>
          </>
        )}
      </aside>

      {/* ── MAIN CONTENT ── */}
      {q ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Header bar */}
          <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "12px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.textBright }}>Exercise {q.number}</span>
            <Pill color={domainColor.color} bg={domainColor.bg}>{q.domain}</Pill>
            <Pill color={diffColor.color} bg={diffColor.bg}>{q.difficulty.toUpperCase()}</Pill>
            <div style={{ flex: 1 }} />

            {/* Flag */}
            <button onClick={() => setFlagged(p => ({ ...p, [q.id]: !p[q.id] }))} style={{ background: flagged[q.id] ? C.amberFaint : "transparent", border: `1px solid ${flagged[q.id] ? C.amber : C.border}`, color: flagged[q.id] ? C.amber : C.textDim, padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "inherit", transition: "all 0.15s" }}>
              {flagged[q.id] ? "⚑ Flagged" : "⚐ Flag"}
            </button>

            {/* Timer */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 8px" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: timeColor, fontVariantNumeric: "tabular-nums", minWidth: 40, textAlign: "center" }}>
                {formatTime(timers[q.id], q.timeMinutes)}
              </span>
              {!isRunning ? (
                <button onClick={() => startTimer(q.id, q.timeMinutes)} style={{ background: C.greenFaint, border: `1px solid ${C.green}`, color: C.green, padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>
                  {timers[q.id] != null && timers[q.id]! < q.timeMinutes * 60 ? "Resume" : "Start"}
                </button>
              ) : (
                <button onClick={() => pauseTimer(q.id)} style={{ background: C.amberFaint, border: `1px solid ${C.amber}`, color: C.amber, padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>Pause</button>
              )}
              <button onClick={() => resetTimer(q.id, q.timeMinutes)} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textDim, padding: "2px 6px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>↺</button>
            </div>
          </div>

          {/* Split: task panel + terminal */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

            {/* Task panel */}
            <div style={{ width: taskCollapsed ? 28 : "42%", borderRight: `1px solid ${C.border}`, overflowY: taskCollapsed ? "hidden" : "auto", padding: taskCollapsed ? 0 : 20, flexShrink: 0, transition: "width 0.2s ease", position: "relative" }}>
              {taskCollapsed ? (
                <button onClick={() => setTaskCollapsed(false)} title="Expand task panel" style={{ width: "100%", height: "100%", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 12, color: C.textDim }}>
                  <CollapseIcon direction="right" />
                </button>
              ) : (
              <>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.textBright, fontFamily: "Georgia, serif" }}>{q.title}</h2>
              <button onClick={() => setTaskCollapsed(true)} title="Collapse task panel" style={{ background: "transparent", border: "none", cursor: "pointer", color: C.textDim, padding: 2, flexShrink: 0, marginLeft: 8, marginTop: -2 }}>
                <CollapseIcon direction="left" />
              </button>
              </div>
              <p style={{ margin: "0 0 16px 0", fontSize: 10, color: C.textDim }}>{q.domain} · {q.timeMinutes} minutes</p>

              {/* Scenario */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: 16, marginBottom: 16 }}>
                {renderScenario(q.scenario)}
              </div>

              {/* Hints */}
              {hints.length > 0 && (
                <>
                  <button onClick={() => setShowHints(p => ({ ...p, [q.id]: !p[q.id] }))} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: C.cyan, cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: "4px 0", marginBottom: 8 }}>
                    <span style={{ fontSize: 10, transition: "transform 0.2s", transform: showHints[q.id] ? "rotate(90deg)" : "rotate(0)" }}>▸</span>
                    Show hints ({hints.length})
                  </button>
                  {showHints[q.id] && (
                    <div style={{ background: C.cyanFaint, border: `1px solid ${C.cyan}33`, borderRadius: 6, padding: 14, marginBottom: 16, animation: "fadeSlideIn 0.2s ease" }}>
                      {hints.map((h, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, marginBottom: i < hints.length - 1 ? 8 : 0 }}>
                          <span style={{ color: C.cyan, fontSize: 10, fontWeight: 600, flexShrink: 0, marginTop: 2 }}>{i + 1}</span>
                          <span style={{ fontSize: 11, color: C.text, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: h.replace(/`([^`]+)`/g, `<code style="background:${C.cyanFaint};padding:1px 4px;border-radius:3px;font-size:10px">$1</code>`) }} />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Solution */}
              <button onClick={() => setShowSolution(p => ({ ...p, [q.id]: !p[q.id] }))} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: C.amber, cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: "4px 0", marginBottom: 8 }}>
                <span style={{ fontSize: 10, transition: "transform 0.2s", transform: showSolution[q.id] ? "rotate(90deg)" : "rotate(0)" }}>▸</span>
                Show solution
              </button>
              {showSolution[q.id] && (
                <div style={{ background: C.amberFaint, border: `1px solid ${C.amber}33`, borderRadius: 6, padding: 14, marginBottom: 16, animation: "fadeSlideIn 0.2s ease" }}>
                  {renderScenario(q.solution)}
                </div>
              )}

              {/* Validation results */}
              {displayResult && (
                <div style={{ background: displayResult.passed ? C.greenFaint : C.redFaint, border: `1px solid ${displayResult.passed ? C.green : C.red}33`, borderRadius: 6, padding: 14, marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 13, color: displayResult.passed ? C.green : C.red }}>{displayResult.passed ? "✓" : "✗"}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: displayResult.passed ? C.green : C.red }}>
                      {displayResult.passed ? "All checks passed!" : `${displayResult.results.filter(r => r.passed).length}/${displayResult.results.length} checks passed`}
                    </span>
                  </div>
                  {displayResult.results.map((r, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: r.passed ? C.green : C.red, marginTop: 2 }}>{r.passed ? "✓" : "✗"}</span>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: r.passed ? C.green : C.red, fontWeight: 500 }}>{r.description}</p>
                        {!r.passed && r.output && (
                          <p style={{ margin: "2px 0 0 0", fontSize: 10, color: C.textDim }}>
                            Got: <span style={{ color: C.red }}>{r.output || "(empty)"}</span>
                            {r.expected && <> · Expected: <span style={{ color: C.green }}>{r.expected}</span></>}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                <button disabled={validateMutation.isPending} onClick={() => validateMutation.mutate(q.id)} style={{ flex: 1, background: q.progress?.passed ? C.primaryFaint : C.primary, border: `1px solid ${C.primary}`, color: q.progress?.passed ? C.primary : C.surface, padding: 10, borderRadius: 5, cursor: validateMutation.isPending ? "default" : "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 500, transition: "all 0.2s" }}>
                  {validateMutation.isPending ? "Running checks..." : q.progress?.passed ? "✓ Passed" : "Check Solution"}
                </button>
                <button disabled={cleanupMutation.isPending} onClick={() => { cleanupMutation.mutate(q.id); setShowHints(p => ({ ...p, [q.id]: false })); setShowSolution(p => ({ ...p, [q.id]: false })); if (q) resetTimer(q.id, q.timeMinutes); }} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textDim, padding: "10px 14px", borderRadius: 5, cursor: cleanupMutation.isPending ? "default" : "pointer", fontSize: 12, fontFamily: "inherit", transition: "all 0.15s" }}>
                  {cleanupMutation.isPending ? "Cleaning..." : "Clean up"}
                </button>
              </div>

              {/* Nav buttons */}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button disabled={activeIdx === 0} onClick={() => setActiveIdx(p => p - 1)} style={{ flex: 1, background: "transparent", border: `1px solid ${C.border}`, color: activeIdx === 0 ? C.borderBright : C.textDim, padding: 8, borderRadius: 4, cursor: activeIdx === 0 ? "default" : "pointer", fontSize: 11, fontFamily: "inherit" }}>← Previous</button>
                <button disabled={activeIdx === totalQ - 1} onClick={() => setActiveIdx(p => p + 1)} style={{ flex: 1, background: "transparent", border: `1px solid ${C.border}`, color: activeIdx === totalQ - 1 ? C.borderBright : C.textDim, padding: 8, borderRadius: 4, cursor: activeIdx === totalQ - 1 ? "default" : "pointer", fontSize: 11, fontFamily: "inherit" }}>Next →</button>
              </div>
              </>
              )}
            </div>

            {/* Terminal panel */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "6px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", gap: 5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.red }} />
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.amber }} />
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.primary }} />
                </div>
                <span style={{ fontSize: 10, color: C.textDim, flex: 1, textAlign: "center" }}>labforge — exercise {q.number}</span>
                <span style={{ fontSize: 9, color: termConnected ? C.greenDim : C.red, background: termConnected ? C.greenFaint : C.redFaint, padding: "2px 6px", borderRadius: 3 }}>
                  {termConnected ? "shell ready" : "shell offline"}
                </span>
              </div>
              <div ref={termRef} onClick={() => inputRef.current?.focus()} style={{ flex: 1, overflow: "auto", padding: 16, fontSize: 12, lineHeight: 1.7, cursor: "text", background: C.surfaceHover, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                {entries.map(entry => (
                  <div key={entry.id} style={{ marginBottom: 1 }}>
                    {entry.type === "prompt" && <span style={{ color: C.green }}>{entry.text}</span>}
                    {entry.type === "output" && <span style={{ color: C.text, whiteSpace: "pre-wrap" }}>{entry.text}</span>}
                    {entry.type === "error" && <span style={{ color: C.red, whiteSpace: "pre-wrap" }}>{entry.text}</span>}
                    {entry.type === "info" && <span style={{ color: C.textDim, fontStyle: "italic" }}>{entry.text}</span>}
                    {entry.type === "success" && <span style={{ color: C.green }}>{entry.text}</span>}
                  </div>
                ))}
                {!termConnected && entries.length === 0 && (
                  <div style={{ color: C.textDim }}>{connectionError ?? "connecting shared shell..."}</div>
                )}
                <div style={{ display: "flex", alignItems: "center", marginTop: 2 }}>
                  <span style={{ color: C.green, marginRight: 8 }}>$</span>
                  <input
                    ref={inputRef}
                    value={termInput}
                    onChange={e => setTermInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleTermCommand()}
                    disabled={!termConnected}
                    placeholder={termConnected ? "type a command..." : "connecting..."}
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: C.textBright, fontFamily: "inherit", fontSize: 12, caretColor: C.primary }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span style={{ width: 7, height: 14, background: C.primary, opacity: 0.6, animation: "blink 1s step-end infinite" }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.textDim }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 24, margin: "0 0 8px 0", opacity: 0.3 }}>☸</p>
            <p style={{ fontSize: 13, margin: "0 0 4px 0" }}>Select an exercise to start</p>
            <p style={{ fontSize: 11, opacity: 0.6 }}>Connect a cluster to enable auto-grading</p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes blink { 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}
