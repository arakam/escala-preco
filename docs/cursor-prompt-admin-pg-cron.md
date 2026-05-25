# Prompt para Cursor — Área administrativa `pg_cron` (Escala Preço)

Copie **todo o bloco abaixo** (da linha `--- INÍCIO DO PROMPT ---` até `--- FIM DO PROMPT ---`) e cole em um chat novo no **projeto administrativo** do Escala Preço.

---

## INÍCIO DO PROMPT

Você está no **projeto administrativo** do Escala Preço (separado do app principal `escalapreco`). Implemente uma área de administração para **agendamentos `pg_cron` no Supabase** do produto, com foco inicial na limpeza de dados de webhook.

### Contexto do produto principal

- App principal: sincronização Mercado Livre, webhooks em `/wh/api`, retenção de logs.
- Banco Supabase (projeto **escala_preco**, ref `awslxmnzkisozyvietfn`, região us-west-2).
- Já existe no banco a função SQL:

```sql
public.prune_ml_webhook_data(
  p_notifications_days INT DEFAULT 7,
  p_alerts_days INT DEFAULT 30,
  p_batch_size INT DEFAULT 5000
) RETURNS JSONB
```

- Ela remove em lotes:
  - `ml_webhook_notifications` mais antigos que N dias (padrão 7)
  - `ml_promotion_webhook_alerts` mais antigos que N dias (padrão 30)
- Migration de referência no repo principal: `043_ml_webhook_data_retention.sql`
- O app principal também expõe `GET|POST /api/cron/prune-webhook-data` (Bearer `CRON_SECRET`), mas **neste projeto admin a fonte da verdade do agendamento deve ser `pg_cron` no Supabase**, não cron na VPS.

### Objetivo

Criar módulo **“Agendamentos (pg_cron)”** no painel admin para:

1. Ver se a extensão `pg_cron` está habilitada.
2. Listar jobs existentes (`cron.job`).
3. Criar/editar/pausar/remover o job de purge de webhooks.
4. Executar **manualmente** `prune_ml_webhook_data()` (com parâmetros opcionais na UI).
5. Ver histórico recente de execuções (`cron.job_run_details`) e métricas (contagem de linhas nas tabelas).
6. Exibir avisos claros de fuso (cron do Postgres em **UTC**).

### Requisitos de segurança (obrigatório)

- **Nunca** expor `SUPABASE_SERVICE_ROLE_KEY` no client.
- Todas as operações em `cron.*` e `SELECT prune_ml_webhook_data()` apenas em **Route Handlers / Server Actions** com service role.
- Acesso restrito a usuários **admin** do painel (ex.: `app_metadata.role === 'admin'` ou tabela `admin_users` — siga o padrão já existente neste projeto admin; se não existir, implemente gate mínimo documentado).
- Validar inputs (dias 1–90, batch 100–50000, expressão cron com biblioteca ou regex segura).
- Logar ações admin (quem rodou purge manual, quem alterou job).

### Habilitar pg_cron (se necessário)

Verificar e, se faltar, aplicar migration no Supabase (via MCP ou CLI):

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
-- Em alguns projetos Supabase o schema é `pg_catalog` ou `cron`; consulte docs atuais do Supabase para pg_cron antes de fixar o schema.
GRANT USAGE ON SCHEMA cron TO postgres;
```

Consulte a documentação atual do Supabase sobre **pg_cron** (Dashboard → Database → Extensions) e adapte o schema (`cron` vs `extensions`) ao que o projeto retornar em:

```sql
SELECT extname, nspname FROM pg_extension e JOIN pg_namespace n ON e.extnamespace = n.oid WHERE extname = 'pg_cron';
```

### Job padrão recomendado

- **Nome:** `prune_ml_webhook_data_daily`
- **Schedule (UTC):** `0 7 * * *` (≈ 04:00 America/Sao_Paulo quando UTC-3)
- **Comando:**

```sql
SELECT public.prune_ml_webhook_data(7, 30, 5000);
```

APIs internas devem usar `cron.schedule` / `cron.unschedule` / update em `cron.job` conforme documentação Postgres pg_cron. Exemplos úteis:

```sql
-- Listar jobs
SELECT jobid, jobname, schedule, command, active, database, username FROM cron.job ORDER BY jobid;

-- Histórico (últimas 50)
SELECT jobid, runid, job_pid, status, return_message, start_time, end_time
FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 50;

