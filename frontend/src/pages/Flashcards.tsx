import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ChevronRight,
  RotateCcw,
  Code2,
  Plus,
  Settings,
  Upload,
  FolderPlus,
  X,
  Pencil,
  Save,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentReference } from "@/contexts/current-reference";
import type { cardProgress, Deck, Flashcard } from "@/lib/api-types";

type DeckStats = {
  total: number;
  mastered: number;
  due: number;
  newAvailable: number;
  learnDue: number;
  reviewDue: number;
  seenCount: number;
};
type FlashcardSettings = {
  id: number;
  newCardsPerDay: number;
  learningSteps: string;
  normalReviewInterval: number;
  easyReviewInterval: number;
  relearningSteps: string;
  minimumInterval: number;
};
type DeckActionPanel = "import" | "new-deck" | null;
type DueCard = Flashcard & { queue?: "new" | "learn" | "due" };
type CardProgressSnapshot = cardProgress | null;
type ReviewUndoState = {
  card: DueCard;
  previousProgress: CardProgressSnapshot;
  previousIndex: number;
};
type FlashcardSettingsHelpKey =
  | "learningSteps"
  | "normalReviewInterval"
  | "easyReviewInterval"
  | "relearningSteps"
  | "minimumInterval";
const DECK_TRACKS = ["kubernetes", "docker", "pulumi", "azure"] as const;
const DECK_TRACK_FILTERS = [
  { key: undefined, label: "All" },
  ...DECK_TRACKS.map((track) => ({ key: track, label: track[0].toUpperCase() + track.slice(1) })),
];

const FLASHCARD_SETTINGS_HELP: Record<FlashcardSettingsHelpKey, { title: string; body: string }> = {
  learningSteps: {
    title: "Learning steps",
    body: "These are the early review delays for a new card before it graduates into normal review. `10m 1d 3d` means review again in 10 minutes, then 1 day, then 3 days.",
  },
  normalReviewInterval: {
    title: "Normal review interval",
    body: "This sets how many days the card waits before the next review when it first enters normal review through the standard path. Higher means the card comes back later. Lower means it comes back sooner.",
  },
  easyReviewInterval: {
    title: "Easy review interval",
    body: "This is the interval, in days, used when a brand new or learning card is rated Easy and can skip ahead faster.",
  },
  relearningSteps: {
    title: "Relearning steps",
    body: "These steps are used after you miss a review card and it has to be learned again before returning to normal review.",
  },
  minimumInterval: {
    title: "Minimum interval",
    body: "This is the shortest allowed review interval in days, so scheduling never drops below this floor.",
  },
};

