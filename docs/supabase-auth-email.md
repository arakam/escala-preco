# Email de recuperação de senha (Supabase)

## Problema

O link padrão do Supabase (`{{ .ConfirmationURL }}`) usa token `pkce_...` e passa por `*.supabase.co/auth/v1/verify`. Esse fluxo **exige o mesmo navegador** em que você clicou em "Enviar link". Se você abrir o email no app do Gmail, Outlook ou em outro dispositivo, aparece `otp_expired` (link inválido ou expirado).

## Solução (obrigatório no painel Supabase)

1. Abra o projeto em [Supabase Dashboard](https://supabase.com/dashboard) → **Authentication** → **Email Templates** → **Reset password**.

2. Substitua o link do corpo do email. **Remova** `{{ .ConfirmationURL }}` e use:

```html
<a href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password">
  Redefinir senha
</a>
```

3. Em **Authentication** → **URL Configuration**:
   - **Site URL**: `https://app.escalapreco.com.br`
   - **Redirect URLs** (adicione todas):
     - `https://app.escalapreco.com.br/auth/callback`
     - `https://app.escalapreco.com.br/api/auth/confirm`
     - `https://app.escalapreco.com.br/auth/reset-password`
     - `http://localhost:3001/auth/callback` (desenvolvimento)
     - `http://localhost:3001/api/auth/confirm`

4. Salve o template e **envie um novo email** de recuperação (links antigos continuam inválidos).

## Variáveis de ambiente

`NEXT_PUBLIC_APP_URL` em produção deve ser exatamente `https://app.escalapreco.com.br` (sem barra no final).

## Como testar

1. No Chrome/Edge no computador, abra `https://app.escalapreco.com.br/auth/forgot-password`.
2. Solicite o link e abra o email **no mesmo navegador** (copie o link se o app de email abrir outro navegador).
3. O link do email deve começar com `https://app.escalapreco.com.br/api/auth/confirm?token_hash=...` (não `supabase.co`).
