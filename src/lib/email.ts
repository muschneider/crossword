import nodemailer, { type Transporter } from "nodemailer";

import { env, isEmailEnabled } from "./env";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // 465 is implicit TLS; 587 upgrades through STARTTLS.
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    });
  }
  return transporter;
}

export async function verifySmtp(): Promise<void> {
  if (!isEmailEnabled) throw new Error("SMTP não configurado (SMTP_HOST/USER/PASSWORD).");
  await getTransporter().verify();
}

type Mail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

async function send(mail: Mail): Promise<void> {
  if (!isEmailEnabled) {
    throw new Error("Envio de e-mail indisponível: SMTP não configurado.");
  }
  await getTransporter().sendMail({ from: env.SMTP_FROM, ...mail });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#080b10;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#0c1118;border:1px solid #1e2836;border-radius:16px;padding:32px;">
          <tr><td>
            <p style="margin:0 0 4px;color:#34d399;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
              ${escapeHtml(env.APP_NAME)}
            </p>
            <h1 style="margin:0 0 20px;color:#e2e8f0;font-size:22px;line-height:1.3;">${escapeHtml(title)}</h1>
            ${body}
          </td></tr>
        </table>
        <p style="margin:18px 0 0;color:#64748b;font-size:12px;">
          Você recebeu este e-mail porque tem uma conta no ${escapeHtml(env.APP_NAME)}.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

const paragraph = (content: string) =>
  `<p style="margin:0 0 16px;color:#94a3b8;font-size:15px;line-height:1.6;">${content}</p>`;

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  resetUrl: string,
  ttlMinutes: number,
): Promise<void> {
  const safeName = escapeHtml(name.split(" ")[0] || "Olá");
  const safeUrl = escapeHtml(resetUrl);

  await send({
    to,
    subject: `${env.APP_NAME} — redefinir sua senha`,
    text:
      `${name}, recebemos um pedido para redefinir a senha da sua conta no ${env.APP_NAME}.\n\n` +
      `Abra o link abaixo (válido por ${ttlMinutes} minutos):\n${resetUrl}\n\n` +
      `Se não foi você, ignore este e-mail — sua senha continua a mesma.`,
    html: layout(
      "Redefinir sua senha",
      [
        paragraph(`${safeName}, recebemos um pedido para redefinir a senha da sua conta.`),
        `<p style="margin:0 0 20px;">
           <a href="${safeUrl}" style="display:inline-block;background:#10b981;color:#080b10;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:12px;">
             Criar nova senha
           </a>
         </p>`,
        paragraph(`O link vale por <strong style="color:#cbd5e1;">${ttlMinutes} minutos</strong>.`),
        paragraph(
          `Se o botão não funcionar, copie e cole este endereço no navegador:<br>
           <span style="color:#64748b;font-size:13px;word-break:break-all;">${safeUrl}</span>`,
        ),
        paragraph(
          "Se não foi você quem pediu, pode ignorar este e-mail — sua senha continua a mesma.",
        ),
      ].join(""),
    ),
  });
}

export async function sendAccountApprovedEmail(to: string, name: string, appUrl: string) {
  const safeName = escapeHtml(name.split(" ")[0] || "Olá");
  const safeUrl = escapeHtml(appUrl);

  await send({
    to,
    subject: `${env.APP_NAME} — sua conta foi aprovada`,
    text: `${name}, sua conta no ${env.APP_NAME} foi aprovada. Acesse: ${appUrl}`,
    html: layout(
      "Conta aprovada",
      [
        paragraph(`${safeName}, sua conta foi aprovada por um administrador.`),
        `<p style="margin:0 0 20px;">
           <a href="${safeUrl}" style="display:inline-block;background:#10b981;color:#080b10;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:12px;">
             Entrar no ${escapeHtml(env.APP_NAME)}
           </a>
         </p>`,
        paragraph("Bons estudos!"),
      ].join(""),
    ),
  });
}
