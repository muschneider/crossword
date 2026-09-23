# MSCrossWords

Palavras-cruzadas geradas a partir do **seu próprio** vocabulário de inglês.
Cada usuário tem suas palavras e seus crosswords; nada é compartilhado.

- Cadastro com e-mail e senha, com **aprovação manual** de cada conta pelo admin
- Recuperação de senha por e-mail (SMTP)
- Vocabulário pessoal com importação em lote, edição, remoção e deduplicação
- **Repetição espaçada**: o que você erra volta em horas, o que você domina
  espaça até 35 dias
- **Dicas sempre em inglês, escritas e conferidas por IA**, endurecendo junto com
  o domínio: explicação simples → definição → dica curta de jornal. Nada de
  frase com lacuna para completar
- **Botão PT** em cada dica mostra a tradução em português — inclusive das
  palavras já preenchidas
- **Três dificuldades** ao gerar: fácil (bastante letras e uma palavra pronta),
  médio (algumas letras) e difícil (grid vazio)
- **Tema claro de jornal** por padrão, com **tema escuro** opcional (sol/lua no
  cabeçalho ou em Perfil → Aparência)
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
| Estilo    | Tailwind CSS v4, tema claro de jornal + escuro (Newsreader nos títulos) |
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
| `mise run try:ai`        | Roda o pipeline de dicas e mostra candidatas e palpites da IA   |
| `mise run try:smtp`      | Valida o SMTP e envia um e-mail de teste                        |
| `mise run test:e2e`      | Regras de negócio + segurança no banco real (usuário descartável) |
| `mise run test:scheduling`| Repetição espaçada e rodízio, com simulação de 70 crosswords   |
| `mise run test:reveal`   | Os dois modos de revelação (função pura)                        |
| `mise run test:difficulty`| Letras dadas por dificuldade em 120 layouts (função pura)      |
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

## A estratégia de estudo

O app não sorteia palavras: ele **agenda** palavras. Cada termo carrega uma
caixa de Leitner (`level`, 0 a 5) que decide duas coisas ao mesmo tempo —
**quando** a palavra volta e **quão difícil** é a dica dela. Os dois eixos de
dificuldade andam juntos em vez de serem aleatórios.

### 1. O resultado de cada palavra (`src/lib/crossword/scheduling.ts`)

Ao concluir um crossword, cada entrada é classificada pelo que o servidor
registrou durante a partida:

| Resultado  | Quando                                                          | Efeito                         |
| ---------- | --------------------------------------------------------------- | ------------------------------ |
| `clean`    | sem ajuda e sem erro                                            | sobe 1 caixa, streak +1        |
| `assisted` | sem ajuda, mas a dificuldade já deu metade das letras ou mais   | mantém a caixa **e** o streak  |
| `shaky`    | errou, recebeu 1 letra, ou viu a tradução antes de acertar      | mantém a caixa, streak 0       |
| `failed`   | metade do que faltava achar foi revelada                        | **cai 2 caixas**               |
| `skipped`  | a palavra inteira veio pronta (a grátis do fácil)               | não é pontuada                 |

Uma letra revelada não é falha: palavras se cruzam, então pedir ajuda numa
inevitavelmente preenche uma letra da outra. Só precisar de metade conta como
não saber. A queda é de duas caixas porque errar uma palavra que já estava
"firme" significa que as promoções anteriores foram otimistas — cair só uma
ainda a deixaria a uma semana de distância.

As letras dadas pela dificuldade não são dica — o jogador não pediu por elas —,
mas facilitam a lembrança: uma palavra que chegou meio preenchida não prova que
foi sabida, então não sobe (e também não conta erro). "Metade revelada" é
medida sobre o que faltava achar, não sobre a palavra inteira. Ver a tradução
em português **depois** que a palavra já está certa não custa nada.

### 2. Quando a palavra volta

```
nível   0    1    2    3    4     5
dias    0    1    3    7    16    35
```

### 3. Como a dica é escrita (`src/lib/crossword/ai-clues.ts`)

