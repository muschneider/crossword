import type { Metadata, Viewport } from "next";
import { Newsreader } from "next/font/google";

import { env } from "@/lib/env";
import { THEME_COLORS } from "@/lib/theme";
import { getTheme } from "@/lib/theme-server";
import "./globals.css";

/** A serif drawn for reading the news — used for titles only. */
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-newsreader",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${env.APP_NAME} — treino de vocabulário`,
    template: `%s · ${env.APP_NAME}`,
  },
  description:
    "Palavras-cruzadas montadas com o seu próprio vocabulário de inglês, com dicas em inglês escritas e conferidas por IA.",
};

/** The browser chrome follows the chosen theme, not just the light default. */
export async function generateViewport(): Promise<Viewport> {
  return {
    themeColor: THEME_COLORS[await getTheme()],
    width: "device-width",
    initialScale: 1,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered on the server from the cookie, so the first paint is already in
  // the right theme — no flash of light before a script could switch it.
  const theme = await getTheme();

  return (
    <html lang="pt-BR" data-theme={theme} className={newsreader.variable}>
      <body>{children}</body>
    </html>
  );
}
