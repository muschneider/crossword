import "server-only";

import { cookies } from "next/headers";

import { parseTheme, THEME_COOKIE, type Theme } from "./theme";

/** The theme this browser picked, read from its cookie. */
export async function getTheme(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
