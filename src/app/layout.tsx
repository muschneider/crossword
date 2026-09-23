import type { Metadata, Viewport } from "next";
import { Newsreader } from "next/font/google";

import { env } from "@/lib/env";
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

export const viewport: Viewport = {
  themeColor: "#f6f3ec",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={newsreader.variable}>
      <body>{children}</body>
    </html>
  );
}
