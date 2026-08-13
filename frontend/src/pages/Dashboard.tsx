import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import type { Deck } from "@/lib/api-types";

type DeckStats = {
  total: number;
  mastered: number;
  newAvailable: number;
  learnDue: number;
  reviewDue: number;
  seenCount: number;
};

type TerminalExercise = {
  id: number;
  track: string;
  progress: {
    completed: boolean;
  } | null;
};

type RealEnvExercise = {
  id: number;
  title: string;
  track: TrackId;
  domain: string;
  scenario: string;
  progress: {
    passed: boolean;
  } | null;
};

type TrackId = "kubernetes" | "docker" | "pulumi" | "azure" | "github-actions";

type TrackSummary = {
  id: TrackId;
  name: string;
  colorClass: string;
  flashcards: { mastered: number; total: number; due: number };
  labs: { completed: number; total: number };
  e2e: { passed: number; total: number };
};

const TRACK_META: Record<TrackId, { name: string; colorClass: string; dotClass: string }> = {
  kubernetes: {
    name: "Kubernetes",
    colorClass: "text-blue-500",
    dotClass: "bg-blue-500",
  },
  docker: {
    name: "Docker",
    colorClass: "text-emerald-500",
    dotClass: "bg-emerald-500",
  },
  pulumi: {
    name: "Pulumi",
    colorClass: "text-orange-500",
    dotClass: "bg-orange-500",
  },
  azure: {
    name: "Azure",
    colorClass: "text-violet-500",
    dotClass: "bg-violet-500",
  },
  "github-actions": {
    name: "GitHub Actions",
    colorClass: "text-amber-500",
    dotClass: "bg-amber-500",
  },
};

const TRACK_ORDER: TrackId[] = ["kubernetes", "docker", "pulumi", "azure", "github-actions"];

function barPct(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 100) : 0;
}