// ── Track badge ────────────────────────────────────────────────────────────
function TrackBadge({ track }: { track: string }) {
  const map: Record<string, string> = {
    kubernetes: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    docker: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    pulumi: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    azure: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${map[track] ?? "bg-muted text-muted-foreground border-border"}`}>
      {track}
    </span>
  );
}

// ── Inline markdown renderer ──────────────────────────────────────────────
function CardText({ text, className }: { text: string; className?: string }) {
  const html = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-muted/60 px-1.5 py-0.5 rounded text-[13px] font-mono text-primary">$1</code>')
    .replace(/\r?\n/g, "<br />");
  return <p className={cn("select-text", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ── Rating buttons ─────────────────────────────────────────────────────────
const RATINGS = [
  { label: "Blackout", value: 0, cls: "border-red-500/50 text-red-400 hover:bg-red-500/10" },
  { label: "Hard", value: 1, cls: "border-amber-500/50 text-amber-400 hover:bg-amber-500/10" },
  { label: "Good", value: 2, cls: "border-primary/50 text-primary hover:bg-primary/10" },
  { label: "Easy", value: 3, cls: "border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10" },
];

// ── Study Mode ─────────────────────────────────────────────────────────────
function StudyMode({ deckId, onExit }: { deckId: number; onExit: () => void }) {
  const [cardIndex, setCardIndex] = useState(0);
  const [sessionTotal, setSessionTotal] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pendingPostReviewTransition, setPendingPostReviewTransition] = useState(false);
  const [reviewUndo, setReviewUndo] = useState<ReviewUndoState | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editCode, setEditCode] = useState("");
  const { setReference, clearReference } = useCurrentReference();

  const { data: dueCards, isLoading, isFetching } = useQuery<DueCard[]>({
    queryKey: ["/api/decks", deckId, "due"],
    queryFn: () => apiRequest("GET", `/api/decks/${deckId}/due`).then((r) => r.json()),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const cards = dueCards ?? [];
  const total = cards.length;
  const safeCardIndex = total > 0 ? Math.min(cardIndex, total - 1) : 0;
  const progressTotal = sessionTotal ?? total;
  const card = cards[safeCardIndex];
  const normalizedQueue = card?.queue === "new" || card?.queue === "learn" || card?.queue === "due"
    ? card.queue
    : undefined;

  const { data: cardProgress } = useQuery<CardProgressSnapshot>({
    queryKey: ["/api/cards", card?.id, "progress"],
    queryFn: () => apiRequest("GET", `/api/cards/${card!.id}/progress`).then((r) => r.json()),
    enabled: !!card && !normalizedQueue,
  });

  const resolvedQueue: "new" | "learn" | "due" | undefined =
    normalizedQueue ??
    (cardProgress === undefined
      ? undefined
      : cardProgress === null
        ? "new"
        : cardProgress.state === "learn" || cardProgress.state === "relearn"
          ? "learn"
          : "due");

  const queueBorderClass =
    resolvedQueue === "new"
      ? "border-blue-500/50"
      : resolvedQueue === "learn"
        ? "border-red-500/50"
        : resolvedQueue === "due"
          ? "border-emerald-500/50"
          : "border-border";
  const queueHoverBorderClass =
    resolvedQueue === "new"
      ? "hover:border-blue-500/70"
      : resolvedQueue === "learn"
        ? "hover:border-red-500/70"
        : resolvedQueue === "due"
          ? "hover:border-emerald-500/70"
          : "hover:border-primary/30";

  useEffect(() => {
    if (sessionTotal === null && total > 0) {
      setSessionTotal(total);
    }
  }, [sessionTotal, total]);

  useEffect(() => {
    if (cardIndex !== safeCardIndex) {
      setCardIndex(safeCardIndex);
      setFlipped(false);
      setEditing(false);
    }
  }, [cardIndex, safeCardIndex]);

  useEffect(() => {
    if (!card) {
      clearReference();
      return;
    }

    const parts = [
      `Question: ${card.front}`,
      `Answer: ${card.back}`,
    ];

    if (card.codeExample) {
      parts.push(`Code example:\n${card.codeExample}`);
    }

    setReference({
      kind: "flashcard",
      sourceLabel: "Current flashcard",
      title: card.front,
      content: parts.join("\n\n"),
    });

    return () => clearReference();
  }, [card, clearReference, setReference]);

  // Fetch interval previews for the current card
  const { data: intervalPreviews } = useQuery<Record<string, string>>({
    queryKey: ["/api/cards", card?.id, "preview-intervals"],
    queryFn: () => apiRequest("GET", `/api/cards/${card!.id}/preview-intervals`).then((r) => r.json()),
    enabled: !!card,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ cardId, rating }: { cardId: number; rating: number }) =>
      apiRequest("POST", `/api/cards/${cardId}/review`, { rating }).then((r) =>
        r.json() as Promise<{ previousProgress: CardProgressSnapshot }>,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks", deckId, "due"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks", deckId, "stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
  });

  const undoReviewMutation = useMutation({
    mutationFn: ({ cardId, previousProgress }: { cardId: number; previousProgress: CardProgressSnapshot }) =>
      apiRequest("POST", `/api/cards/${cardId}/restore-progress`, { progress: previousProgress }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks", deckId, "due"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks", deckId, "stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not undo review",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const discardMutation = useMutation({
    mutationFn: async ({ cardId }: { cardId: number; wasNew: boolean; previousIndex: number }) => {
      const response = await apiRequest("DELETE", `/api/cards/${cardId}`);
      const result = await response.json() as { deleted?: boolean };
      if (!result.deleted) {
        throw new Error("The backend did not confirm that the card was discarded.");
      }
      return result;
    },
    onSuccess: async (_data, variables) => {
      setDiscardConfirmOpen(false);
      setPendingPostReviewTransition(false);
      setFlipped(false);
      setEditing(false);
      setReviewUndo(null);

      const queryKey = ["/api/decks", deckId, "due"];
      const freshCards = await apiRequest("GET", `/api/decks/${deckId}/due`).then((r) => r.json() as Promise<DueCard[]>);
      queryClient.setQueryData(queryKey, freshCards);
      queryClient.invalidateQueries({ queryKey: ["/api/decks", deckId, "stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });

      setCardIndex(Math.min(variables.previousIndex, Math.max(freshCards.length - 1, 0)));
      toast({
        title: "Card discarded",
        description: variables.wasNew && freshCards.length > variables.previousIndex
          ? "A new card was loaded in its place."
          : "The card was removed from this deck.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not discard card",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ cardId, front, back, codeExample }: { cardId: number; front: string; back: string; codeExample: string | null }) =>
      apiRequest("PATCH", `/api/cards/${cardId}`, { front, back, codeExample }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks", deckId, "due"] });
      setEditing(false);
    },
  });

  const startEditing = () => {
    if (!card) return;
    setEditFront(card.front);
    setEditBack(card.back);
    setEditCode(card.codeExample ?? "");
    setEditing(true);
  };

  const saveEdit = () => {
    if (!card) return;
    updateMutation.mutate({
      cardId: card.id,
      front: editFront,
      back: editBack,
      codeExample: editCode.trim() || null,
    });
  };

  const handleRating = async (rating: number) => {
    if (!card) return;
    setEditing(false);
    setPendingPostReviewTransition(true);

    try {
      const result = await reviewMutation.mutateAsync({ cardId: card.id, rating });
      setReviewUndo({
        card,
        previousProgress: result.previousProgress,
        previousIndex: safeCardIndex,
      });
      setCardIndex(safeCardIndex + 1);
    } catch {
      setPendingPostReviewTransition(false);
    }
  };

  const discardCurrentCard = () => {
    if (!card) return;
    discardMutation.mutate({
      cardId: card.id,
      wasNew: resolvedQueue === "new",
      previousIndex: safeCardIndex,
    });
  };

  const undoLastReview = useCallback(async () => {
    if (!reviewUndo || editing || reviewMutation.isPending || undoReviewMutation.isPending) return;

    await undoReviewMutation.mutateAsync({
      cardId: reviewUndo.card.id,
      previousProgress: reviewUndo.previousProgress,
    });
    queryClient.setQueryData<DueCard[]>(["/api/decks", deckId, "due"], (current = []) => {
      if (current.some((candidate) => candidate.id === reviewUndo.card.id)) return current;
      const next = [...current];
      next.splice(Math.min(reviewUndo.previousIndex, next.length), 0, reviewUndo.card);
      return next;
    });
    setPendingPostReviewTransition(false);
    setFlipped(false);
    setEditing(false);
    setCardIndex(reviewUndo.previousIndex);
    setReviewUndo(null);
  }, [editing, reviewMutation.isPending, reviewUndo, undoReviewMutation]);

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;

      const target = event.target as HTMLElement | null;
      const isTextInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isTextInput) return;

      event.preventDefault();
      void undoLastReview();
    };

    window.addEventListener("keydown", handleUndoShortcut);
    return () => window.removeEventListener("keydown", handleUndoShortcut);
  }, [undoLastReview]);

  useEffect(() => {
    if (!pendingPostReviewTransition) return;
    if (reviewMutation.isPending || isFetching) return;

    if (total === 0) {
      setFlipped(false);
      setPendingPostReviewTransition(false);
      onExit();
      return;
    }

    setFlipped(false);
    setPendingPostReviewTransition(false);
  }, [isFetching, onExit, pendingPostReviewTransition, reviewMutation.isPending, total]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Skeleton className="w-full max-w-lg h-60 rounded-xl" />
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h2 className="text-lg font-semibold text-foreground mb-1">All caught up!</h2>
        <p className="text-sm text-muted-foreground mb-6">
          No cards due right now. Come back later.
        </p>
        <Button variant="outline" size="sm" onClick={onExit} data-testid="button-exit-study">
          <ArrowLeft size={14} className="mr-1.5" /> Back to decks
        </Button>
      </div>
    );
  }

  const pct = progressTotal > 0
    ? Math.round(((safeCardIndex + 1) / progressTotal) * 100)
    : 0;
  const showTransitionMask = pendingPostReviewTransition || reviewMutation.isPending;
  const handleCardClick = () => {
    if (pendingPostReviewTransition) return;
    const selectedText = window.getSelection()?.toString().trim();
    if (selectedText) return;
    setFlipped((f) => !f);
  };

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onExit} data-testid="button-back-decks">
            <ArrowLeft size={14} className="mr-1.5" /> Decks
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => void undoLastReview()}
            disabled={!reviewUndo || reviewMutation.isPending || undoReviewMutation.isPending}
            title="Undo last review (Cmd+Z)"
            aria-label="Undo last review"
            data-testid="button-undo-review"
          >
            <RotateCcw size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => setDiscardConfirmOpen(true)}
            disabled={!card || discardMutation.isPending}
            title="Discard current card"
            aria-label="Discard current card"
            data-testid="button-discard-card"
          >
            <Trash2 size={14} />
          </Button>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span data-testid="text-card-progress">{safeCardIndex + 1} / {progressTotal}</span>
          <Progress value={pct} className="w-24 h-1.5" />
        </div>
      </div>

      {discardConfirmOpen && card && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
          onClick={() => setDiscardConfirmOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">Discard this card?</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              This permanently removes the current card from the deck.
              {resolvedQueue === "new" ? " If another new card is available, it will replace this one." : ""}
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setDiscardConfirmOpen(false)}
                disabled={discardMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="flex-1"
                onClick={discardCurrentCard}
                disabled={discardMutation.isPending}
                data-testid="button-confirm-discard-card"
              >
                {discardMutation.isPending ? "Discarding..." : "Discard"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Flashcard */}
      <div
        data-testid="card-flashcard"
        onClick={editing ? undefined : handleCardClick}
        className={cn(
          "relative rounded-xl border bg-card min-h-[280px] p-8 flex flex-col transition-colors",
          queueBorderClass,
          editing ? "" : cn("cursor-pointer", queueHoverBorderClass)
        )}
      >
        {showTransitionMask && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-card/95 backdrop-blur-[1px]">
            <div className="space-y-3 text-center">
              <Skeleton className="mx-auto h-4 w-24 rounded-full" />
              <Skeleton className="mx-auto h-4 w-40 rounded-full" />
              <p className="text-xs text-muted-foreground">Loading next card...</p>
            </div>
          </div>
        )}
        {!editing && (
          <button
            onClick={(e) => { e.stopPropagation(); startEditing(); }}
            className="absolute top-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/45 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-foreground"
            title="Edit card"
          >
            <Pencil size={12} />
          </button>
        )}

        {editing ? (
          <div className="space-y-3 flex-1">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Front (question)</label>
              <Textarea
                value={editFront}
                onChange={(e) => setEditFront(e.target.value)}
                rows={3}
                className="text-sm resize-none"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Back (answer)</label>
              <Textarea
                value={editBack}
                onChange={(e) => setEditBack(e.target.value)}
                rows={4}
                className="text-sm resize-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Code example (optional)</label>
              <Textarea
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
                rows={3}
                className="text-xs resize-none font-mono"
                placeholder="kubectl get pods..."
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="text-xs"
                disabled={!editFront.trim() || !editBack.trim() || updateMutation.isPending}
                onClick={(e) => { e.stopPropagation(); saveEdit(); }}
              >
                <Save size={12} className="mr-1.5" />
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={(e) => { e.stopPropagation(); setEditing(false); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : !flipped ? (
          <div className="flex-1 flex items-center justify-center">
            <CardText
              text={card.front}
              className="w-full text-center text-base font-medium text-foreground leading-relaxed"
            />
          </div>
        ) : (
          <div className="flex-1">
            <div className="space-y-3">
              <CardText text={card.back} className="text-base text-foreground leading-relaxed" />
              {card.codeExample && (
                <pre className="select-text bg-muted/60 rounded-md p-3 text-xs font-mono text-foreground overflow-x-auto mt-3 leading-relaxed">
                  <code>{card.codeExample}</code>
                </pre>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Rating buttons — only shown after flip */}
      <div
        className={cn(
          "grid grid-cols-4 gap-2 mt-4 transition-opacity duration-200",
          flipped && !showTransitionMask ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {RATINGS.map(({ label, value, cls }) => {
          const interval = intervalPreviews?.[String(value)];
          return (
            <Button
              key={value}
              variant="outline"
              size="sm"
              data-testid={`button-rate-${label.toLowerCase()}`}
              disabled={reviewMutation.isPending}
              onClick={() => handleRating(value)}
              className={cn("text-xs font-medium border flex flex-col items-center gap-0.5 h-auto py-2", cls)}
            >
              <span>{label}</span>
              {interval && (
                <span className="text-[10px] opacity-60 font-normal">{interval}</span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

// ── Deck list ──────────────────────────────────────────────────────────────
function DeckList({
  onSelect,
  onAddCard,
  onConfigureDeck,
  onImportDeck,
  onCreateDeck,
  activeId,
}: {
  onSelect: (id: number) => void;
  onAddCard: (deckId: number) => void;
  onConfigureDeck: (deck: Deck) => void;
  onImportDeck: () => void;
  onCreateDeck: () => void;
  activeId?: number;
}) {
  const [track, setTrack] = useState<string | undefined>(undefined);

  const { data: decks, isLoading, error } = useQuery<Deck[]>({
    queryKey: ["/api/decks", track],
    queryFn: () =>
      apiRequest("GET", track ? `/api/decks?track=${track}` : "/api/decks").then((r) => r.json()),
  });

  const deckLoadError =
    error instanceof Error ? error.message : "Could not load decks.";
  const databaseUnavailable =
    deckLoadError.includes("503") || deckLoadError.toLowerCase().includes("database connection unavailable");

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 flex-wrap">
        {DECK_TRACK_FILTERS.map(({ key, label }) => (
          <button
            key={label}
            data-testid={`button-track-${label.toLowerCase()}`}
            onClick={() => setTrack(key)}
            className={cn(
              "px-3 py-1 text-xs rounded-md font-medium transition-colors",
              track === key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Deck table */}
      <div className="rounded-xl border border-border">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_76px_60px_60px_60px] gap-0 px-4 py-2 bg-muted/40 border-b border-border">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">DECKS</span>
            <button
              type="button"
              onClick={onImportDeck}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/70 text-foreground transition-colors hover:bg-accent"
              aria-label="Import deck"
              title="Import deck"
            >
              <Upload size={13} />
            </button>
            <button
              type="button"
              onClick={onCreateDeck}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/70 text-foreground transition-colors hover:bg-accent"
              aria-label="New deck"
              title="New deck"
            >
              <FolderPlus size={13} />
            </button>
          </span>
          <span className="text-xs font-medium text-muted-foreground/40 uppercase tracking-wider text-center"> </span>
          <span className="text-xs font-medium text-blue-400 uppercase tracking-wider text-center">New</span>
          <span className="text-xs font-medium text-red-400 uppercase tracking-wider text-center">Learn</span>
          <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider text-center">Due</span>
        </div>

        {isLoading
          ? Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-12 mx-4 my-2 rounded-md" />)
          : error
            ? (
              <div className="mx-4 my-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm">
                <p className="font-medium text-destructive">
                  {databaseUnavailable
                    ? "No database connection is present, so no decks can be shown."
                    : "Decks could not be loaded."}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {databaseUnavailable
                    ? "Start Postgres or configure a local database, then reload the Flashcards page."
                    : deckLoadError}
                </p>
              </div>
            )
            : decks?.map((deck) => (
              <DeckRow
                key={deck.id}
                deck={deck}
                onSelect={onSelect}
                onAddCard={onAddCard}
                onConfigureDeck={onConfigureDeck}
                active={activeId === deck.id}
              />
            ))}
      </div>
    </div>
  );
}

function DeckRow({
  deck,
  onSelect,
  onAddCard,
  onConfigureDeck,
  active,
}: {
  deck: Deck;
  onSelect: (id: number) => void;
  onAddCard: (id: number) => void;
  onConfigureDeck: (deck: Deck) => void;
  active: boolean;
}) {
  const { data: stats } = useQuery<DeckStats>({
    queryKey: ["/api/decks", deck.id, "stats"],
    queryFn: () => apiRequest("GET", `/api/decks/${deck.id}/stats`).then((r) => r.json()),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const newCount = stats?.newAvailable ?? 0;
  const learnCount = stats?.learnDue ?? 0;
  const dueCount = stats?.reviewDue ?? 0;
  const seenCount = stats?.seenCount ?? 0;
  const hasActionableCards = newCount > 0 || learnCount > 0 || dueCount > 0;
  const [trackPickerOpen, setTrackPickerOpen] = useState(false);
  const trackPickerRef = useRef<HTMLSpanElement>(null);
  const updateTrackMutation = useMutation({
    mutationFn: async (track: string) => {
      const response = await apiRequest("PATCH", `/api/decks/${deck.id}/track`, { track });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error("Deck tag update route is not available yet. Restart npm run dev.");
      }
      return response.json() as Promise<Deck>;
    },
    onSuccess: (updatedDeck) => {
      setTrackPickerOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Deck tag updated",
        description: `${updatedDeck.title} moved to ${updatedDeck.track}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update deck tag",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!trackPickerOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!trackPickerRef.current?.contains(event.target as Node)) {
        setTrackPickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTrackPickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [trackPickerOpen]);

  return (
    <div
      data-testid={`card-deck-${deck.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(deck.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(deck.id);
        }
      }}
      className={cn(
        "grid grid-cols-[1fr_76px_60px_60px_60px] gap-0 items-center w-full px-4 py-3 text-left border-b border-border last:border-b-0 transition-colors bg-white dark:bg-card",
        active
          ? "bg-primary/5 dark:bg-primary/10"
          : hasActionableCards
            ? "hover:bg-accent/40 dark:hover:bg-accent/50"
            : "hover:bg-muted/20 dark:hover:bg-muted/30"
      )}
    >
      <div className="min-w-0 flex items-center gap-2.5">
        <span ref={trackPickerRef} className="relative shrink-0">
          <button
            type="button"
            className="rounded-full transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary/40"
            onClick={(e) => {
              e.stopPropagation();
              setTrackPickerOpen((open) => !open);
            }}
            aria-label={`Change ${deck.title} deck tag`}
            aria-expanded={trackPickerOpen}
            title="Change deck tag"
          >
            <TrackBadge track={deck.track} />
          </button>
          {trackPickerOpen && (
            <div
              className="absolute left-0 top-full z-20 mt-2 max-h-32 w-36 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              {DECK_TRACKS.map((track) => (
                <button
                  key={track}
                  type="button"
                  disabled={updateTrackMutation.isPending}
                  onClick={() => {
                    if (deck.track === track) {
                      setTrackPickerOpen(false);
                      return;
                    }
                    updateTrackMutation.mutate(track);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs capitalize transition-colors hover:bg-accent",
                    deck.track === track ? "text-primary" : "text-foreground",
                  )}
                >
                  <TrackBadge track={track} />
                </button>
              ))}
            </div>
          )}
        </span>
        <span className={cn("text-sm font-medium truncate", hasActionableCards ? "text-foreground" : "text-muted-foreground/55")}>
          {deck.title}
        </span>
        <span className="text-xs text-muted-foreground/50 shrink-0">{seenCount}/{deck.cardCount}</span>
      </div>
      <span className="flex justify-center gap-1">
        <button
          type="button"
          data-testid={`button-add-card-deck-${deck.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onAddCard(deck.id);
          }}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
            hasActionableCards
              ? "border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
              : "border-border/60 bg-muted/40 text-muted-foreground/70 hover:border-primary/30 hover:bg-primary/10 hover:text-primary",
          )}
          title={`Add card to ${deck.title}`}
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          data-testid={`button-configure-deck-${deck.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onConfigureDeck(deck);
          }}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
            hasActionableCards
              ? "border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
              : "border-border/60 bg-muted/40 text-muted-foreground/70 hover:border-primary/30 hover:bg-primary/10 hover:text-primary",
          )}
          title={`Deck settings for ${deck.title}`}
          aria-label={`Deck settings for ${deck.title}`}
        >
          <Settings size={13} />
        </button>
      </span>
      <span className={cn("text-sm font-semibold tabular-nums text-center", newCount > 0 ? "text-blue-400" : "text-muted-foreground/30")}>
        {newCount}
      </span>
      <span className={cn("text-sm font-semibold tabular-nums text-center", learnCount > 0 ? "text-red-400" : "text-muted-foreground/30")}>
        {learnCount}
      </span>
      <span className={cn("text-sm font-semibold tabular-nums text-center", dueCount > 0 ? "text-emerald-400" : "text-muted-foreground/30")}>
        {dueCount}
      </span>
    </div>
  );
}

function FlashcardSettingsPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [openHelp, setOpenHelp] = useState<FlashcardSettingsHelpKey | null>(null);
  const [form, setForm] = useState({
    newCardsPerDay: "20",
    learningSteps: "10m 1d 3d",
    normalReviewInterval: "7",
    easyReviewInterval: "9",
    relearningSteps: "10m",
    minimumInterval: "1",
  });
  const {
    data: settings,
    isLoading,
    error: settingsError,
  } = useQuery<FlashcardSettings>({
    queryKey: ["/api/flashcard-settings"],
    queryFn: () => apiRequest("GET", "/api/flashcard-settings").then((r) => r.json()),
  });

  useEffect(() => {
    if (settings) {
      setForm({
        newCardsPerDay: String(settings.newCardsPerDay),
        learningSteps: settings.learningSteps,
        normalReviewInterval: String(settings.normalReviewInterval),
        easyReviewInterval: String(settings.easyReviewInterval),
        relearningSteps: settings.relearningSteps,
        minimumInterval: String(settings.minimumInterval),
      });
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", "/api/flashcard-settings", {
        newCardsPerDay: Number(form.newCardsPerDay),
        learningSteps: form.learningSteps,
        normalReviewInterval: Number(form.normalReviewInterval),
        easyReviewInterval: Number(form.easyReviewInterval),
        relearningSteps: form.relearningSteps,
        minimumInterval: Number(form.minimumInterval),
      }).then((r) => r.json() as Promise<FlashcardSettings>),
    onSuccess: (updatedSettings) => {
      setForm({
        newCardsPerDay: String(updatedSettings.newCardsPerDay),
        learningSteps: updatedSettings.learningSteps,
        normalReviewInterval: String(updatedSettings.normalReviewInterval),
        easyReviewInterval: String(updatedSettings.easyReviewInterval),
        relearningSteps: updatedSettings.relearningSteps,
        minimumInterval: String(updatedSettings.minimumInterval),
      });
      queryClient.setQueryData(["/api/flashcard-settings"], updatedSettings);
      queryClient.invalidateQueries({ queryKey: ["/api/flashcard-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Flashcard settings saved",
        description: `New cards per day set to ${updatedSettings.newCardsPerDay}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not save flashcard settings",
        description: error.message.includes("404")
          ? "The backend is probably still running the old code. Restart npm run dev once."
          : error.message,
        variant: "destructive",
      });
    },
  });

  const parsedNewCards = Number(form.newCardsPerDay);
  const parsedNormalReview = Number(form.normalReviewInterval);
  const parsedEasyReview = Number(form.easyReviewInterval);
  const parsedMinimum = Number(form.minimumInterval);
  const isValidValue =
    Number.isInteger(parsedNewCards) &&
    parsedNewCards >= 0 &&
    parsedNewCards <= 999 &&
    Number.isInteger(parsedNormalReview) &&
    parsedNormalReview >= 1 &&
    Number.isInteger(parsedEasyReview) &&
    parsedEasyReview >= 1 &&
    Number.isInteger(parsedMinimum) &&
    parsedMinimum >= 1 &&
    form.learningSteps.trim().length > 0 &&
    form.relearningSteps.trim().length > 0;

  const renderHelpLabel = (label: string, helpKey?: FlashcardSettingsHelpKey) => (
    <span className="relative inline-flex items-center gap-1.5">
      <span>{label}</span>
      {helpKey ? (
        <>
          <button
            type="button"
            onClick={() => setOpenHelp((current) => current === helpKey ? null : helpKey)}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-muted/60 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            aria-label={`Explain ${label}`}
            title={`Explain ${label}`}
          >
            ?
          </button>
          <div
            className={cn(
              "pointer-events-none absolute left-0 top-[calc(100%+8px)] z-20 w-64 rounded-lg border border-border bg-popover p-3 text-left shadow-lg transition-all duration-150",
              openHelp === helpKey ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
            )}
          >
            <p className="text-xs font-semibold text-foreground">{FLASHCARD_SETTINGS_HELP[helpKey].title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{FLASHCARD_SETTINGS_HELP[helpKey].body}</p>
          </div>
        </>
      ) : null}
    </span>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Settings size={14} className="text-primary" /> Study Settings
        </h3>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              New cards per day
            </label>
            <Input
              type="number"
              min={0}
              max={999}
              step={1}
              value={form.newCardsPerDay}
              onChange={(e) => setForm((current) => ({ ...current, newCardsPerDay: e.target.value }))}
              className="text-xs"
              data-testid="input-new-cards-per-day"
              disabled={isLoading || updateMutation.isPending}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Limits how many untouched cards are introduced per deck each day.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {renderHelpLabel("Learning steps", "learningSteps")}
            </label>
            <Input
              value={form.learningSteps}
              onChange={(e) => setForm((current) => ({ ...current, learningSteps: e.target.value }))}
              className="text-xs font-mono"
              data-testid="input-learning-steps"
              disabled={isLoading || updateMutation.isPending}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {renderHelpLabel("Normal review interval", "normalReviewInterval")}
            </label>
            <Input
              type="number"
              min={1}
              step={1}
              value={form.normalReviewInterval}
              onChange={(e) => setForm((current) => ({ ...current, normalReviewInterval: e.target.value }))}
              className="text-xs"
              data-testid="input-normal-review-interval"
              disabled={isLoading || updateMutation.isPending}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {renderHelpLabel("Easy review interval", "easyReviewInterval")}
            </label>
            <Input
              type="number"
              min={1}
              step={1}
              value={form.easyReviewInterval}
              onChange={(e) => setForm((current) => ({ ...current, easyReviewInterval: e.target.value }))}
              className="text-xs"
              data-testid="input-easy-review-interval"
              disabled={isLoading || updateMutation.isPending}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {renderHelpLabel("Relearning steps", "relearningSteps")}
            </label>
            <Input
              value={form.relearningSteps}
              onChange={(e) => setForm((current) => ({ ...current, relearningSteps: e.target.value }))}
              className="text-xs font-mono"
              data-testid="input-relearning-steps"
              disabled={isLoading || updateMutation.isPending}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {renderHelpLabel("Minimum interval", "minimumInterval")}
            </label>
            <Input
              type="number"
              min={1}
              step={1}
              value={form.minimumInterval}
              onChange={(e) => setForm((current) => ({ ...current, minimumInterval: e.target.value }))}
              className="text-xs"
              data-testid="input-minimum-interval"
              disabled={isLoading || updateMutation.isPending}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Use Anki-style step notation such as <code>10m 1d 3d</code>.
        </p>

        <Button
          size="sm"
          className="w-full"
          onClick={() => updateMutation.mutate()}
          disabled={!isValidValue || updateMutation.isPending || isLoading}
          data-testid="button-save-flashcard-settings"
        >
          {updateMutation.isPending ? "Saving..." : "Save Settings"}
        </Button>

        {settingsError && (
          <p className="text-xs text-red-400">
            Settings could not be loaded. Restart `npm run dev` if this feature was just added.
          </p>
        )}

      </div>
    </div>
  );
}

