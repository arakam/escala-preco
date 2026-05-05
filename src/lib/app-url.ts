/** Base pública do app (sem barra final). Prioriza env para links em emails baterem no domínio certo. */
export function getAppOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "").trim();
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3001";
}
