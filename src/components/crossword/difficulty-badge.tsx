import { DIFFICULTY_LABELS, type Difficulty } from "@/lib/crossword/difficulty";

const TONE: Record<Difficulty, string> = {
  easy: "bg-good-soft text-good",
  medium: "bg-warn-soft text-warn",
  hard: "bg-bad-soft text-bad",
};

/** Shared by the player (client) and the dashboard history (server). */
export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className={`badge shrink-0 font-sans ${TONE[difficulty] ?? TONE.hard}`}>
      {DIFFICULTY_LABELS[difficulty] ?? difficulty}
    </span>
  );
}
