"use client";

import { useSyncExternalStore } from "react";

import { parseTheme, THEME_COLORS, THEME_COOKIE, type Theme } from "@/lib/theme";

const CHANGE_EVENT = "mscw:theme-change";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * The source of truth on the client is `<html data-theme>`: the server renders
 * it from the cookie, and `setTheme` rewrites both. Every control reads from
 * there, so the header toggle and the profile picker never disagree.
 */
function readTheme(): Theme {
  return parseTheme(document.documentElement.dataset.theme);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/**
 * Switches instantly, without a round trip: the attribute changes the CSS
 * variables right away, and the cookie makes every later server render agree.
 */
export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Current theme. `initial` is what the server read from the cookie; it is only
 * used while rendering on the server and hydrating, so both render the same.
 */
export function useTheme(initial: Theme): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => initial);
}