// ── Create Card Dialog ─────────────────────────────────────────────────
function CreateCardPanel({
  onClose,
  embedded = false,
  initialDeckId,
}: {
  onClose?: () => void;
  embedded?: boolean;
  initialDeckId?: number;
}) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [code, setCode] = useState("");
  const [diff, setDiff] = useState<string>("medium");
  const [deckId, setDeckId] = useState<number | undefined>(initialDeckId);

  const { data: decks } = useQuery<Deck[]>({
    queryKey: ["/api/decks"],
    queryFn: () => apiRequest("GET", "/api/decks").then((r) => r.json()),
  });

  useEffect(() => {
    setDeckId(initialDeckId);
  }, [initialDeckId]);

  const selectedDeck = decks?.find((d) => d.id === deckId);
  const lockedToDeck = initialDeckId !== undefined;

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/decks/${deckId}/cards`, {
        front, back, codeExample: code || null, difficulty: diff, tags: "[]",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      if (deckId) {
        queryClient.invalidateQueries({ queryKey: ["/api/decks", deckId, "stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/decks", deckId, "due"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setFront(""); setBack(""); setCode("");
      setDiff("medium");
      if (!lockedToDeck) {
        setDeckId(undefined);
      }
      onClose?.();
    },
  });

  const canSubmit = front.trim() && back.trim() && deckId;

  return (
    <div className={cn(!embedded && "rounded-xl border border-border bg-card p-6")}>
      {!embedded && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Plus size={14} className="text-primary" /> Create Card
          </h3>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {/* Deck select */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Deck</label>
          {lockedToDeck && selectedDeck ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
              <TrackBadge track={selectedDeck.track} />
              <span>{selectedDeck.title}</span>
            </div>
          ) : (
            <select
              data-testid="select-create-deck"
              value={deckId ?? ""}
              onChange={(e) => setDeckId(Number(e.target.value) || undefined)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
            >
              <option value="">Select a deck...</option>
              {decks?.map((d) => <option key={d.id} value={d.id}>{d.title} ({d.track})</option>)}
            </select>
          )}
        </div>

        {/* Front */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Front (question)</label>
          <Textarea
            data-testid="input-create-front"
            value={front}
            onChange={(e) => setFront(e.target.value)}
            placeholder="What is...?"
            rows={2}
            className="text-xs resize-none"
          />
        </div>

        {/* Back */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Back (answer)</label>
          <Textarea
            data-testid="input-create-back"
            value={back}
            onChange={(e) => setBack(e.target.value)}
            placeholder="The answer is..."
            rows={3}
            className="text-xs resize-none"
          />
        </div>

        {/* Code example */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Code example (optional)</label>
          <Textarea
            data-testid="input-create-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="kubectl get pods..."
            rows={2}
            className="text-xs resize-none font-mono"
          />
        </div>

        {/* Difficulty */}
        <div className="flex gap-1">
          {["easy", "medium", "hard"].map((d) => (
            <button
              key={d}
              onClick={() => setDiff(d)}
              className={cn(
                "px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize",
                diff === d
                  ? d === "easy" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                  : d === "hard" ? "bg-red-500/10 text-red-400 border border-red-500/30"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {d}
            </button>
          ))}
        </div>

        <Button
          data-testid="button-create-card"
          size="sm"
          disabled={!canSubmit || createMutation.isPending}
          onClick={() => createMutation.mutate()}
          className="w-full"
        >
          {createMutation.isPending ? "Adding..." : createMutation.isSuccess ? "✓ Added" : "Add Card"}
        </Button>
      </div>
    </div>
  );
}

// ── Anki Import Panel ──────────────────────────────────────────────────
function AnkiImportPanel({ onClose, embedded = false }: { onClose?: () => void; embedded?: boolean }) {
  const [deckId, setDeckId] = useState<number | undefined>();
  const [newDeckName, setNewDeckName] = useState("");
  const [newDeckTrack, setNewDeckTrack] = useState("kubernetes");
  const [createNew, setCreateNew] = useState(false);
  const [content, setContent] = useState("");
  const [separator, setSeparator] = useState("\t");
  const [result, setResult] = useState<{ imported: number; errors: number; errorDetails: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: decks } = useQuery<Deck[]>({
    queryKey: ["/api/decks"],
    queryFn: () => apiRequest("GET", "/api/decks").then((r) => r.json()),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      let targetDeckId = deckId;
      if (createNew && newDeckName.trim()) {
        const res = await apiRequest("POST", "/api/decks", {
          title: newDeckName.trim(),
          description: "",
          track: newDeckTrack,
        });
        const newDeck = await res.json();
        targetDeckId = newDeck.id;
      }
      const res = await apiRequest("POST", "/api/import/anki", {
        deckId: targetDeckId,
        content,
        separator,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      onClose?.();
    },
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setContent((ev.target?.result as string) || "");
    };
    reader.readAsText(file);
  };

  const lineCount = content.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;

  return (
    <div className={cn(!embedded && "rounded-xl border border-border bg-card p-6")}>
      {!embedded && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Upload size={14} className="text-primary" /> Import from Anki
          </h3>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {/* Instructions */}
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 space-y-1">
          <p>Export your Anki deck as a text file:</p>
          <p className="font-mono text-[11px]">Anki → File → Export → "Notes in Plain Text (.txt)"</p>
          <p>Format: one card per line, front and back separated by a tab (or semicolon).</p>
        </div>

        {/* Deck select */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Target Deck</label>
          <div className="flex gap-1 mb-2">
            <button
              onClick={() => { setCreateNew(false); }}
              className={cn(
                "px-3 py-1 text-xs rounded-md font-medium transition-colors",
                !createNew ? "bg-primary/10 text-primary border border-primary/30" : "bg-muted text-muted-foreground"
              )}
            >
              Existing deck
            </button>
            <button
              onClick={() => { setCreateNew(true); setDeckId(undefined); }}
              className={cn(
                "px-3 py-1 text-xs rounded-md font-medium transition-colors",
                createNew ? "bg-primary/10 text-primary border border-primary/30" : "bg-muted text-muted-foreground"
              )}
            >
              Create new deck
            </button>
          </div>
          {createNew ? (
            <div className="space-y-2">
              <Input
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                placeholder="Deck name (e.g. CKA Exam Prep)"
                className="text-xs"
              />
              <div className="flex gap-1">
                {DECK_TRACKS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setNewDeckTrack(t)}
                    className={cn(
                      "px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize",
                      newDeckTrack === t
                        ? "bg-primary/10 text-primary border border-primary/30"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ) : (
          <select
            data-testid="select-import-deck"
            value={deckId ?? ""}
            onChange={(e) => setDeckId(Number(e.target.value) || undefined)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
          >
            <option value="">Select a deck...</option>
            {decks?.map((d) => <option key={d.id} value={d.id}>{d.title} ({d.track})</option>)}
          </select>
          )}
        </div>

        {/* Separator */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Separator</label>
          <div className="flex gap-1">
            {[{ label: "Tab", val: "\t" }, { label: "Semicolon", val: ";" }, { label: "Pipe", val: "|" }].map(({ label, val }) => (
              <button
                key={val}
                onClick={() => setSeparator(val)}
                className={cn(
                  "px-3 py-1 text-xs rounded-md font-medium transition-colors",
                  separator === val
                    ? "bg-primary/10 text-primary border border-primary/30"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* File upload */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.tsv"
            onChange={handleFile}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            className="text-xs w-full"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={12} className="mr-1.5" /> Upload .txt file
          </Button>
        </div>

        {/* Or paste */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Or paste content directly</label>
          <Textarea
            data-testid="input-import-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`front\tback\nWhat is a Pod?\tSmallest deployable unit in K8s`}
            rows={5}
            className="text-xs resize-none font-mono"
          />
          {content && (
            <p className="text-xs text-muted-foreground mt-1">{lineCount} card{lineCount !== 1 ? "s" : ""} detected</p>
          )}
        </div>

        {/* Import button */}
        <Button
          data-testid="button-import"
          size="sm"
          disabled={(!createNew && !deckId) || (createNew && !newDeckName.trim()) || !content.trim() || importMutation.isPending}
          onClick={() => { setResult(null); importMutation.mutate(); }}
          className="w-full"
        >
          {importMutation.isPending ? "Importing..." : `Import ${lineCount} Cards`}
        </Button>

        {/* Result */}
        {result && (
          <div className={cn(
            "rounded-lg p-3 text-xs",
            result.errors > 0 ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"
          )}>
            <p className="font-medium">✓ {result.imported} cards imported{result.errors > 0 ? `, ${result.errors} errors` : ""}</p>
            {result.errorDetails?.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {result.errorDetails.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Create Deck Panel ─────────────────────────────────────────────────
function CreateDeckPanel({ onClose, embedded = false }: { onClose?: () => void; embedded?: boolean }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [track, setTrack] = useState("kubernetes");

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/decks", { title, description, track }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setTitle(""); setDescription("");
      onClose?.();
    },
  });

  return (
    <div className={cn(!embedded && "rounded-xl border border-border bg-card p-6")}>
      {!embedded && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <FolderPlus size={14} className="text-primary" /> New Deck
          </h3>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Title</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. K8s Security Deep Dive"
            className="text-xs"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Description (optional)</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this deck covers..."
            rows={2}
            className="text-xs resize-none"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Track</label>
          <div className="flex gap-1">
            {DECK_TRACKS.map((t) => (
              <button
                key={t}
                onClick={() => setTrack(t)}
                className={cn(
                  "px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize",
                  track === t
                    ? "bg-primary/10 text-primary border border-primary/30"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <Button
          size="sm"
          disabled={!title.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate()}
          className="w-full"
        >
          {createMutation.isPending ? "Creating..." : "Create Deck"}
        </Button>
      </div>
    </div>
  );
}

function DeckSettingsPanel({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const [title, setTitle] = useState(deck.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setTitle(deck.title);
    setConfirmDelete(false);
  }, [deck.id, deck.title]);

  const renameMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("PATCH", `/api/decks/${deck.id}`, { title: title.trim() });
      return response.json() as Promise<Deck>;
    },
    onSuccess: (updatedDeck) => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Deck renamed",
        description: `Deck name updated to ${updatedDeck.title}.`,
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Could not rename deck",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", `/api/decks/${deck.id}`);
      const result = await response.json() as { deleted?: boolean };
      if (!result.deleted) {
        throw new Error("The backend did not confirm that the deck was deleted.");
      }
      return result;
    },
    onSuccess: () => {
      queryClient.setQueriesData<Deck[] | undefined>(
        { queryKey: ["/api/decks"] },
        (current) => current?.filter((candidate) => candidate.id !== deck.id),
      );
      queryClient.removeQueries({ queryKey: ["/api/decks", deck.id, "stats"] });
      queryClient.removeQueries({ queryKey: ["/api/decks", deck.id, "due"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Deck deleted",
        description: `${deck.title} was removed.`,
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Could not delete deck",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const cleanTitle = title.trim();
  const canRename = cleanTitle.length > 0 && cleanTitle !== deck.title && !renameMutation.isPending;

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Settings size={14} className="text-primary" /> Deck Settings
        </h3>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      <div className="space-y-5">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Deck name</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-xs"
            data-testid={`input-deck-name-${deck.id}`}
          />
          <Button
            size="sm"
            className="mt-3 w-full"
            disabled={!canRename}
            onClick={() => renameMutation.mutate()}
            data-testid={`button-save-deck-name-${deck.id}`}
          >
            {renameMutation.isPending ? "Saving..." : "Save Name"}
          </Button>
        </div>

        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs text-muted-foreground">
            This permanently removes the deck and its {deck.cardCount} card{deck.cardCount === 1 ? "" : "s"}.
          </p>

          {!confirmDelete ? (
            <Button
              variant="destructive"
              size="sm"
              className="mt-3 w-full"
              onClick={() => setConfirmDelete(true)}
              data-testid={`button-delete-deck-${deck.id}`}
            >
              Delete Deck
            </Button>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium text-destructive">
                Confirm deletion of "{deck.title}"?
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleteMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  data-testid={`button-confirm-delete-deck-${deck.id}`}
                >
                  {deleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page root ──────────────────────────────────────────────────────────────
export default function Flashcards() {
  const params = useParams<{ deckId?: string }>();
  const [studyDeckId, setStudyDeckId] = useState<number | undefined>(
    params.deckId ? Number(params.deckId) : undefined
  );
  const [studying, setStudying] = useState(!!params.deckId);
  const [showSettings, setShowSettings] = useState(false);
  const [deckActionPanel, setDeckActionPanel] = useState<DeckActionPanel>(null);
  const [createCardDeckId, setCreateCardDeckId] = useState<number | undefined>();
  const [settingsDeck, setSettingsDeck] = useState<Deck | null>(null);

  const startStudy = (id: number) => {
    queryClient.removeQueries({ queryKey: ["/api/decks", id, "due"] });
    queryClient.removeQueries({ queryKey: ["/api/decks", id, "stats"] });
    setStudyDeckId(id);
    setStudying(true);
    setShowSettings(false);
    setDeckActionPanel(null);
    setSettingsDeck(null);
  };

  const exitStudy = () => {
    setStudying(false);
    setStudyDeckId(undefined);
  };

  return (
    <div className="px-8 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center gap-2">
        <h1 className="text-xl font-semibold text-foreground tracking-tight" data-testid="text-flashcards-title">
          Flashcards
        </h1>
        {!studying && (
          <Button
            variant="ghost"
            size="icon"
            data-testid="button-open-flashcard-settings"
            onClick={() => {
              setDeckActionPanel(null);
              setSettingsDeck(null);
              setShowSettings(!showSettings);
            }}
            className="mt-0.5 h-7 w-7 text-muted-foreground hover:text-foreground"
            title="Flashcard settings"
            aria-label="Flashcard settings"
          >
            <Settings size={16} />
          </Button>
        )}
      </div>

      {/* Action panels */}
      {showSettings && !studying && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
          onClick={() => setShowSettings(false)}
        >
          <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <FlashcardSettingsPanel
              onClose={() => setShowSettings(false)}
            />
          </div>
        </div>
      )}

      {deckActionPanel && !studying && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
          onClick={() => setDeckActionPanel(null)}
        >
          <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            {deckActionPanel === "import" ? (
              <AnkiImportPanel onClose={() => setDeckActionPanel(null)} />
            ) : (
              <CreateDeckPanel onClose={() => setDeckActionPanel(null)} />
            )}
          </div>
        </div>
      )}

      {settingsDeck && !studying && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
          onClick={() => setSettingsDeck(null)}
        >
          <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <DeckSettingsPanel
              deck={settingsDeck}
              onClose={() => setSettingsDeck(null)}
            />
          </div>
        </div>
      )}

      {!studying && createCardDeckId !== undefined && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
          onClick={() => setCreateCardDeckId(undefined)}
        >
          <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <CreateCardPanel
              initialDeckId={createCardDeckId}
              onClose={() => setCreateCardDeckId(undefined)}
            />
          </div>
        </div>
      )}

      {studying && studyDeckId ? (
        <StudyMode deckId={studyDeckId} onExit={exitStudy} />
      ) : (
        <DeckList
          onSelect={startStudy}
          onAddCard={setCreateCardDeckId}
          onConfigureDeck={(deck) => {
            setShowSettings(false);
            setDeckActionPanel(null);
            setSettingsDeck(deck);
          }}
          onImportDeck={() => {
            setShowSettings(false);
            setSettingsDeck(null);
            setDeckActionPanel((current) => current === "import" ? null : "import");
          }}
          onCreateDeck={() => {
            setShowSettings(false);
            setSettingsDeck(null);
            setDeckActionPanel((current) => current === "new-deck" ? null : "new-deck");
          }}
          activeId={studyDeckId}
        />
      )}
    </div>
  );
}