Toda dica é em inglês e nunca é uma frase com lacuna para completar. O que muda
com o nível é quanto ela ajuda:

| Nível | Estilo       | Exemplo para `afraid`                              |
| ----- | ------------ | -------------------------------------------------- |
| 0–1   | `simple`     | Feeling fear; how many people feel about spiders    |
| 2–3   | `definition` | Frightened that something bad may happen            |
| 4–5   | `crossword`  | Scared                                              |

Na tela, de 1 a 3 tracinhos ao lado de cada dica indicam o estilo. A tradução em
português fica atrás do botão **PT**.

Uma dica que *soa* bem não é necessariamente uma dica que *leva* à resposta. Por
isso cada crossword passa por quatro etapas:

1. **Escrever** — o modelo recebe a palavra, a contagem de letras, o sentido em
   português (só para escolher a acepção certa) e as dicas que a palavra já teve
   antes, e escreve **duas** candidatas no estilo pedido, na mesma classe e
   forma da resposta (passado para passado, plural para plural);
2. **Filtrar** — regras locais descartam o que entrega a resposta (a palavra, as
   flexões, a família: `claim` para `claiming`, `play` para `playful`, e até a
   grafia correta de um erro de digitação: `whose` para `whoose`), tem lacuna,
   fala de gramática em vez de sentido ("past tense of…") ou escorregou para o
   português;
3. **Resolver às cegas** — outra chamada, que só vê a dica, a contagem de letras
   e a primeira letra (mais ou menos o que um cruzamento dá ao jogador), tenta
   adivinhar a palavra. A dica só é **verificada** se a resposta estiver entre os
   três primeiros palpites. É aqui que caem as dicas vagas e as que servem melhor
   a um sinônimo do mesmo tamanho;
4. **Reparar** — palavras sem nenhuma candidata verificada são reescritas uma
   vez, já sabendo o que o resolvedor respondeu, e resolvidas de novo.

As chamadas rodam em paralelo, com orçamento de 40 s (tipicamente 10–15 s). Se o
tempo acaba, vale a melhor candidata até ali, mesmo sem verificação. Nas
medições com `mise run try:ai` e com o vocabulário real, cerca de 90% das dicas
saíram verificadas.

Só quando a IA não devolve **nenhuma** dica em inglês para uma palavra — rede,
quota, chave ausente — ela cai para a tradução em português, e a geração avisa
quantas foram. **O crossword nunca deixa de ser gerado por causa da IA.**

### 4. Quem entra no próximo crossword (`src/lib/crossword/selector.ts`)

Amostragem aleatória ponderada (Efraimidis–Spirakis), com peso em três faixas:

```
nunca praticada       → 6.0
vencida               → fragilidade × (1.5 … 5.0), conforme o atraso
ainda no prazo        → fragilidade × 0.15, decaindo com a espera
fragilidade = 1 / (nível + 1)^1.3
```

Peso sozinho não basta. Quem tem 20 palavras que erra sempre gera 20 revisões
por dia contra 12 vagas: a faixa difícil engoliria todo crossword e o resto do
vocabulário nunca mais circularia — e portanto nunca chegaria às dicas mais
duras. Por isso cada faixa tem **teto de metade do crossword**, o mesmo que o
Anki faz com os limites diários de cartas novas e de revisão. A cota é teto,
nunca piso: faixa que não enche cede as vagas.

Medido em `mise run test:scheduling` (simulação de 70 crosswords sobre 120
palavras, com o usuário errando sempre 1/4 delas):

```
120/120 palavras usadas · difíceis 11.8× · fáceis 5.4× · 90/90 dominadas
```

### 5. Layout (`src/lib/crossword/generator.ts`)

Montagem _free-form_ (criss-cross) com backtracking guloso e randomizado:
14 tentativas independentes, cada uma com ordem embaralhada, e a melhor
(mais palavras + mais cruzamentos + mais densa) vence. O lado do grid é
dimensionado pela quantidade de letras e limitado a 15 — um limite frouxo faz
12 palavras curtas se espalharem por 17×17, o que num celular vira célula de
22px cercada de vazio.

