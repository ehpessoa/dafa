# 💻 App de treinamento (React + Supabase)

![Painel do aluno](img/01-aluno-dashboard.png)

## Stack
React 18 · TypeScript · Vite · React Router · Recharts · Mermaid (diagramas, carga sob demanda) · Supabase (Auth Google, Postgres, RLS).

## Perfis e telas

| Perfil | Telas |
|---|---|
| 🧑‍🎓 **Aluno** | Painel (progresso, notas, feedbacks, entregáveis) · Trilha & dependências · Calendário 30 dias · Sessão (5 abas) · Biblioteca |
| 🎓 **Tutor** | Visão da turma (gráficos) · Fila de avaliação · Avaliar (nota 0–10, feedback, aprovar/ajustes) · Alunos · Detalhe do aluno (mapa de progresso) · pré-visualiza qualquer sessão |

| Trilha & dependências | Exercícios com histórico e refação |
|---|---|
| ![Trilha](img/02-trilha.png) | ![Exercícios](img/04-sessao-exercicios.png) |

| Visão do tutor | Avaliação | Mobile |
|---|---|---|
| ![Tutor](img/12-tutor-home.png) | ![Avaliar](img/14-tutor-avaliar.png) | ![Mobile](img/11-mobile-sessao.png) |

## Modelo de dados do app

```mermaid
erDiagram
  PROFILES ||--o{ SUBMISSIONS : envia
  PROFILES ||--o{ REVIEWS : "avalia (tutor)"
  LEVELS ||--|{ SESSIONS : contém
  SESSIONS ||--o{ SESSION_DEPENDENCIES : "depende de"
  SESSIONS ||--|{ EXERCISES : tem
  SESSIONS ||--o{ SESSION_TEMPLATES : usa
  SESSIONS ||--o{ SESSION_RESOURCES : usa
  TEMPLATES ||--o{ SESSION_TEMPLATES : ""
  RESOURCES ||--o{ SESSION_RESOURCES : ""
  EXERCISES ||--o{ SUBMISSIONS : recebe
  SUBMISSIONS ||--o| REVIEWS : "é avaliada"
  SESSIONS ||--o| WEEKLY_DELIVERABLES : "fecha semana"
  PROFILES { uuid id PK
    text email
    text role "student | teacher" }
  SUBMISSIONS { uuid id PK
    text exercise_id FK
    uuid student_id FK
    int attempt
    text status "submitted | approved | revision_requested" }
  REVIEWS { uuid id PK
    uuid submission_id FK
    numeric score
    text verdict
    text feedback }
```

## Regras e segurança (no banco)

| Regra | Implementação |
|---|---|
| Só autenticados leem o currículo; só tutor edita | RLS por tabela |
| Aluno só vê as próprias entregas/avaliações; tutor vê todas | RLS em `submissions`, `reviews`, `profiles` |
| Sessão bloqueada não aceita entrega | trigger `before_submission_insert` + `session_unlocked()` |
| Tentativa numerada no servidor; status inicial forçado | mesmo trigger (o aluno não forja `approved`) |
| Só tutor avalia; avaliação atualiza o status da entrega | triggers em `reviews` |
| Aluno não vira tutor | sem `UPDATE` em `profiles` para alunos; tutor via allowlist |
| `anon` sem acesso | `revoke all` + RLS |

## Rodar localmente

```bash
cd web
cp .env.example .env.local     # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev                    # http://localhost:5173
npm run build                  # typecheck + build de produção
```

Deploy estático (Vercel/Netlify/Cloudflare Pages): `web/vercel.json` e `web/public/_redirects` já fazem o fallback de SPA. Cadastre a URL final em *Supabase → Authentication → URL Configuration*.

## Como foi testado

| Teste | Comando | Cobre |
|---|---|---|
| SQL | `npm run validate:sql` | 3 migrations num Postgres embutido (PGlite) |
| Regras/RLS | `node scripts/test-rls.mjs` | bloqueio por dependência, tentativas, avaliação, isolamento entre alunos, anon |
| UI (E2E) | `node scripts/e2e-mock.mjs` | Playwright com API Supabase **simulada**: aluno, tutor, bloqueio, refazer, mobile, redirecionamento |

> O login Google real e a conexão a um projeto Supabase real dependem das suas credenciais e **não foram exercitados** aqui.
