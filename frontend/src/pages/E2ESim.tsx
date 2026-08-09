import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, CircleHelp, Cloud, Layers3, Loader2, RotateCcw, Server, TerminalSquare } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import E2ERemoteTerminal from "@/components/E2ERemoteTerminal";

type TrackId = "kubernetes" | "pulumi" | "azure" | "hybrid";

type ValidationResult = {
  description: string;
  passed: boolean;
  output: string;
  expected?: string;
};

type RealEnvExercise = {
  id: number;
  number: number;
  title: string;
  track: TrackId;
  domain: string;
  difficulty: "easy" | "medium" | "hard";
  timeMinutes: number;
  scenario: string;
  hints: string;
  solution: string;
  progress: {
    passed: boolean;
    attempts: number;
    lastResult?: string;
  } | null;
};

type ClusterServerInfo = {
  id: number;
  name: string;
  serverIp: string | null;
  status: string;
  errorMessage: string | null;
  serverType: string;
  location: string;
  minibluePort: number;
  idleStartedAt: number | null;
};

type ClusterSession = {
  id: number;
  clusterServerId: number;
  sessionId: string;
  namespace: string;
  status: string;
  errorMessage: string | null;
  expiresAt: number;
};

type ClusterStatus = {
  id: number;
  status: string;
  serverIp: string | null;
  k3sReady: boolean;
  miniblueReady: boolean;
  errorMessage?: string;
};

type OpenEditorResponse = {
  url: string;
  port: number;
};

const TRACK_META: Record<TrackId, { label: string; dotClass: string }> = {
  kubernetes: { label: "Kubernetes", dotClass: "bg-blue-500" },
  pulumi: { label: "Pulumi", dotClass: "bg-orange-500" },
  azure: { label: "Azure", dotClass: "bg-violet-500" },
  hybrid: { label: "Hybrid", dotClass: "bg-emerald-500" },
};

const SERVER_TYPES = [
  { value: "cx23", label: "CX23", desc: "2 vCPU / 4 GB", price: "~€4.49/mo + IPv4" },
  { value: "cx33", label: "CX33", desc: "4 vCPU / 8 GB", price: "~€6.99/mo + IPv4" },
] as const;

const LOCATIONS = [
  { value: "fsn1", label: "Falkenstein" },
  { value: "nbg1", label: "Nuremberg" },
  { value: "hel1", label: "Helsinki" },
] as const;

function formatTTL(expiresAt: number) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

function formatIdleShutdown(idleStartedAt: number | null) {
  if (!idleStartedAt) return "30m after the environment becomes idle";
  const msLeft = idleStartedAt + 30 * 60 * 1000 - Date.now();
  if (msLeft <= 0) return "shutting down soon";
  const mins = Math.ceil(msLeft / 60000);
  return `auto shutdown in ~${mins}m if no session is active`;
}

