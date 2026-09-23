/**
 * Colour theme. Light is the default; dark is opt-in.
 *
 * Stored in a plain cookie rather than localStorage so the server can render
 * `<html data-theme>` already right: no flash of the light theme before a
 * script gets to run, and no hydration mismatch. It is a per-device choice —
 * dark on the phone at night, light on the laptop — so it does not belong in
 * the database.
 *
 * Client-safe: no server imports here (see `theme-server.ts`).
 */
export type Theme = "light" | "dark";

export const THEMES: readonly Theme[] = ["light", "dark"];

export const THEME_COOKIE = "mscw_theme";

export const THEME_LABELS: Record<Theme, string> = {
  light: "Claro",
  dark: "Escuro",
};

/** Browser chrome colour (`<meta name="theme-color">`), matching `--color-paper`. */
export const THEME_COLORS: Record<Theme, string> = {
  light: "#f6f3ec",
  dark: "#141311",
};

/** Anything that is not explicitly `dark` is the default light theme. */
export function parseTheme(value: unknown): Theme {
  return value === "dark" ? "dark" : "light";
}
