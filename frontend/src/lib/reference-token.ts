import type { CurrentReference } from "@/contexts/current-reference";

const THIS_TOKEN = /@this\b/gi;

export function containsReferenceToken(text: string) {
  return /@this\b/i.test(text);
}

export function consumeReferenceToken(text: string) {
  const hadToken = containsReferenceToken(text);
  if (!hadToken) {
    return { text, consumed: false };
  }

  return {
    text: text
      .replace(THIS_TOKEN, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trimStart(),
    consumed: true,
  };
}

export function attachReferenceToMessage(
  text: string,
  reference: CurrentReference | null,
): { resolved: string; usedReference: boolean } | null {
  if (!reference) {
    return null;
  }

  const inlineText = text.trim();
  const referenceLabel = reference.title
    ? `${reference.sourceLabel} — ${reference.title}`
    : reference.sourceLabel;
  const quotedContent = reference.content
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

  return {
    resolved: inlineText
      ? `${inlineText}\n\n[Context: ${referenceLabel}]\n${quotedContent}`
      : `[Context: ${referenceLabel}]\n${quotedContent}`,
    usedReference: true,
  };
}
