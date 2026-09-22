import type { Metadata, Viewport } from "next";

import { env } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${env.APP_NAME} — treino de vocabulário`,
    template: `%s · ${env.APP_NAME}`,
  },
  description:
    "Gere palavras-cruzadas a partir do seu próprio vocabulário de inglês, com dicas em português e frases geradas por IA.",
};

export const viewport: Viewport = {
  themeColor: "#080b10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