function trackPct(track: TrackSummary): number {
  const fc = track.flashcards.total > 0 ? track.flashcards.mastered / track.flashcards.total : 0;
  const lb = track.labs.total > 0 ? track.labs.completed / track.labs.total : 0;
  const e2 = track.e2e.total > 0 ? track.e2e.passed / track.e2e.total : 0;
  return Math.round(((fc + lb + e2) / 3) * 100);
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/70 px-4 py-4 dark:bg-card">
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-medium text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function ProgressPillar({
  label,
  detail,
  fill,
  fillClass,
}: {
  label: string;
  detail: string;
  fill: number;
  fillClass: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-[width] duration-500 ${fillClass}`} style={{ width: `${fill}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

function TrackRow({ track }: { track: TrackSummary }) {
  const meta = TRACK_META[track.id];
  const progressPct = trackPct(track);

  return (
    <div className="rounded-2xl border border-border bg-card/80 px-5 py-4">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-base font-medium text-foreground">
          <span className={`inline-block h-2.5 w-2.5 rounded-[3px] ${meta.dotClass}`} />
          {meta.name}
        </div>
        <span className={`text-sm font-medium ${meta.colorClass}`}>{progressPct}%</span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ProgressPillar
          label="Flashcards"
          fill={barPct(track.flashcards.mastered, track.flashcards.total)}
          detail={`${track.flashcards.mastered} / ${track.flashcards.total} mastered · ${track.flashcards.due} due`}
          fillClass={meta.dotClass}
        />
        <ProgressPillar
          label="Labs"
          fill={barPct(track.labs.completed, track.labs.total)}
          detail={`${track.labs.completed} / ${track.labs.total} completed`}
          fillClass={meta.dotClass}
        />
        <ProgressPillar
          label="Real env"
          fill={barPct(track.e2e.passed, track.e2e.total)}
          detail={
            track.e2e.passed === 0 && track.e2e.total > 0
              ? `0 / ${track.e2e.total} · not attempted`
              : `${track.e2e.passed} / ${track.e2e.total} passed`
          }
          fillClass={meta.dotClass}
        />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: decks, isLoading: decksLoading } = useQuery<Deck[]>({
    queryKey: ["/api/decks"],
  });

  const deckStatsQueries = useQueries({
    queries: (decks ?? []).map((deck) => ({
      queryKey: ["/api/decks", deck.id, "stats"],
      queryFn: () => apiRequest("GET", `/api/decks/${deck.id}/stats`).then((r) => r.json() as Promise<DeckStats>),
      staleTime: 0,
      refetchOnMount: "always" as const,
    })),
  });

  const { data: terminalExercises, isLoading: terminalLoading } = useQuery<TerminalExercise[]>({
    queryKey: ["/api/exercises"],
  });

  const { data: realEnvExercises, isLoading: realEnvLoading } = useQuery<RealEnvExercise[]>({
    queryKey: ["/api/real-env/exercises"],
    queryFn: () => apiRequest("GET", "/api/real-env/exercises").then((r) => r.json()),
  });

  const isLoading = decksLoading || terminalLoading || realEnvLoading || deckStatsQueries.some((query) => query.isLoading);

  const trackSummaries = useMemo<TrackSummary[]>(() => {
    const summaries = Object.fromEntries(
      TRACK_ORDER.map((track) => [
        track,
        {
          id: track,
          name: TRACK_META[track].name,
          colorClass: TRACK_META[track].colorClass,
          flashcards: { mastered: 0, total: 0, due: 0 },
          labs: { completed: 0, total: 0 },
          e2e: { passed: 0, total: 0 },
        },
      ]),
    ) as Record<TrackId, TrackSummary>;

    (decks ?? []).forEach((deck, index) => {
      const track = deck.track as TrackId;
      if (!TRACK_ORDER.includes(track)) return;
      const stats = deckStatsQueries[index]?.data;
      if (!stats) return;
      summaries[track].flashcards.total += stats.total;
      summaries[track].flashcards.mastered += stats.mastered;
      summaries[track].flashcards.due += stats.newAvailable + stats.learnDue + stats.reviewDue;
    });

    (terminalExercises ?? []).forEach((exercise) => {
      const track = exercise.track as TrackId;
      if (!TRACK_ORDER.includes(track)) return;
      summaries[track].labs.total += 1;
      if (exercise.progress?.completed) summaries[track].labs.completed += 1;
    });

    (realEnvExercises ?? []).forEach((exercise) => {
      const track = exercise.track;
      if (!TRACK_ORDER.includes(track)) return;
      summaries[track].e2e.total += 1;
      if (exercise.progress?.passed) summaries[track].e2e.passed += 1;
    });

    return TRACK_ORDER.map((track) => summaries[track]);
  }, [deckStatsQueries, decks, realEnvExercises, terminalExercises]);

  const totals = useMemo(() => {
    const totalCards = trackSummaries.reduce((sum, track) => sum + track.flashcards.total, 0);
    const masteredCards = trackSummaries.reduce((sum, track) => sum + track.flashcards.mastered, 0);
    const labsDone = trackSummaries.reduce((sum, track) => sum + track.labs.completed, 0);
    const labsTotal = trackSummaries.reduce((sum, track) => sum + track.labs.total, 0);

    return {
      masteredPct: totalCards > 0 ? Math.round((masteredCards / totalCards) * 100) : 0,
      masteredCards,
      totalCards,
      labsDone,
      labsTotal,
      labsPct: labsTotal > 0 ? Math.round((labsDone / labsTotal) * 100) : 0,
    };
  }, [trackSummaries]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-medium tracking-tight text-foreground md:text-[32px]" data-testid="text-dashboard-title">
          Your overview
        </h1>
      </div>

      {isLoading ? (
        <>
          <div className="mb-8 grid gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-28 rounded-xl" />
            ))}
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-44 rounded-2xl" />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mb-8 grid gap-3 md:grid-cols-2">
            <MetricCard
              label="Mastered"
              value={`${totals.masteredPct}%`}
              sub={`${totals.masteredCards} / ${totals.totalCards} cards`}
            />
            <MetricCard
              label="Labs done"
              value={`${totals.labsDone} / ${totals.labsTotal}`}
              sub={`${totals.labsPct}%`}
            />
          </div>

          <div className="mb-3">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Track progress
            </p>
          </div>

          <div className="mb-8 flex flex-col gap-3">
            {trackSummaries.map((track) => (
              <TrackRow key={track.id} track={track} />
            ))}
          </div>

        </>
      )}
    </div>
  );
}
