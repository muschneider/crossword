"use client";

import { memo, type RefObject } from "react";

export const cellId = (row: number, col: number) => `cell-${row}-${col}`;

export type BoardProps = {
  mask: boolean[][];
  numbers: number[][];
  grid: string[][];
  /** `true` = the letter came pre-filled by the difficulty and is locked. */
  givens: boolean[][];
  cols: number;
  cursor: { row: number; col: number };
  /** `"row,col"` keys of the cells belonging to the selected word. */
  highlighted: Set<string>;
  /** `"row,col"` keys the last check found wrong. */
  wrong: Set<string>;
  /** `"row,col"` keys the last check confirmed correct. */
  correct: Set<string>;
  readOnly: boolean;
  inputs: RefObject<Map<string, HTMLInputElement>>;
  onWrite: (row: number, col: number, letter: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => void;
  onSelect: (row: number, col: number) => void;
};

/**
 * The classic crossword palette: the square you are on is yellow, the rest of
 * the word blue. Pre-filled letters sit on a grey square in a softer ink, so
 * they read as printed rather than typed.
 *
 * The cursor square always uses its own dark ink: the yellow stays bright in
 * the dark theme too, where the regular ink turns light and would vanish on it.
 */
function cellClasses(state: {
  isCursor: boolean;
  isHighlighted: boolean;
  isWrong: boolean;
  isCorrect: boolean;
  isGiven: boolean;
  readOnly: boolean;
}): string {
  const ink = state.isGiven ? "text-ink-muted" : state.isCorrect ? "text-good" : "text-ink";

  if (state.isWrong) return "bg-bad-soft text-bad";
  if (state.isCursor) return "bg-cursor text-on-cursor";
  if (state.isHighlighted) return `bg-word ${ink}`;
  if (state.isGiven) return `bg-given ${ink}`;
  return `bg-surface ${ink} ${state.readOnly ? "" : "hover:bg-accent-soft"}`;
}

function BoardComponent({
  mask,
  numbers,
  grid,
  givens,
  cols,
  cursor,
  highlighted,
  wrong,
  correct,
  readOnly,
  inputs,
  onWrite,
  onKeyDown,
  onSelect,
}: BoardProps) {
  return (
    <div className="board" style={{ ["--cols" as string]: cols }}>
      {mask.map((maskRow, row) =>
        maskRow.map((playable, col) => {
          if (!playable) {
            return <div key={`${row}-${col}`} className="aspect-square" />;
          }

          const key = `${row},${col}`;
          const number = numbers[row][col];
          const isGiven = givens[row]?.[col] ?? false;
          const isCursor = cursor.row === row && cursor.col === col;

          return (
            <div key={`${row}-${col}`} className="board-cell">
              {number > 0 && (
                <span
                  className={`board-number ${
                    isCursor && !wrong.has(key) ? "text-on-cursor" : "text-ink-soft"
                  }`}
                >
                  {number}
                </span>
              )}
              <input
                ref={(node) => {
                  if (node) inputs.current.set(cellId(row, col), node);
                  else inputs.current.delete(cellId(row, col));
                }}
                id={cellId(row, col)}
                type="text"
                inputMode="text"
                enterKeyHint="next"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={1}
                // Givens stay editable at the DOM level on purpose: a read-only
                // input closes the phone keyboard as soon as it gets focus. The
                // player ignores what is typed there and just moves on.
                readOnly={readOnly}
                aria-label={`Linha ${row + 1}, coluna ${col + 1}${isGiven ? " (letra dada)" : ""}`}
                value={grid[row]?.[col] ?? ""}
                onChange={(event) => {
                  if (readOnly) return;
                  const letter = event.target.value
                    .toUpperCase()
                    .replace(/[^A-Z]/g, "")
                    .slice(-1);
                  onWrite(row, col, letter);
                }}
                onKeyDown={(event) => onKeyDown(event, row, col)}
                onFocus={(event) => {
                  event.target.select();
                  onSelect(row, col);
                }}
                onPointerDown={() => onSelect(row, col)}
                className={`board-input ${cellClasses({
                  isCursor,
                  isHighlighted: highlighted.has(key),
                  isWrong: wrong.has(key),
                  isCorrect: correct.has(key),
                  isGiven,
                  readOnly,
                })} ${readOnly ? "cursor-default" : "cursor-pointer"}`}
              />
            </div>
          );
        }),
      )}
    </div>
  );
}

export const Board = memo(BoardComponent);
