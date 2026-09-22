/**
 * Exercises the real authentication flow over HTTP against a running dev
 * server, submitting the forms exactly like a browser with JavaScript disabled
 * would: Next.js renders progressive-enhancement hidden fields ($ACTION_*) that
 * address the very same Server Action the client bundle calls.
 *
 *   mise run dev             (in another terminal)
 *   mise run test:auth
 */
import "dotenv/config";

import { eq, like } from "drizzle-orm";

import { db } from "../src/db";
import { passwordResetTokens, sessions, users } from "../src/db/schema";
import { hashResetToken } from "../src/lib/password-reset";

const BASE = process.env.SMOKE_URL ?? "http://localhost:3000";

let failures = 0;
function expect(label: string, condition: boolean, extra = "") {
  console.log(`${condition ? "✓" : "✗"} ${label}${extra ? ` ${extra}` : ""}`);
  if (!condition) failures += 1;
}

function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

type ActionFields = Record<string, string>;

/**
 * Reads the hidden `$ACTION_*` inputs Next.js renders inside a form.
 * `marker` selects the right form on pages that render more than one.
 */
async function actionFields(path: string, marker?: string, cookie?: string): Promise<ActionFields> {
  const html = await (
    await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} })
  ).text();

  const forms = [...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)].map((match) => match[0]);
  const form = marker
    ? forms.find((candidate) => candidate.includes(`name="${marker}"`))
    : forms[0];
  if (!form) throw new Error(`Nenhum <form>${marker ? ` com "${marker}"` : ""} em ${path}`);

  const fields: ActionFields = {};
  for (const input of form.matchAll(/<input[^>]*name="(\$ACTION[^"]*)"[^>]*>/g)) {
    const name = decode(input[1]);
    const value = input[0].match(/value="([^"]*)"/)?.[1] ?? "";
    fields[name] = decode(value);
  }
  if (Object.keys(fields).length === 0) throw new Error(`Sem campos $ACTION em ${path}`);
  return fields;
}

type Submission = { status: number; location: string | null; body: string; cookies: string[] };

async function submit(
  path: string,
  values: Record<string, string>,
  options: { cookie?: string; marker?: string; fields?: ActionFields } = {},
): Promise<Submission> {
  const { cookie, marker, fields } = options;
  const body = new FormData();
  const hidden = fields ?? (await actionFields(path, marker, cookie));
  for (const [key, value] of Object.entries(hidden)) body.set(key, value);
  for (const [key, value] of Object.entries(values)) body.set(key, value);

  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      // Next.js validates Origin against Host to block cross-site action calls.
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body,
    redirect: "manual",
  });

  return {
    status: response.status,
    location: response.headers.get("location") ?? response.headers.get("x-action-redirect"),
    body: await response.text(),
    cookies: response.headers.getSetCookie?.() ?? [],
  };
}

function sessionCookie(cookies: string[]): string | null {
  const header = cookies.find((value) => value.startsWith("mscw_session="));
  if (!header) return null;
  const value = header.split(";")[0].slice("mscw_session=".length);
  return value ? `mscw_session=${value}` : null;
}

function redirectsTo(result: Submission, path: string): boolean {
  return (result.location ?? "").includes(path) || result.body.includes(path);
}

