# Etapa 2 – Sincronizar anúncios (EscalaPreço)

## Resumo

Para cada conta Mercado Livre conectada, é possível **sincronizar anúncios**: buscar todos os `item_id` via `GET /users/{id}/items/search` (paginado), detalhar cada um com `GET /items/{item_id}`, persistir em `ml_items` e `ml_variations` e exibir progresso e resultado na UI.

---

## Arquivos criados/alterados

### Migrations
- **`supabase/migrations/002_ml_items_variations_jobs.sql`** – Tabelas `ml_items`, `ml_variations`, `ml_jobs`, `ml_job_logs` + RLS e índices.

### Lib
- **`src/lib/mercadolivre/refresh.ts`** – Refresh do access_token e `getValidAccessToken()`.
- **`src/lib/mercadolivre/client.ts`** – Cliente HTTP ML: `fetchAllItemIds`, `fetchItemDetail`, `runWithConcurrency` (timeout, retry, 429 backoff).
- **`src/lib/mercadolivre/sync-worker.ts`** – Worker: `runSyncJob(jobId, accountId)` (usa token válido, lista IDs, detalha com concorrência 5, upsert items/variations, atualiza job e logs).
- **`src/lib/jobs.ts`** – `getActiveJob`, `createJob`, `updateJob`, `addJobLog`, `getJobWithLogs`.
- **`src/lib/supabase/service.ts`** – `createServiceClient()` (service role) para o worker.

### API
- **`src/app/api/mercadolivre/[accountId]/sync/route.ts`** – `POST` – Cria job (ou retorna ativo), dispara worker, retorna `job_id`.
- **`src/app/api/mercadolivre/[accountId]/items/route.ts`** – `GET` – Lista itens sincronizados (`?search=&page=`).
- **`src/app/api/jobs/[jobId]/route.ts`** – `GET` – Status do job + últimos logs.
- **`src/app/api/mercadolivre/sync/route.ts`** – Mantido: `POST` com body `{ account_id }` (mesma lógica do novo endpoint).

### UI
- **`src/app/app/mercadolivre/page.tsx`** – Botão “Sincronizar anúncios” (POST `/api/mercadolivre/{accountId}/sync`), progresso (total/processed/ok/errors + status), botão “Ver itens” e tabela de itens (item_id, title, status, price, has_variations, updated_at).

### Config
- **`.env.example`** – Adicionado `SUPABASE_SERVICE_ROLE_KEY` (obrigatório para o worker).

---

## Como configurar e rodar

1. **Variáveis de ambiente**  
   Copie `.env.example` para `.env` e preencha:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (chave “service_role” do Supabase; só no servidor)
   - `MERCADOLIVRE_CLIENT_ID`, `MERCADOLIVRE_CLIENT_SECRET`, `MERCADOLIVRE_REDIRECT_URI`
   - `NEXT_PUBLIC_APP_URL` (ex.: `http://localhost:3000`)

2. **Migrações**  
   Aplique as migrations no Supabase (Dashboard SQL ou CLI):
   - `001_ml_accounts_tokens.sql` (Etapa 1)
   - `002_ml_items_variations_jobs.sql`

3. **Rodar o app**
   ```bash
   npm install
   npm run dev
   ```
   Acesse `http://localhost:3000`.

---

## Como testar pelo navegador

1. **Conectar conta (Etapa 1)**  
   - Faça login.  
   - Vá em **Mercado Livre** e clique em **Conectar conta Mercado Livre**.  
   - Autorize no ML e volte; a conta deve aparecer na lista.

2. **Sincronizar**  
   - Clique em **Sincronizar anúncios** na conta.  
   - Deve aparecer o progresso: status (queued → running) e total/processados/ok/erros.  
   - Ao terminar, status passa a success/partial/failed.

3. **Ver itens**  
   - Clique em **Ver itens**.  
   - A tabela deve listar itens sincronizados (item_id, título, status, preço, variações, updated_at).  
   - Se ainda não tiver sincronizado, a mensagem será “Nenhum item sincronizado…”.

4. **Banco**  
   - No Supabase (Table Editor), confira `ml_jobs`, `ml_job_logs`, `ml_items`, `ml_variations` após uma sync.

---

## Observações sobre limites e concorrência

- **Rate limit (429)**  
  O client ML (`src/lib/mercadolivre/client.ts`) trata 429: espera 5 s e tenta de novo na mesma requisição. Há também retry (até 2 tentativas) em erros de rede/timeout.

- **Concorrência**  
  A busca de detalhes (`/items/{item_id}`) usa no máximo **5 requisições simultâneas** (`CONCURRENCY = 5` em `sync-worker.ts`). Para reduzir risco de 429 em contas com muitos anúncios, diminua esse valor (ex.: 3). Para acelerar em contas pequenas, pode subir (ex.: 8); evite valores altos para não estourar limite do ML.

- **Timeout**  
  Cada request ao ML tem timeout de 15 s (`DEFAULT_TIMEOUT_MS` em `client.ts`). Ajuste se precisar.

- **Worker**  
  O worker roda no processo Node (setImmediate após o POST). Em VPS, se o processo for reiniciado durante a sync, o job pode ficar “running” sem conclusão; você pode marcar como failed por timeout em uma etapa futura (cron) ou reexecutar sync (novo job).

- **Token**  
  Se o access_token expirar durante a sync, o worker usa `getValidAccessToken` (refresh). É necessário `MERCADOLIVRE_CLIENT_ID` e `MERCADOLIVRE_CLIENT_SECRET` no `.env`.

- **Duplicidade**  
  Se já existir job `sync_items` em status `queued` ou `running` para a mesma conta, o `POST .../sync` não cria outro job e retorna o `job_id` do job ativo.
