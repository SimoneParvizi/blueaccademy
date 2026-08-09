import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type CurrentReference = {
  kind: "flashcard" | "terminal" | "ckad";
  sourceLabel: string;
  title?: string;
  content: string;
};

type CurrentReferenceContextValue = {
  reference: CurrentReference | null;
  setReference: (reference: CurrentReference) => void;
  clearReference: () => void;
};

const CurrentReferenceContext = createContext<CurrentReferenceContextValue | null>(null);

export function CurrentReferenceProvider({ children }: { children: ReactNode }) {
  const [reference, setReferenceState] = useState<CurrentReference | null>(null);

  const value = useMemo<CurrentReferenceContextValue>(
    () => ({
      reference,
      setReference: (nextReference) => setReferenceState(nextReference),
      clearReference: () => setReferenceState(null),
    }),
    [reference],
  );

  return (
    <CurrentReferenceContext.Provider value={value}>
      {children}
    </CurrentReferenceContext.Provider>
  );
}

export function useCurrentReference() {
  const context = useContext(CurrentReferenceContext);
  if (!context) {
    throw new Error("useCurrentReference must be used within a CurrentReferenceProvider");
  }
  return context;
}