async function main() {
  const stamp = Date.now();
  const email = `flow-${stamp}@example.test`;
  const password = "Senha-Forte-123";
  const newPassword = "Nova-Senha-456";

  try {
    /* ------------------------------ sign up ------------------------------ */
    const weak = await submit("/signup", {
      name: "Flow Tester",
      email,
      password: "abc12",
      passwordConfirmation: "abc12",
    });
    expect("cadastro rejeita senha curta", weak.body.includes("pelo menos 8 caracteres"));

    const noDigits = await submit("/signup", {
      name: "Flow Tester",
      email,
      password: "somenteletras",
      passwordConfirmation: "somenteletras",
    });
    expect("cadastro exige letras e números", noDigits.body.includes("misturar letras e números"));

    const mismatch = await submit("/signup", {
      name: "Flow Tester",
      email,
      password,
      passwordConfirmation: "Outra-Senha-123",
    });
    expect("cadastro rejeita confirmação divergente", mismatch.body.includes("não conferem"));

    const created = await submit("/signup", {
      name: "Flow Tester",
      email,
      password,
      passwordConfirmation: password,
    });
    expect(
      "cadastro cria a conta, abre sessão e manda para /pending",
      sessionCookie(created.cookies) !== null && redirectsTo(created, "/pending"),
      `(${created.status} -> ${created.location})`,
    );

    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, email.toLowerCase()));
    expect(
      "conta gravada como pendente, papel user",
      dbUser?.status === "pending" && dbUser?.role === "user",
    );
    expect("senha nunca gravada em texto puro", !dbUser.passwordHash.includes(password));

    const duplicate = await submit("/signup", {
      name: "Outro",
      email: email.toUpperCase(),
      password,
      passwordConfirmation: password,
    });
    expect(
      "cadastro bloqueia e-mail duplicado (case-insensitive)",
      duplicate.body.includes("Já existe uma conta"),
    );

    /* ------------------------------- login ------------------------------- */
    const wrong = await submit("/login", { email, password: "senha-errada-1" });
    expect("login rejeita senha errada", wrong.body.includes("E-mail ou senha incorretos"));

    const unknown = await submit("/login", {
      email: `nao-existe-${stamp}@example.test`,
      password,
    });
    expect(
      "login não revela se o e-mail existe (mesma mensagem)",
      unknown.body.includes("E-mail ou senha incorretos"),
    );

    const pendingLogin = await submit("/login", { email, password });
    expect(
      "login de conta pendente vai para /pending",
      sessionCookie(pendingLogin.cookies) !== null && redirectsTo(pendingLogin, "/pending"),
    );

    /* --------------------------- brute force lock ------------------------ */
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await submit("/login", { email, password: `errada-${attempt}` });
    }
    const locked = await submit("/login", { email, password: "errada-final" });
    expect("5 tentativas erradas bloqueiam a conta", locked.body.includes("bloqueada"));

    const lockedWithRightPassword = await submit("/login", { email, password });
    expect(
      "bloqueio vale mesmo com a senha correta",
      lockedWithRightPassword.body.includes("Muitas tentativas"),
    );

    await db
      .update(users)
      .set({ lockedUntil: null, failedLoginAttempts: 0, status: "approved" })
      .where(eq(users.id, dbUser.id));

    const approved = await submit("/login", { email, password });
    const cookie = sessionCookie(approved.cookies);
    expect(
      "conta aprovada entra no /dashboard",
      cookie !== null && redirectsTo(approved, "/dashboard"),
      `(${approved.status} -> ${approved.location})`,
    );

    const openRedirect = await submit("/login", {
      email,
      password,
      callbackUrl: "https://evil.example.com/steal",
    });
    expect(
      "callbackUrl externo é ignorado (sem open redirect)",
      !openRedirect.body.includes("evil.example.com") &&
        !(openRedirect.location ?? "").includes("evil.example.com"),
    );

    const [afterLogin] = await db.select().from(users).where(eq(users.id, dbUser.id));
    expect("último acesso registrado", afterLogin.lastLoginAt !== null);

    /* -------------------------- protected access ------------------------- */
    const dashboard = await fetch(`${BASE}/dashboard`, {
      headers: { cookie: cookie! },
      redirect: "manual",
    });
    expect("sessão obtida no login abre o /dashboard", dashboard.status === 200);

    /* --------------------------- change password ------------------------- */
    const wrongCurrent = await submit(
      "/perfil",
      {
        currentPassword: "nao-e-essa-1",
        password: newPassword,
        passwordConfirmation: newPassword,
      },
      { cookie: cookie!, marker: "currentPassword" },
    );
    expect(
      "troca de senha exige a senha atual correta",
      wrongCurrent.body.includes("Senha atual incorreta"),
    );

    // Same action, no session: must not leak Next.js control-flow internals.
    const profileFields = await actionFields("/perfil", "currentPassword", cookie!);
    const anonymousChange = await submit(
      "/perfil",
      { currentPassword: password, password: newPassword, passwordConfirmation: newPassword },
      { fields: profileFields },
    );
    expect(
      "troca de senha sem sessão não vaza NEXT_REDIRECT",
      !anonymousChange.body.includes("NEXT_REDIRECT"),
    );

    /* ---------------------------- reset password ------------------------- */
    const forgot = await submit("/forgot-password", { email });
    expect(
      "pedido de recuperação responde de forma genérica",
      forgot.body.includes("Se existir uma conta"),
    );

    const [resetRow] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, dbUser.id));
    expect("token de recuperação gravado", Boolean(resetRow));
    expect("token gravado como hash de 64 hex", /^[0-9a-f]{64}$/.test(resetRow?.tokenHash ?? ""));

    const unknownForgot = await submit("/forgot-password", {
      email: `nao-existe-${stamp}@example.test`,
    });
    expect(
      "recuperação não revela se o e-mail existe",
      unknownForgot.body.includes("Se existir uma conta"),
    );

    // The e-mailed token is never stored, so plant one whose value we know.
    const knownToken = `token-${stamp}`;
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, dbUser.id));
    await db.insert(passwordResetTokens).values({
      tokenHash: hashResetToken(knownToken),
      userId: dbUser.id,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    const resetPage = await (await fetch(`${BASE}/reset-password?token=${knownToken}`)).text();
    expect("/reset-password aceita token válido", resetPage.includes("Criar nova senha"));

    const resetFields = await actionFields(`/reset-password?token=${knownToken}`);
    const reset = await submit(
      `/reset-password?token=${knownToken}`,
      { token: knownToken, password: newPassword, passwordConfirmation: newPassword },
      { fields: resetFields },
    );
    expect(
      "redefinição de senha concluída",
      redirectsTo(reset, "/login"),
      `(${reset.status} -> ${reset.location})`,
    );

    const sessionsLeft = await db.select().from(sessions).where(eq(sessions.userId, dbUser.id));
    expect("redefinição encerra todas as sessões abertas", sessionsLeft.length === 0);

    const revokedAccess = await fetch(`${BASE}/dashboard`, {
      headers: { cookie: cookie! },
      redirect: "manual",
    });
    expect("sessão antiga perde o acesso", revokedAccess.status === 307);

    const reusedPage = await (await fetch(`${BASE}/reset-password?token=${knownToken}`)).text();
    expect(
      "página do token já usado mostra o erro e some com o formulário",
      reusedPage.includes("Link inválido") && !reusedPage.includes('name="passwordConfirmation"'),
    );

    const reused = await submit(
      `/reset-password?token=${knownToken}`,
      { token: knownToken, password: newPassword, passwordConfirmation: newPassword },
      { fields: resetFields },
    );
    expect(
      "action recusa token já utilizado",
      reused.body.includes("já utilizado") || reused.body.includes("Link inválido"),
    );

    const oldLogin = await submit("/login", { email, password });
    expect("senha antiga deixa de funcionar", oldLogin.body.includes("E-mail ou senha incorretos"));

    const newLogin = await submit("/login", { email, password: newPassword });
    expect(
      "senha nova funciona",
      sessionCookie(newLogin.cookies) !== null && redirectsTo(newLogin, "/dashboard"),
    );

    const openSessions = await db.select().from(sessions).where(eq(sessions.userId, dbUser.id));
    expect("exatamente uma sessão ativa após o novo login", openSessions.length === 1);
    expect(
      "cookie de sessão é httpOnly e sameSite=lax",
      newLogin.cookies.some(
        (value) =>
          value.startsWith("mscw_session=") &&
          /httponly/i.test(value) &&
          /samesite=lax/i.test(value),
      ),
    );
  } finally {
    await db.delete(users).where(like(users.emailNormalized, `flow-${stamp}%`));
    console.log("✓ limpeza concluída");
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} verificação(ões) falharam.`);
    process.exit(1);
  }
  console.log("\nTodas as verificações de autenticação passaram.");
}

main().catch((error) => {
  console.error("\n✗ FALHOU:", error);
  process.exit(1);
});
