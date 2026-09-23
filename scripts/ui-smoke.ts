/**
 * Renders the pages against a running dev server, forging a database session to
 * reach the authenticated ones, then removes every row it created.
 *
 *   mise run dev            (in another terminal)
 *   mise run test:ui
 */
import "dotenv/config";

import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "../src/db";
import { sessions, users, words } from "../src/db/schema";
import { generateCrosswordForUser } from "../src/lib/crossword/service";
import { hashPassword } from "../src/lib/password";
import { parseWordList } from "../src/lib/words";

const BASE = process.env.SMOKE_URL ?? "http://localhost:3000";

async function get(path: string, token?: string) {
  const response = await fetch(`${BASE}${path}`, {
    headers: token ? { cookie: `mscw_session=${token}` } : {},
    redirect: "manual",
  });
  const body = response.status === 200 ? await response.text() : "";
  return { status: response.status, location: response.headers.get("location"), body };
}

function expect(label: string, condition: boolean, extra = "") {
  console.log(`${condition ? "✓" : "✗"} ${label}${extra ? ` ${extra}` : ""}`);
  if (!condition) process.exitCode = 1;
}

async function main() {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const email = `smoke-${Date.now()}@example.test`;

  const [created] = await db
    .insert(users)
    .values({
      name: "Smoke Tester",
      email,
      emailNormalized: email,
      passwordHash: await hashPassword("Senha-Forte-123"),
      role: "admin",
      status: "pending",
    })
    .returning({ id: users.id });
  const userId = created.id;

  await db.insert(sessions).values({
    tokenHash,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  try {
    /* --------------------------- public pages --------------------------- */
    const login = await get("/login");
    expect(
      "/login renderiza o formulário de e-mail e senha",
      login.status === 200 &&
        login.body.includes('name="password"') &&
        login.body.includes("Esqueci minha senha"),
    );

    const signup = await get("/signup");
    expect(
      "/signup renderiza o cadastro",
      signup.status === 200 &&
        signup.body.includes('name="passwordConfirmation"') &&
        signup.body.includes("pendente"),
    );

    const forgot = await get("/forgot-password");
    expect(
      "/forgot-password renderiza (SMTP configurado)",
      forgot.status === 200 && forgot.body.includes("link de recuperação"),
    );

    const badReset = await get("/reset-password?token=inexistente");
    expect(
      "/reset-password rejeita token inválido",
      badReset.status === 200 && badReset.body.includes("Link inválido"),
    );

    const anonymous = await get("/dashboard");
    expect(
      "visitante anônimo é mandado para /login",
      anonymous.status === 307 && (anonymous.location ?? "").includes("/login"),
      `(${anonymous.status} -> ${anonymous.location})`,
    );

    /* ------------------------- pending account -------------------------- */
    const pending = await get("/dashboard", token);
    expect(
      "usuário pendente é barrado no /dashboard",
      pending.status === 307 && (pending.location ?? "").endsWith("/pending"),
      `(${pending.status} -> ${pending.location})`,
    );

    const pendingPage = await get("/pending", token);
    expect(
      "tela de espera renderiza",
      pendingPage.status === 200 && pendingPage.body.includes("Aguardando aprovação"),
    );

    /* -------------------------- approved account ------------------------ */
    await db.update(users).set({ status: "approved" }).where(eq(users.id, userId));

    const emptyCrossword = await get("/crossword", token);
    expect(
      "sem palavras, /crossword pede cadastro",
      emptyCrossword.status === 200 && emptyCrossword.body.includes("Nenhum crossword ainda"),
    );

    const parsed = parseWordList(readFileSync("data/seed-words.txt", "utf8"));
    await db.insert(words).values(parsed.words.map((word) => ({ userId, ...word })));

    const wordsPage = await get("/words", token);
    expect(
      "/words lista o vocabulário",
      wordsPage.status === 200 &&
        wordsPage.body.includes("accomplish") &&
        wordsPage.body.includes("Importar lista de palavras"),
    );

    const dashboard = await get("/dashboard", token);
    expect(
      "/dashboard mostra as estatísticas",
      dashboard.status === 200 && dashboard.body.includes("Gerar novo crossword"),
    );

    const profile = await get("/perfil", token);
    expect(
      "/perfil permite trocar nome e senha",
      profile.status === 200 &&
        profile.body.includes('name="currentPassword"') &&
        profile.body.includes(email),
    );

    await generateCrosswordForUser(userId, "easy");

    const puzzle = await get("/crossword", token);
    const inputs = (puzzle.body.match(/aria-label="Linha /g) ?? []).length;
    expect("/crossword renderiza o grid", puzzle.status === 200 && inputs > 20, `(${inputs} células)`);
    expect(
      "dicas horizontais e verticais presentes",
      puzzle.body.includes("Horizontais") && puzzle.body.includes("Verticais"),
    );
    expect(
      "gabarito NÃO vai para o cliente enquanto está ativo",
      !puzzle.body.includes('"answer"') && !puzzle.body.includes('\\"answer\\"'),
    );
    // The key, not the value: `"clueSource":"translation"` is fine, a
    // `"translation":"..."` field is a meaning sent before it was asked for.
    expect(
      "traduções em português NÃO vão para o cliente antes do botão PT",
      !puzzle.body.includes('"translation":') && !puzzle.body.includes('\\"translation\\":'),
    );
    expect(
      "fácil: letras dadas travadas e botão PT presentes",
      puzzle.body.includes("(letra dada)") && puzzle.body.includes("Mostrar a tradução em português"),
    );

    /* ------------------------------- admin ------------------------------ */
    const admin = await get("/admin/users", token);
    expect("/admin/users acessível para admin", admin.status === 200 && admin.body.includes(email));

    await db.update(users).set({ role: "user" }).where(eq(users.id, userId));
    const denied = await get("/admin/users", token);
    expect(
      "/admin/users bloqueado para usuário comum",
      denied.status === 307 && (denied.location ?? "").endsWith("/dashboard"),
      `(${denied.status} -> ${denied.location})`,
    );

    /* -------------------------- session revocation ---------------------- */
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    const revoked = await get("/dashboard", token);
    expect(
      "sessão revogada perde o acesso na hora",
      revoked.status === 307 && (revoked.location ?? "").includes("/login"),
      `(${revoked.status} -> ${revoked.location})`,
    );
  } finally {
    await db.delete(users).where(eq(users.id, userId));
    console.log("✓ limpeza concluída");
  }
}

main().catch((error) => {
  console.error("\n✗ FALHOU:", error);
  process.exit(1);
});