Três invariantes garantem um grid limpo, sem "palavras" acidentais:

- letras sobrepostas precisam coincidir;
- as células imediatamente antes e depois da palavra ficam vazias;
- toda célula nova precisa ter os dois vizinhos perpendiculares vazios.

### 6. Dificuldade (`src/lib/crossword/difficulty.ts`)

Escolhida ao gerar. Decide só quantas letras começam no grid; o estilo das dicas
continua seguindo o nível de cada palavra.

| Dificuldade | Casas já preenchidas | Palavra pronta | Máximo dado por palavra |
| ----------- | -------------------- | -------------- | ----------------------- |
| Fácil       | ~45%                 | 1              | 60%                     |
| Médio       | ~25%                 | —              | 40%                     |
| Difícil     | nenhuma              | —              | —                       |

- A palavra pronta é a que tem mais cruzamentos — cada cruzamento entrega uma
  letra de outra palavra, então é a mais útil de dar —, desempatando pela mais
  dominada, a que menos precisa de treino.
- O resto é distribuído em rodízio, sempre para a palavra com a menor fração já
  dada, então as letras se espalham pelo grid inteiro. Uma casa conta para as
  duas palavras que a cruzam, e nenhuma passa do máximo: toda palavra, exceto a
  pronta, guarda ao menos uma casa vazia.
- As letras dadas são **travadas**: digitar por cima só avança o cursor, e o
  servidor as regrava em todo progresso que recebe.

Medido em `mise run test:difficulty` sobre 120 layouts: 45,0% e 25,1% das casas
dadas, exatamente uma palavra pronta no fácil e nenhuma palavra sem letra.

### 7. Anticola

Enquanto o crossword está ativo, o gabarito **não é enviado ao navegador**: o
cliente recebe só a máscara de células, a numeração, as dicas e as letras dadas.
As traduções também não: cada uma é pedida ao servidor pelo botão PT. Conferir,
revelar e traduzir são Server Actions, e é o servidor que contabiliza cada letra
revelada, cada erro e cada tradução vista antes de a palavra estar certa — o
cliente não tem como forjar um bom desempenho. A resposta do botão PT é a mesma
com a palavra certa ou errada; do contrário ele viraria um "verificar" grátis.
Ao concluir, respostas e traduções aparecem.

---

## A tela de jogo

O grid é um **container query**: as células e a fonte são dimensionadas como
fração da largura do próprio tabuleiro (`cqw`), não da viewport. Um crossword de
15 colunas cabe num celular de 390px sem scroll horizontal e sem uma única media
query.

| Recurso                 | Como funciona                                                                 |
| ----------------------- | ----------------------------------------------------------------------------- |
| Visual                  | Tema claro de jornal: casas brancas com linha fina, amarelo na casa atual, azul na palavra |
| Tema escuro             | Opcional: sol/lua no cabeçalho (tablet e desktop) ou Perfil → Aparência; vale por aparelho |
| Tradução (PT)           | Botão em cada dica, no banner e na barra do celular — vale também para palavras já preenchidas |
| Letras dadas            | Fundo cinza e tinta mais clara; digitar por cima só avança, apagar não apaga   |
| Barra de dica no mobile | Fixa no rodapé, reposicionada pela `VisualViewport` para ficar **acima do teclado** |
| Verificar               | Pinta em vermelho as letras erradas no próprio grid, não só um contador        |
| Dica                    | `Revelar uma letra` (a do cursor) ou `Revelar a palavra` — sem contador obscuro |
| Digitação               | Pula para a próxima casa **vazia**; ao fechar a palavra, salta para a próxima incompleta |
| Cronômetro              | Persistido em `crosswords.seconds_played`, pausa com a aba em segundo plano    |
| Autosave                | Debounce de 1,2s + flush ao esconder a aba e ao sair da página                 |
| Atalhos                 | Setas, `Enter`/`Espaço` (troca direção), `Tab` (próxima palavra), `Home`       |

