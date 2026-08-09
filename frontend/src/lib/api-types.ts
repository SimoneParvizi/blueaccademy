export type Deck = {
  id: number;
  title: string;
  description: string;
  track: string;
  cardCount: number;
};

export type Flashcard = {
  id: number;
  deckId: number;
  front: string;
  back: string;
  codeExample: string | null;
  difficulty: string;
  tags: string;
};

export type cardProgress = {
  id: number;
  cardId: number;
  interval: number;
  easeFactor: number;
  repetitions: number;
  nextReview: number;
  firstReviewedAt: number | null;
  state: string;
  stepIndex: number | null;
  lapseCount: number;
  lastRating: number | null;
};

export type ChatMessage = {
  id: number;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};
