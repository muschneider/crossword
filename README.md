# MSCrossWords

Palavras-cruzadas geradas a partir do **seu próprio** vocabulário de inglês.
Cada usuário tem suas palavras e seus crosswords; nada é compartilhado.

- Cadastro com e-mail e senha, com **aprovação manual** de cada conta pelo admin
- Recuperação de senha por e-mail (SMTP)
- Vocabulário pessoal com importação em lote, edição, remoção e deduplicação
- Geração aleatória de crosswords com **rodízio de palavras** (as menos usadas entram primeiro)
- Metade das dicas usa a tradução em português, metade é uma frase _fill-in-the-blank_
  gerada por IA via OpenRouter
- **Um crossword ativo por vez** por usuário, garantido por índice único parcial no Postgres

---

## Stack

| Camada    | Escolha                                                       |
| --------- | ------------------------------------------------------------- |
| Framework | Next.js 15 (App Router, Server Actions, React 19)              |
| Auth      | Própria: scrypt (`node:crypto`) + sessões em banco             |
| E-mail    | Nodemailer sobre SMTP                                          |
| Banco     | Neon Postgres via driver HTTP `@neondatabase/serverless`       |
| ORM       | Drizzle ORM + drizzle-kit                                      |
| Estilo    | Tailwind CSS v4                                                |
| IA        | OpenRouter (`openai/gpt-4o-mini` por padrão)                   |

Tudo roda no **plano gratuito da Vercel**: sem workers, sem cron, sem filas, sem
sockets persistentes. O driver HTTP do Neon não mantém conexões abertas.

### Por que autenticação própria em vez de Auth.js

O provider de credenciais do Auth.js v5 só funciona com sessão **JWT**. Com JWT,
o `status` da conta fica congelado dentro do token: quando o admin aprova alguém,
a pessoa continuaria bloqueada até relogar. Como a aprovação instantânea é o
requisito central aqui, a sessão é gravada no banco e lida a cada request.

O custo disso é ~200 linhas em `src/lib/password.ts` e `src/lib/session.ts`, e em
troca saem três dependências (uma delas em beta). Decisões de segurança tomadas:

| Risco                        | Mitigação                                                                |
| ---------------------------- | ------------------------------------------------------------------------ |
| Vazamento de senhas          | scrypt (memory-hard) com salt aleatório de 16 bytes por senha             |
| Dump do banco vira sessão    | a tabela guarda o **SHA-256** do cookie, nunca o valor do cookie          |
| Força bruta                  | bloqueio de 15 min após 5 tentativas erradas, por conta                   |
| Enumeração de contas         | mensagem idêntica para e-mail inexistente e senha errada, com custo de CPU equivalente |
| Roubo de cookie              | `httpOnly`, `sameSite=lax`, `secure` em produção                          |
| CSRF                         | Server Actions do Next validam `Origin` contra `Host`, somadas ao `sameSite` |
| Link de recuperação vazado   | token de 32 bytes, guardado hasheado, expira em 30 min e é de uso único   |
| Conta comprometida           | redefinir ou trocar a senha encerra **todas** as sessões                   |
| Open redirect no login       | `callbackUrl` só aceita caminhos internos (`/algo`)                       |

---

## Setup

### 1. Dependências e banco

```bash
mise run setup          # npm install + migrations no Neon
```

### 2. Criar o administrador

```bash
mise run admin:create -- --email=voce@gmail.com --name="Seu Nome"
```

A senha é gerada e exibida **uma única vez**. Para definir você mesmo, use
`--password=...`. O comando é idempotente: rodar de novo sobre uma conta
existente promove a admin, aprova e redefine a senha.

### 3. SMTP (recuperação de senha)