As cores têm nome de papel, não de tom (`text-ink-soft`, `bg-word`, `bg-cursor`), e
o tema escuro só redefine essas mesmas variáveis sob `[data-theme="dark"]` em
`globals.css` — nenhum componente tem variante `dark:`. A escolha fica no cookie
`mscw_theme`, que o servidor lê para já renderizar `<html data-theme>` certo: a
página não pisca clara antes de ficar escura, e a barra do navegador acompanha.

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
| Desempenho é contado no servidor             | `revealed_count` / `wrong_checks` / `used_translation` só mudam via Server Action |
| Letras dadas não podem ser apagadas          | `applyGivens()` regrava `crosswords.givens` em todo progresso recebido |
| Nível só muda ao **concluir**                | `applyLearningOutcomes()` roda dentro de `completeCrossword()`         |

Só dá para gerar um novo crossword depois de **concluir** (verificação feita no
servidor, letra por letra) ou **remover** o atual. Abandonar não pontua: remover
um crossword pela metade não promove nem rebaixa nenhuma palavra.

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
> do plano Hobby; as dicas têm orçamento de 40 s dentro disso. `APP_URL` é
> detectada via `VERCEL_URL` quando não definida, mas vale fixar o domínio final
> para os links dos e-mails.

---

## Estrutura

```
src/
├── app/
│   ├── (app)/              # área autenticada e aprovada
│   │   ├── admin/users/    # aprovação de contas
│   │   ├── crossword/      # jogo
│   │   ├── dashboard/      # visão geral
│   │   ├── perfil/         # nome, aparência (tema) e troca de senha
│   │   └── words/          # CRUD + importação
│   ├── actions/            # server actions (auth, words, crossword, admin)
│   ├── login/ signup/      # entrada e cadastro
│   ├── forgot-password/    # pedido de recuperação
│   ├── reset-password/     # criação da nova senha
│   ├── pending/            # sala de espera da aprovação
│   └── globals.css         # tema Tailwind v4
├── components/             # UI (player, tabelas, formulários, nav, controles de tema)
├── db/                     # schema Drizzle + cliente Neon
├── lib/
│   ├── crossword/
│   │   ├── scheduling.ts   # repetição espaçada: caixas, agenda, peso do rodízio
│   │   ├── selector.ts     # amostragem ponderada + cotas por faixa
│   │   ├── generator.ts    # layout criss-cross
│   │   ├── difficulty.ts   # letras dadas por dificuldade
│   │   ├── ai-clues.ts     # dicas em inglês: escrever, filtrar, resolver às cegas, reparar
│   │   ├── clues.ts        # estilo da dica por nível + fallback para a tradução
│   │   └── service.ts      # geração, progresso, revelação, tradução, conclusão
│   ├── password.ts         # hashing scrypt + política de senha
│   ├── session.ts          # sessões em banco + guards de acesso
│   ├── password-reset.ts   # tokens de recuperação
│   ├── email.ts            # envio SMTP
│   ├── openrouter.ts       # cliente da IA (chat com resposta em JSON)
│   ├── theme.ts            # tema claro/escuro: tipos e cookie (theme-server.ts lê no servidor)
│   └── words.ts            # parser, normalização, deduplicação
└── middleware.ts           # guard otimista no Edge (presença do cookie)
```

---

## Ajustes finos (`.env`)

| Variável                  | Padrão              | Efeito                                              |
| ------------------------- | ------------------- | --------------------------------------------------- |
| `CROSSWORD_TARGET_WORDS`  | `12`                | Quantas palavras cada crossword tenta usar          |
| `CROSSWORD_CANDIDATE_POOL`| `40`                | Tamanho do pool sorteado do vocabulário             |
| `OPENROUTER_MODEL`        | `openai/gpt-4o-mini`| Modelo que escreve e confere as dicas               |

Com 12 palavras, cada crossword custa de 5 a 8 chamadas pequenas à IA (escrita
e resolução em lotes paralelos, mais o reparo quando preciso). Sem `OPENROUTER_API_KEY` o app
funciona normalmente, com as dicas na tradução em português.