function parseValidationResults(value: string | undefined): ValidationResult[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-b-${index}`} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={`${keyPrefix}-c-${index}`}
          className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[13px] text-primary"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={`${keyPrefix}-t-${index}`}>{part}</span>;
  });
}

function renderScenarioMarkdown(content: string): ReactNode[] {
  const lines = content.replace(/\r/g, "").split("\n");
  const nodes: ReactNode[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (trimmed.startsWith("## ")) {
      nodes.push(
        <h3 key={`h2-${i}`} className="font-sans text-sm font-semibold leading-7 text-foreground">
          {renderInlineMarkdown(trimmed.slice(3), `h2-${i}`)}
        </h3>,
      );
      continue;
    }

    if (trimmed.startsWith("### ")) {
      nodes.push(
        <h4 key={`h3-${i}`} className="text-sm font-semibold text-foreground">
          {renderInlineMarkdown(trimmed.slice(4), `h3-${i}`)}
        </h4>,
      );
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      const items: Array<{ number: string; text: string }> = [];
      let j = i;
      while (j < lines.length) {
        const match = lines[j].trim().match(/^(\d+)\.\s+(.*)$/);
        if (!match) break;
        items.push({ number: match[1], text: match[2] });
        j += 1;
      }
      nodes.push(
        <ol key={`ol-${i}`} className="space-y-2">
          {items.map((item, index) => (
            <li key={`ol-${i}-${index}`} className="flex gap-3 text-sm leading-7 text-foreground">
              <span className="w-5 shrink-0 text-muted-foreground">{item.number}.</span>
              <span>{renderInlineMarkdown(item.text, `ol-${i}-${index}`)}</span>
            </li>
          ))}
        </ol>,
      );
      i = j - 1;
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      const items: string[] = [];
      let j = i;
      while (j < lines.length) {
        const match = lines[j].trim().match(/^[-*]\s+(.*)$/);
        if (!match) break;
        items.push(match[1]);
        j += 1;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="space-y-2">
          {items.map((item, index) => (
            <li key={`ul-${i}-${index}`} className="flex gap-3 text-sm leading-7 text-foreground">
              <span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{renderInlineMarkdown(item, `ul-${i}-${index}`)}</span>
            </li>
          ))}
        </ul>,
      );
      i = j - 1;
      continue;
    }

    nodes.push(
      <p key={`p-${i}`} className="text-sm leading-7 text-foreground">
        {renderInlineMarkdown(trimmed, `p-${i}`)}
      </p>,
    );
  }

  return nodes;
}

function EnvironmentPanel() {
  const [hetznerToken, setHetznerToken] = useState("");
  const [clusterName, setClusterName] = useState("e2e-lab");
  const [serverType, setServerType] = useState("cx23");
  const [location, setLocation] = useState("nbg1");
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [editorUrl, setEditorUrl] = useState<string | null>(null);

  const { data: clusterServers } = useQuery<ClusterServerInfo[]>({
    queryKey: ["/api/cluster/servers"],
    queryFn: () => apiRequest("GET", "/api/cluster/servers").then((r) => r.json()),
    refetchInterval: 10000,
  });

  const { data: sessions } = useQuery<ClusterSession[]>({
    queryKey: ["/api/cluster/sessions"],
    queryFn: () => apiRequest("GET", "/api/cluster/sessions").then((r) => r.json()),
    refetchInterval: 10000,
  });

  const activeCluster = clusterServers?.find((server) => server.status !== "destroyed");
  const activeSession = sessions?.find(
    (session) => activeCluster && session.clusterServerId === activeCluster.id && ["provisioning", "ready"].includes(session.status),
  );

  const { data: clusterStatus } = useQuery<ClusterStatus>({
    queryKey: ["/api/cluster/servers", activeCluster?.id, "status"],
    queryFn: () => apiRequest("GET", `/api/cluster/servers/${activeCluster!.id}/status`).then((r) => r.json()),
    enabled: !!activeCluster && ["provisioning", "installing"].includes(activeCluster.status),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (clusterStatus?.status === "ready") {
      queryClient.invalidateQueries({ queryKey: ["/api/cluster/servers"] });
    }
  }, [clusterStatus?.status]);

  const provisionMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/cluster/provision", {
        name: clusterName,
        hetznerToken,
        serverType,
        location,
      }).then(async (response) => {
        if (!response.ok) throw await response.json();
        return response.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cluster/servers"] });
    },
  });

  const createSessionMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/cluster/sessions", {
        clusterServerId: activeCluster!.id,
      }).then(async (response) => {
        if (!response.ok) throw await response.json();
        return response.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cluster/sessions"] });
    },
  });

  const destroySessionMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/cluster/sessions/${activeSession!.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cluster/sessions"] });
    },
  });

  const destroyClusterMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/cluster/servers/${activeCluster!.id}`),
    onSuccess: () => {
      setConfirmDestroy(false);
      queryClient.invalidateQueries({ queryKey: ["/api/cluster/servers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cluster/sessions"] });
    },
  });

  const debugMutation = useMutation({
    mutationFn: () =>
      apiRequest("GET", `/api/cluster/servers/${activeCluster!.id}/debug`).then(async (response) => {
        if (!response.ok) throw await response.json();
        return response.json() as Promise<{ ok: boolean; stdout: string; stderr: string; code: number }>;
      }),
  });

  const openEditorMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/cluster/servers/${activeCluster!.id}/open-editor`, {
        sessionId: activeSession?.id,
      }).then(async (response) => {
        if (!response.ok) throw await response.json();
        return response.json() as Promise<OpenEditorResponse>;
      }),
    onSuccess: (data) => {
      setEditorUrl(data.url);
      window.open(data.url, "_blank", "noopener,noreferrer");
    },
  });

  const isProvisioning = activeCluster && ["provisioning", "installing"].includes(activeCluster.status);
  const ready = activeCluster?.status === "ready" && activeSession?.status === "ready";
  const miniblueEndpoint =
    activeCluster?.serverIp ? `http://${activeCluster.serverIp}:${activeCluster.minibluePort}` : null;
  const hostStatusLabel = clusterStatus?.status ?? activeCluster?.status ?? "unknown";

  return (
    <section className="rounded-2xl border border-border bg-card/80 px-5 py-5">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Server size={16} className="text-primary" />
        Sandboxed Host
        <Tooltip delayDuration={180}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Environment details"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <CircleHelp size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align="start"
            className="max-w-[260px] border-border bg-card text-sm leading-6 text-foreground"
          >
            Provision one sandboxed Hetzner host. This installs k3s, miniblue, Kyverno, and the E2E helper tooling.
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="mt-4 space-y-4">
        {!activeCluster ? (
          <>
            <div className="rounded-xl border border-border bg-background/70 px-4 py-4 dark:bg-card">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Not provisioned</p>

              <div className="mt-4 grid gap-3">
                <input
                  type="password"
                  value={hetznerToken}
                  onChange={(event) => setHetznerToken(event.target.value)}
                  placeholder="Hetzner token"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none placeholder:text-muted-foreground"
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    value={clusterName}
                    onChange={(event) => setClusterName(event.target.value)}
                    placeholder="Cluster name"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <select
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    aria-label="Location"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none"
                  >
                    {LOCATIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <select
                  value={serverType}
                  onChange={(event) => setServerType(event.target.value)}
                  aria-label="Server type"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none"
                >
                  {SERVER_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label} · {type.desc} · {type.price}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => provisionMutation.mutate()}
                disabled={!hetznerToken.trim() || provisionMutation.isPending}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {provisionMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} className="text-primary" />}
                Provision sandbox host
              </button>
            </div>

            {provisionMutation.error ? (
              <p className="text-sm text-red-600">
                {(provisionMutation.error as any)?.detail || (provisionMutation.error as any)?.error || "Provisioning failed."}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-background/70 px-4 py-4 dark:bg-card">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Host</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {activeCluster.name} · {activeCluster.serverType.toUpperCase()}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {activeCluster.serverIp ?? "Waiting for IP"} · {hostStatusLabel}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatIdleShutdown(activeCluster.idleStartedAt)}
                </p>
                {clusterStatus?.miniblueReady ? (
                  <p className="mt-1 text-xs text-muted-foreground">miniblue ready</p>
                ) : null}
              </div>

              <div className="rounded-xl border border-border bg-background/70 px-4 py-4 dark:bg-card">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Sandbox session</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {activeSession ? `${activeSession.sessionId} · ${activeSession.status}` : "Not created yet"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {activeSession ? `${activeSession.namespace} · ${formatTTL(activeSession.expiresAt)}` : "Create one before running the exercise"}
                </p>
              </div>
            </div>

            {miniblueEndpoint ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                miniblue endpoint: <code className="font-mono text-foreground">{miniblueEndpoint}</code>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {!activeSession ? (
                <button
                  type="button"
                  onClick={() => createSessionMutation.mutate()}
                  disabled={activeCluster.status !== "ready" || createSessionMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {createSessionMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Layers3 size={16} className="text-primary" />}
                  Create sandbox session
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => destroySessionMutation.mutate()}
                  disabled={destroySessionMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {destroySessionMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} className="text-primary" />}
                  Reset sandbox session
                </button>
              )}

              <button
                type="button"
                onClick={() => debugMutation.mutate()}
                disabled={!activeCluster || debugMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {debugMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <TerminalSquare size={16} className="text-primary" />}
                Run host diagnostics
              </button>

              <button
                type="button"
                onClick={() => openEditorMutation.mutate()}
                disabled={!ready || openEditorMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {openEditorMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Server size={16} className="text-primary" />}
                Open editor
              </button>

              {!confirmDestroy ? (
                <button
                  type="button"
                  onClick={() => setConfirmDestroy(true)}
                  disabled={destroyClusterMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/15"
                >
                  Destroy sandbox host
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-red-600 dark:text-red-300">Confirm host destruction?</span>
                  <button
                    type="button"
                    onClick={() => destroyClusterMutation.mutate()}
                    disabled={destroyClusterMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {destroyClusterMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
                    Yes, destroy
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDestroy(false)}
                    disabled={destroyClusterMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {ready ? (
              <p className="text-sm leading-6 text-muted-foreground">
                The bottom terminal on this page is ready. Use it for `azlocal`, `kubectl`, and verification commands.
              </p>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                Wait until the host and session are both ready before running exercise commands.
              </p>
            )}

            {editorUrl ? (
              <p className="text-sm leading-6 text-muted-foreground">
                Editor ready:{" "}
                <a
                  href={editorUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  open OpenVSCode Server
                </a>
              </p>
            ) : null}

            {openEditorMutation.error ? (
              <p className="text-sm text-red-600">
                {(openEditorMutation.error as any)?.detail || (openEditorMutation.error as any)?.error || "Editor startup failed."}
              </p>
            ) : null}

            {debugMutation.data ? (
              <div className="rounded-xl border border-border bg-background/70 px-4 py-4 dark:bg-card">
                <p className="text-sm font-medium text-foreground">Host diagnostics</p>
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-3 font-mono text-xs text-foreground dark:bg-[#1E1E1E] dark:text-[#E0E0E0]">
                  {(debugMutation.data.stdout + (debugMutation.data.stderr ? `\n${debugMutation.data.stderr}` : "")).trim()}
                </pre>
              </div>
            ) : null}

            {debugMutation.error ? (
              <p className="text-sm text-red-600">
                {(debugMutation.error as any)?.detail || (debugMutation.error as any)?.error || "Host diagnostics failed."}
              </p>
            ) : null}

            {destroyClusterMutation.error ? (
              <p className="text-sm text-red-600">
                {(destroyClusterMutation.error as any)?.detail || (destroyClusterMutation.error as any)?.error || "Host destroy failed."}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

export default function E2ESim() {
  const [location, setLocation] = useLocation();
  const [, params] = useRoute("/e2e/:exerciseId");
  const [selectedId, setSelectedId] = useState<number | null>(params?.exerciseId ? Number(params.exerciseId) : null);
  const [validationResults, setValidationResults] = useState<ValidationResult[] | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(true);

  const { data: exercises, isLoading } = useQuery<RealEnvExercise[]>({
    queryKey: ["/api/real-env/exercises"],
    queryFn: () => apiRequest("GET", "/api/real-env/exercises").then((r) => r.json()),
  });

  const { data: clusterServers } = useQuery<ClusterServerInfo[]>({
    queryKey: ["/api/cluster/servers"],
    queryFn: () => apiRequest("GET", "/api/cluster/servers").then((r) => r.json()),
    refetchInterval: 10000,
  });

  const { data: sessions } = useQuery<ClusterSession[]>({
    queryKey: ["/api/cluster/sessions"],
    queryFn: () => apiRequest("GET", "/api/cluster/sessions").then((r) => r.json()),
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (!exercises?.length) return;
    if (selectedId && exercises.some((exercise) => exercise.id === selectedId)) return;
    const firstEasy = exercises.find((exercise) => exercise.difficulty === "easy") ?? exercises[0];
    setSelectedId(firstEasy.id);
    setLocation(`/e2e/${firstEasy.id}`, { replace: true });
  }, [exercises, selectedId, setLocation]);

  const selectedExercise = useMemo(
    () => exercises?.find((exercise) => exercise.id === selectedId) ?? null,
    [exercises, selectedId],
  );
  const activeCluster = clusterServers?.find((server) => server.status !== "destroyed") ?? null;
  const activeSession = sessions?.find(
    (session) => activeCluster && session.clusterServerId === activeCluster.id && ["provisioning", "ready"].includes(session.status),
  ) ?? null;
  const remoteTerminalReady = activeCluster?.status === "ready";
  const remoteTerminalServerId = activeCluster?.status === "ready" ? activeCluster.id : null;

  const validateMutation = useMutation({
    mutationFn: (exerciseId: number) =>
      apiRequest("POST", `/api/real-env/exercises/${exerciseId}/validate`).then(async (response) => {
        if (!response.ok) throw await response.json();
        return response.json() as Promise<{ passed: boolean; results: ValidationResult[] }>;
      }),
    onSuccess: (data) => {
      setValidationResults(data.results);
      queryClient.invalidateQueries({ queryKey: ["/api/real-env/exercises"] });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: (exerciseId: number) =>
      apiRequest("POST", `/api/real-env/exercises/${exerciseId}/cleanup`).then(async (response) => {
        if (!response.ok) throw await response.json();
        return response.json();
      }),
    onSuccess: () => {
      setValidationResults(null);
    },
  });

  const lastResults = selectedExercise?.progress?.lastResult
    ? parseValidationResults(selectedExercise.progress.lastResult)
    : [];
  const resultsToShow = validationResults ?? lastResults;

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-8 pb-5">
          <h1 className="font-serif text-[28px] font-medium tracking-tight text-foreground md:text-[32px]">
            E2E Sim
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Start with one clear Azure/miniblue exercise in a sandboxed Hetzner environment, then validate and reset it without leaving the page.
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <Skeleton className="h-[420px] rounded-2xl" />
            <Skeleton className="h-[420px] rounded-2xl" />
          </div>
        ) : !exercises?.length ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
            No E2E exercises are available yet.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-stretch">
            <aside className="self-start">
              <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/80 px-3 py-3 lg:max-h-[calc(100vh-180px)]">
                <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  <Layers3 size={14} className="text-primary" />
                  Exercises
                </div>
                <div className="flex-1 space-y-2 overflow-auto pr-1">
                {exercises.map((exercise) => {
                  const track = TRACK_META[exercise.track];
                  const active = exercise.id === selectedExercise?.id;
                  return (
                    <button
                      key={exercise.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(exercise.id);
                        setValidationResults(null);
                        setLocation(`/e2e/${exercise.id}`);
                      }}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                        active
                          ? "border-primary/30 bg-primary/5"
                          : "border-border bg-background/70 hover:bg-accent/20 dark:bg-card"
                      }`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                          <span className={`inline-block h-2 w-2 rounded-[2px] ${track.dotClass}`} />
                          <span>{track.label}</span>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {exercise.timeMinutes} min · {exercise.difficulty}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {exercise.number}. {exercise.title}
                      </p>
                    </button>
                  );
                })}
                </div>
              </div>
            </aside>

            {selectedExercise ? (
              <div className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
                  <section className={activeCluster ? "rounded-2xl border border-border bg-card/80 px-5 py-5" : "flex flex-col overflow-hidden rounded-2xl border border-border bg-card/80 px-5 py-5 xl:max-h-[332px]"}>
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                          <span className={`inline-block h-2 w-2 rounded-[2px] ${TRACK_META[selectedExercise.track].dotClass}`} />
                          <span>{TRACK_META[selectedExercise.track].label}</span>
                          <span>{selectedExercise.domain}</span>
                        </div>
                        <h2 className="text-xl font-medium text-foreground">
                          {selectedExercise.title}
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {selectedExercise.timeMinutes} minutes · {selectedExercise.difficulty}
                        </p>

                        {resultsToShow.length > 0 ? (
                          <div className="mt-4 rounded-xl border border-border bg-background/70 px-4 py-4 dark:bg-card">
                            <div className="space-y-3">
                              {resultsToShow.map((result, index) => (
                                <div key={`${result.description}-${index}`} className="flex items-start gap-2 text-sm">
                                  <CheckCircle2 size={15} className={result.passed ? "mt-0.5 text-primary" : "mt-0.5 text-red-600"} />
                                  <div className="min-w-0">
                                    <p className="font-medium text-foreground">{result.description}</p>
                                    {result.output ? (
                                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-background px-2 py-2 font-mono text-xs text-muted-foreground dark:bg-[#1E1E1E]">
                                        {result.output}
                                      </pre>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 flex-wrap items-start justify-start gap-2 self-start md:justify-end">
                        <button
                          type="button"
                          onClick={() => setInstructionsOpen((value) => !value)}
                          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/30"
                        >
                          <ChevronDown
                            size={16}
                            className={`transition-transform ${instructionsOpen ? "rotate-180" : ""}`}
                          />
                          Instructions
                        </button>
                        <button
                          type="button"
                          onClick={() => validateMutation.mutate(selectedExercise.id)}
                          disabled={validateMutation.isPending}
                          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {validateMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} className="text-primary" />}
                          Validate
                        </button>
                        <button
                          type="button"
                          onClick={() => cleanupMutation.mutate(selectedExercise.id)}
                          disabled={cleanupMutation.isPending}
                          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {cleanupMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} className="text-primary" />}
                          Cleanup
                        </button>
                      </div>
                    </div>
                    {instructionsOpen ? (
                      <div className={activeCluster ? "mt-4 rounded-xl border border-border bg-background/70 px-4 py-4 dark:bg-card" : "mt-4 min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-background/70 px-4 py-4 dark:bg-card"}>
                        <div className="space-y-4">
                          {renderScenarioMarkdown(selectedExercise.scenario)}
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <EnvironmentPanel />
                </div>

                <section className="rounded-2xl border border-border bg-card/80 px-5 py-5">
                  <E2ERemoteTerminal
                    serverId={remoteTerminalServerId}
                    sessionId={activeSession?.status === "ready" ? activeSession.id : null}
                    ready={remoteTerminalReady}
                  />
                </section>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
