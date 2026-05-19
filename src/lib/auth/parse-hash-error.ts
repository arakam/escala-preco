/** Erros do Supabase Auth vindos no fragmento (#error_code=...) após redirect do /auth/v1/verify. */
export function parseAuthHashError(): string | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash.replace(/^#/, "");
  if (!h.includes("error=")) return null;
  const p = new URLSearchParams(h);
  const code = p.get("error_code");
  const desc = p.get("error_description");
  if (code === "otp_expired") {
    return "Este link expirou ou não pode ser usado neste navegador. Links do tipo supabase.co/auth/v1/verify exigem abrir no mesmo navegador em que você pediu a recuperação. Ajuste o template de email no Supabase (docs/supabase-auth-email.md) e solicite um novo link.";
  }
  return desc?.replace(/\+/g, " ") || "Não foi possível validar o link.";
}
