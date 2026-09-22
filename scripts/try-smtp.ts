/**
 * Validates the SMTP credentials and optionally sends a real test message.
 *   mise run try:smtp
 *   mise run try:smtp -- --to=alguem@exemplo.com
 */
import "dotenv/config";

import { sendPasswordResetEmail, verifySmtp } from "../src/lib/email";
import { env, isEmailEnabled } from "../src/lib/env";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  if (!isEmailEnabled) {
    console.error("SMTP não configurado. Defina SMTP_HOST, SMTP_USER e SMTP_PASSWORD no .env.");
    process.exit(1);
  }

  console.log(`Host : ${env.SMTP_HOST}:${env.SMTP_PORT}`);
  console.log(`User : ${env.SMTP_USER}`);
  console.log(`From : ${env.SMTP_FROM}\n`);

  await verifySmtp();
  console.log("✓ Conexão e autenticação SMTP OK.");

  const to = arg("to") ?? env.SMTP_USER;
  await sendPasswordResetEmail(
    to,
    "Teste",
    `${env.APP_URL}/reset-password?token=exemplo-de-token`,
    30,
  );
  console.log(`✓ E-mail de teste enviado para ${to}.`);
}

main().catch((error) => {
  console.error("✗ Falhou:", error instanceof Error ? error.message : error);
  process.exit(1);
});