No `.env`, aponte para um servidor SMTP. Com Gmail é preciso uma
[senha de app](https://myaccount.google.com/apppasswords) — a senha normal da
conta não funciona:

```ini
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="voce@gmail.com"
SMTP_PASSWORD="xxxx xxxx xxxx xxxx"
SMTP_FROM="MSCrossWords <voce@gmail.com>"
```

Valide com `mise run try:smtp`. Sem SMTP o app funciona normalmente; apenas o
"esqueci minha senha" fica desligado (e o admin redefine pelo terminal com
`mise run admin:password`).

### 4. Rodar

```bash
mise run dev            # http://localhost:3000
```

---

## Fluxo de acesso

```
/signup  → conta criada como "pendente", já logada
   ↓
/pending → tela de espera (verifica a aprovação sozinha a cada 20s)
   ↓        admin aprova em /admin/users (e-mail de aviso é enviado)
/dashboard
```

Recusar uma conta ou voltá-la para pendente encerra as sessões dela na hora.

---

## Tarefas (`mise.toml`)

| Tarefa                   | O que faz                                                       |
| ------------------------ | --------------------------------------------------------------- |
| `mise run setup`         | `install` + `db:migrate`                                        |
| `mise run dev`           | Servidor de desenvolvimento                                     |
| `mise run build`         | Build de produção                                               |
| `mise run start`         | Build + servidor de produção local                              |
| `mise run typecheck`     | `tsc --noEmit`                                                  |
| `mise run lint`          | ESLint                                                          |
| `mise run check`         | typecheck + lint + build (sequencial)                           |
| `mise run db:generate`   | Gera migration a partir do schema Drizzle                       |
| `mise run db:migrate`    | Aplica migrations pendentes                                     |
| `mise run db:push`       | Sincroniza o schema direto (atalho de dev)                      |
| `mise run db:studio`     | Drizzle Studio                                                  |
| `mise run admin:create`  | Cria/promove um admin (senha gerada)                            |
| `mise run admin:password`| Redefine a senha de uma conta e encerra as sessões dela         |
| `mise run admin:list`    | Lista as contas cadastradas                                     |
| `mise run seed:words`    | Importa `data/seed-words.txt` para uma conta                    |
| `mise run try:generator` | Testa o gerador offline (sem banco, sem IA)                     |
| `mise run try:ai`        | Testa as dicas do OpenRouter                                    |
| `mise run try:smtp`      | Valida o SMTP e envia um e-mail de teste                        |
| `mise run test:e2e`      | Regras de negócio + segurança no banco real (usuário descartável) |
| `mise run test:auth`     | Cadastro, login, bloqueio e recuperação via HTTP¹               |
| `mise run test:ui`       | Renderização das telas e guards de rota¹                        |

¹ precisa de `mise run dev` rodando em outro terminal.

### Comandos de administração

```bash
mise run admin:create   -- --email=voce@gmail.com --name="Seu Nome"
mise run admin:create   -- --email=voce@gmail.com --password="minha-senha-123"
mise run admin:password -- --email=alguem@gmail.com
mise run admin:list
mise run seed:words     -- --email=voce@gmail.com
mise run seed:words     -- --email=voce@gmail.com --file=./minha-lista.txt
```

---

## Formato da lista de palavras

Cole na tela **Palavras → Importar lista** (ou use `seed:words`):

```
- accomplish - realizar / alcançar / cumprir / concluir
- achieve - alcançar / atingir
- as far as I know - pelo que eu sei
- at least - pelo menos
```

- Marcadores de lista (`-`, `*`, `1.`) são opcionais
- Separadores aceitos: `-`, `–`, `—`, `=`, `:` (o primeiro que aparecer cercado por espaços)
- O termo pode ter espaços (phrasal verbs e expressões funcionam)
- Duplicadas são removidas **dentro da mesma lista** e **entre listas diferentes**
  (índice único por `usuário + termo normalizado`)

---

## Como o crossword é montado

1. **Seleção** (`src/lib/crossword/selector.ts`)
   Amostragem aleatória ponderada (Efraimidis–Spirakis) sobre o vocabulário.
   O peso favorece palavras nunca usadas e penaliza as recém-usadas:

   ```
   peso = 1 / (usos + 1)^1.8  ×  recência
   ```

   Assim um vocabulário grande é coberto por inteiro em vez de repetir sempre as
   mesmas 10 palavras. Medido com 200 palavras e 10 crosswords: **117 palavras
   distintas usadas, nenhuma mais de 2×**. `Zerar usos` reinicia o rodízio.

2. **Layout** (`src/lib/crossword/generator.ts`)
   Montagem _free-form_ (criss-cross) com backtracking guloso e randomizado:
   14 tentativas independentes, cada uma com ordem embaralhada, e a melhor
   (mais palavras + mais cruzamentos + mais compacta) vence.

   Três invariantes garantem um grid limpo, sem "palavras" acidentais:
   - letras sobrepostas precisam coincidir;
   - as células imediatamente antes e depois da palavra ficam vazias;
   - toda célula nova precisa ter os dois vizinhos perpendiculares vazios.

3. **Dicas** (`src/lib/crossword/clues.ts`)
   Metade das entradas (`CROSSWORD_AI_CLUE_RATIO`) vai para o OpenRouter, que
   devolve uma frase em inglês com `_____` no lugar do termo. A resposta é
   validada (tem lacuna? o gabarito vazou na frase?) e, em qualquer falha —
   rede, quota, JSON inválido, chave ausente — a dica cai silenciosamente para a
   tradução em português. **O crossword nunca deixa de ser gerado por causa da IA.**

4. **Anticola**
   Enquanto o crossword está ativo, o gabarito **não é enviado ao navegador**:
   o cliente recebe só a máscara de células, a numeração e as dicas. Conferir e
   revelar são Server Actions. Ao concluir, as respostas aparecem.

---

## Regras de negócio

| Regra                                        | Onde é garantida                                                      |
| -------------------------------------------- | --------------------------------------------------------------------- |
| Um crossword ativo por usuário               | Índice único parcial `crosswords_one_active_per_user_uq` + checagem    |
| Palavra única por usuário                    | Índice único `words_user_normalized_uq` + `ON CONFLICT DO NOTHING`     |
| E-mail único por conta (case-insensitive)    | Índice único `users_email_normalized_uq`                              |
| Todo dado é por usuário                      | `user_id` em toda query; `requireApprovedUserOrThrow()` em toda action |
| Conta nova precisa de aprovação              | `users.status` + guards em layouts, páginas e actions                 |
| Remover palavra não quebra crossword antigo  | `crossword_entries.word_id ON DELETE SET NULL`                         |
| Remover usuário apaga tudo dele              | `ON DELETE CASCADE` em words / crosswords / sessions / reset tokens    |

Só dá para gerar um novo crossword depois de **concluir** (verificação feita no
servidor, letra por letra) ou **remover** o atual.

---

## Deploy na Vercel

1. Suba o repositório no GitHub e importe em <https://vercel.com/new>
2. Em **Settings → Environment Variables**, replique tudo do `.env`:
   `DATABASE_URL`, `APP_NAME`, `APP_URL`, `SMTP_*`, `OPENROUTER_API_KEY`,
   `OPENROUTER_MODEL`
3. Rode as migrations apontando para o mesmo banco e crie o admin:

```bash
DATABASE_URL="..." mise run db:migrate
DATABASE_URL="..." mise run admin:create -- --email=voce@gmail.com
```

> As páginas que geram crossword declaram `maxDuration = 60`, dentro do limite
> do plano Hobby. `APP_URL` é detectada via `VERCEL_URL` quando não definida,
> mas vale fixar o domínio final para os links dos e-mails.

---

## Estrutura

```
src/
├── app/
│   ├── (app)/              # área autenticada e aprovada
│   │   ├── admin/users/    # aprovação de contas
│   │   ├── crossword/      # jogo
│   │   ├── dashboard/      # visão geral
│   │   ├── perfil/         # nome e troca de senha
│   │   └── words/          # CRUD + importação
│   ├── actions/            # server actions (auth, words, crossword, admin)
│   ├── login/ signup/      # entrada e cadastro
│   ├── forgot-password/    # pedido de recuperação
│   ├── reset-password/     # criação da nova senha
│   ├── pending/            # sala de espera da aprovação
│   └── globals.css         # tema Tailwind v4
├── components/             # UI (player, tabelas, formulários, nav)
├── db/                     # schema Drizzle + cliente Neon
├── lib/
│   ├── crossword/          # generator, selector, clues, service, tipos
│   ├── password.ts         # hashing scrypt + política de senha
│   ├── session.ts          # sessões em banco + guards de acesso
│   ├── password-reset.ts   # tokens de recuperação
│   ├── email.ts            # envio SMTP
│   ├── openrouter.ts       # cliente da IA
│   └── words.ts            # parser, normalização, deduplicação
└── middleware.ts           # guard otimista no Edge (presença do cookie)
```

---

## Ajustes finos (`.env`)

| Variável                  | Padrão              | Efeito                                         |
| ------------------------- | ------------------- | ---------------------------------------------- |
| `CROSSWORD_TARGET_WORDS`  | `12`                | Quantas palavras cada crossword tenta usar     |
| `CROSSWORD_CANDIDATE_POOL`| `40`                | Tamanho do pool sorteado do vocabulário        |
| `CROSSWORD_AI_CLUE_RATIO` | `0.5`               | Fração de dicas geradas por IA (`0` desliga)   |
| `OPENROUTER_MODEL`        | `openai/gpt-4o-mini`| Modelo usado nas dicas                         |
