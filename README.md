# EscalaPreço – ETAPA 1 (MVP)

Autenticação do micro-SaaS + conexão OAuth com Mercado Livre, contas conectadas e botão "Sincronizar anúncios" (placeholder).

## Stack

- **Next.js 14** (App Router) + TypeScript
- **Supabase**: Auth (email/senha) + Postgres (tabelas `ml_accounts`, `ml_tokens`)
- **Tailwind CSS** para UI

## Configuração

### 1. Variáveis de ambiente

Copie o exemplo e preencha:

```bash
cp .env.example .env
```

Edite `.env`:

- **Supabase**: crie um projeto em [supabase.com](https://supabase.com), em Settings > API pegue `Project URL` e `anon public` key.
- **Mercado Livre**: em [Developers Mercado Livre](https://developers.mercadolivre.com.br/devcenter/create-app) crie um app e defina uma **Redirect URI** (ex: `http://localhost:3000/api/mercadolivre/callback` para desenvolvimento).
- **NEXT_PUBLIC_APP_URL**: em local use `http://localhost:3000`; em produção use a URL do app.

O `client_secret` do ML **não** deve ser exposto no client; fica apenas no servidor (`.env`).

### 2. Banco (Supabase)

No Supabase Dashboard > SQL Editor, rode o conteúdo do arquivo:

`supabase/migrations/001_ml_accounts_tokens.sql`

Isso cria as tabelas `ml_accounts` e `ml_tokens` com RLS.

### 3. Rodar local

```bash
npm install
npm run dev
```

Acesse: **http://localhost:3000**

## Rotas

| Rota | Descrição |
|------|-----------|
| `/` | Landing com links Entrar / Cadastrar |
| `/auth/login` | Login (email/senha) |
| `/auth/register` | Cadastro |
| `/app` | Área logada (protegida) |
| `/app/mercadolivre` | Integração ML: conectar conta e sincronizar (placeholder) |

## APIs (backend)

- **GET /api/mercadolivre/auth** – Redireciona para autorização ML (só logado).
- **GET /api/mercadolivre/callback** – Callback OAuth: troca `code` por tokens, chama `/users/me`, persiste conta e tokens.
- **GET /api/mercadolivre/accounts** – Lista contas ML do usuário logado (JSON).
- **POST /api/mercadolivre/sync** – Placeholder: body `{ "account_id": "uuid" }`, responde sucesso sem sincronizar ainda.

## Como testar no navegador

1. **Cadastro e login**
   - Abra `http://localhost:3000` → Cadastrar.
   - Preencha email e senha (mín. 6 caracteres) → Cadastrar.
   - Você deve ser redirecionado para `/app`.

2. **Proteção de rotas**
   - Sem estar logado, acesse `http://localhost:3000/app` → deve redirecionar para `/auth/login?redirect=/app`.

3. **Conectar Mercado Livre**
   - Logado, vá em **Mercado Livre** no menu ou em `http://localhost:3000/app/mercadolivre`.
   - Clique em **Conectar conta Mercado Livre**.
   - Será redirecionado para o ML; autorize o app.
   - O callback salva os tokens e redireciona de volta para `/app/mercadolivre?connected=1`.
   - A tela deve mostrar algo como: **Conta conectada: {nickname}** e o botão **Sincronizar anúncios**.

4. **Sincronizar (placeholder)**
   - Clique em **Sincronizar anúncios** → deve aparecer um alert de confirmação (ação real em etapa futura).

## Estrutura de dados

- **ml_accounts**: `id`, `user_id` (Supabase Auth), `ml_user_id`, `ml_nickname`, `site_id`, `created_at`. Unique `(user_id, ml_user_id)`.
- **ml_tokens**: `account_id`, `access_token`, `refresh_token`, `expires_at`, `created_at`, `updated_at`. Um registro por conta.

Refresh de token: helper stub em `src/lib/mercadolivre/refresh.ts` (não implementado nesta etapa).
