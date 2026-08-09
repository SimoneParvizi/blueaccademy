import type { CurrentReference } from "@/contexts/current-reference";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export function ReferenceTokenIndicator({
  active,
  reference,
  onRemove,
  className,
  compact = false,
}: {
  active: boolean;
  reference: CurrentReference | null;
  onRemove?: () => void;
  className?: string;
  compact?: boolean;
}) {
  if (!active) return null;

  const hasReference = Boolean(reference);
  const label = reference
    ? reference.title
      ? `${reference.sourceLabel}: ${reference.title}`
      : reference.sourceLabel
    : "No active flashcard or exercise selected";

  return (
    <div
      className={cn(
        compact
          ? "inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
          : "flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs",
        hasReference
          ? "border-border bg-white/90 text-foreground dark:bg-[#3a3f49]"
          : "border-red-500/30 bg-red-500/10 text-red-400",
        className,
      )}
    >
      <span
        className={cn(
          "rounded-md border px-1.5 py-0.5 font-mono text-[11px]",
          hasReference
            ? "border-border bg-background text-foreground dark:bg-[#2b2b2b]"
            : "border-red-500/30 bg-red-500/10 text-red-300",
        )}
      >
        @this
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          hasReference ? "text-muted-foreground" : "text-red-300",
          compact && "max-w-[220px]",
        )}
      >
        {hasReference ? `Attached: ${label}` : label}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className={cn(
            "ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-colors",
            hasReference
              ? "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
              : "text-red-300 hover:bg-red-500/10 hover:text-red-200",
          )}
          title="Remove attached context"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
