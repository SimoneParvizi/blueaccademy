import { cn } from "@/lib/utils";
import type { CurrentReference } from "@/contexts/current-reference";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

const TOKEN = "\uFFF0";

function buildTokenNode(reference: CurrentReference | null) {
  const chip = document.createElement("span");
  chip.setAttribute("data-reference-token", "true");
  chip.setAttribute("contenteditable", "false");
  chip.setAttribute("title", reference ? `${reference.sourceLabel}${reference.title ? `: ${reference.title}` : ""}` : "Attached current context");
  chip.className =
    "mx-0.5 inline-flex items-center rounded-md border border-border bg-white px-1.5 py-0.5 align-baseline text-[11px] font-mono leading-none text-foreground shadow-sm dark:bg-[#3a3f49]";

  const text = document.createElement("span");
  text.textContent = "@this";
  chip.appendChild(text);

  return chip;
}

function parseDraftFromDom(container: HTMLDivElement) {
  return Array.from(container.childNodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? "";
      }
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node as HTMLElement).dataset.referenceToken === "true"
      ) {
        return TOKEN;
      }
      return node.textContent ?? "";
    })
    .join("");
}

function normalizeDraft(raw: string) {
  let next = raw.replace(/\r/g, "");
  const hasToken = next.includes(TOKEN);

  if (hasToken) {
    next = next.replace(/@this/g, "");
  } else if (next.includes("@this")) {
    next = next.replace("@this", TOKEN).replace(/@this/g, "");
  }

  const firstToken = next.indexOf(TOKEN);
  if (firstToken !== -1) {
    next =
      next.slice(0, firstToken + 1) +
      next
        .slice(firstToken + 1)
        .replaceAll(TOKEN, "");
  }

  return next;
}

function draftToPlainText(draft: string) {
  return draft.replaceAll(TOKEN, "");
}

function placeCaretAtEnd(container: HTMLDivElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(container);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export const ChatComposerInput = forwardRef<
  HTMLDivElement,
  {
    value: string;
    referenceAttached: boolean;
    reference: CurrentReference | null;
    disabled?: boolean;
    placeholder: string;
    className?: string;
    onValueChange: (value: string) => void;
    onReferenceAttachedChange: (attached: boolean) => void;
    onSubmit: () => void;
  }
>(function ChatComposerInput(
  {
    value,
    referenceAttached,
    reference,
    disabled,
    placeholder,
    className,
    onValueChange,
    onReferenceAttachedChange,
    onSubmit,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => containerRef.current as HTMLDivElement, []);

  const renderDraft = useCallback(
    (draft: string, preserveFocus = false) => {
      const container = containerRef.current;
      if (!container) return;
      const wasFocused = preserveFocus && document.activeElement === container;

      container.innerHTML = "";
      const parts = draft.split(TOKEN);
      parts.forEach((part, index) => {
        if (part) {
          container.appendChild(document.createTextNode(part));
        }
        if (index < parts.length - 1) {
          container.appendChild(buildTokenNode(reference));
        }
      });

      if (wasFocused) {
        placeCaretAtEnd(container);
      }
    },
    [reference],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const currentDraft = normalizeDraft(parseDraftFromDom(container));
    let desiredDraft = currentDraft;

    if (!referenceAttached) {
      desiredDraft = value;
    } else if (!currentDraft.includes(TOKEN)) {
      desiredDraft = `${value}${TOKEN}`;
    }

    if (currentDraft !== desiredDraft) {
      renderDraft(desiredDraft, true);
    }
  }, [referenceAttached, renderDraft, value]);

  const syncFromDom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const normalized = normalizeDraft(parseDraftFromDom(container));
    const plain = draftToPlainText(normalized);
    const attached = normalized.includes(TOKEN);

    onValueChange(plain);
    onReferenceAttachedChange(attached);

    const currentDom = parseDraftFromDom(container);
    if (currentDom !== normalized) {
      renderDraft(normalized, true);
    }
  }, [onReferenceAttachedChange, onValueChange, renderDraft]);

  return (
    <div
      ref={containerRef}
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-testid="input-chat-message"
      data-placeholder={placeholder}
      className={cn(
        "w-full rounded-md border border-input bg-white px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-card md:text-sm",
        "min-h-[44px] max-h-32 overflow-y-auto whitespace-pre-wrap break-words",
        "[&:empty:before]:pointer-events-none [&:empty:before]:text-muted-foreground [&:empty:before]:content-[attr(data-placeholder)]",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      onInput={syncFromDom}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSubmit();
        }
      }}
    />
  );
});