-- Métricas rápidas
SELECT
  (SELECT COUNT(*)::bigint FROM ml_webhook_notifications) AS webhook_rows,
  (SELECT COUNT(*)::bigint FROM ml_promotion_webhook_alerts) AS alert_rows,
  (SELECT MIN(created_at) FROM ml_webhook_notifications) AS oldest_webhook,
  (SELECT MIN(created_at) FROM ml_promotion_webhook_alerts) AS oldest_alert;
```

### UI sugerida (página única ou subseção “Infraestrutura”)

**Card 1 — Status**
- Extensão pg_cron: ativa / inativa
- Quantidade de jobs ativos
- Última execução do job de purge (status, duração, `return_message` resumido)

**Card 2 — Job: Limpeza de webhooks**
- Toggle ativo/inativo
- Campo cron schedule (com legenda UTC + equivalente BRT)
- Retenção notificações (dias, default 7)
- Retenção alertas promo (dias, default 30)
- Batch size (default 5000)
- Botões: Salvar agendamento | Executar agora | Testar (dry-run opcional: só `SELECT` contagens antes/depois sem delete, se implementar)

**Card 3 — Histórico**
- Tabela paginada `cron.job_run_details` filtrada pelo job de purge
- Badge sucesso/falha

**Card 4 — Métricas das tabelas**
- Linhas atuais em `ml_webhook_notifications` e `ml_promotion_webhook_alerts`
- Linhas mais antigas que 7d / 30d (pré-visualização do que o próximo purge apagaria)

### Rotas API sugeridas (adaptar ao framework do projeto admin)

| Método | Rota | Função |
|--------|------|--------|
| GET | `/api/admin/pg-cron/status` | extensão, jobs, métricas, último run |
| GET | `/api/admin/pg-cron/jobs` | lista `cron.job` |
| POST | `/api/admin/pg-cron/jobs/webhook-prune` | criar ou atualizar job padrão |
| PATCH | `/api/admin/pg-cron/jobs/[jobId]` | alterar schedule/active/command |
| DELETE | `/api/admin/pg-cron/jobs/[jobId]` | remover (`cron.unschedule`) |
| POST | `/api/admin/pg-cron/run/webhook-prune` | executar `prune_ml_webhook_data` manualmente |

Respostas JSON tipadas; erros Postgres legíveis na UI.

### Implementação técnica

1. Explorar a estrutura atual do projeto admin (auth, layout, padrão de páginas, Supabase server client).
2. Criar `lib/supabase/admin-service.ts` (service role só no servidor) se não existir.
3. Criar `lib/pg-cron/` com funções: `getPgCronStatus`, `listJobs`, `upsertWebhookPruneJob`, `unscheduleJob`, `runWebhookPrune`, `getJobRunHistory`, `getWebhookTableMetrics`.
4. Usar SQL parametrizado via `supabase.rpc` ou query raw com service role; **não** inventar tabelas novas se `cron.job` bastar.
5. Tratar projeto Supabase via env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, opcional `SUPABASE_PROJECT_REF=awslxmnzkisozyvietfn`.
6. Adicionar item no menu lateral: **Agendamentos** ou **Infraestrutura → pg_cron**.
7. Documentar no README do projeto admin:
   - como habilitar extensão no Dashboard Supabase
   - que horários são UTC
   - que o app principal não depende mais de cron na VPS para este purge

### Edge cases

- Se `pg_cron` não estiver disponível no plano, mostrar banner com link para docs Supabase e fallback “usar endpoint `/api/cron/prune-webhook-data` no app principal”.
- Se já existir job com mesmo `jobname`, fazer upsert (unschedule + schedule) em vez de duplicar.
- Execução manual pode demorar; usar loading state e timeout generoso no servidor.
- Não quebrar se `cron.job_run_details` estiver vazio.

### Critérios de aceite

- [ ] Apenas admin autenticado acessa a página e as APIs.
- [ ] Consigo ver jobs e histórico sem ir ao SQL Editor do Supabase.
- [ ] Consigo criar/alterar o job diário de `prune_ml_webhook_data` pela UI.
- [ ] Consigo rodar purge manual e ver JSON de retorno (`notifications_deleted`, `alerts_deleted`, cutoffs).
- [ ] Métricas de linhas das tabelas visíveis antes e depois do purge manual.
- [ ] README atualizado com setup pg_cron + variáveis de ambiente.

### O que NÃO fazer

- Não duplicar lógica de purge em TypeScript se a função SQL já existe — chame `SELECT public.prune_ml_webhook_data(...)`.
- Não commitar secrets.
- Não expor schema `cron` via RLS ao cliente anon.

Implemente de ponta a ponta, siga o design system já usado no projeto admin, e ao final liste arquivos criados/alterados e passos para testar em produção.

--- FIM DO PROMPT ---
