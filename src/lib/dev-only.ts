/** Rotas/páginas de diagnóstico — apenas `npm run dev`. */
export function isDevEnvironment(): boolean {
  return process.env.NODE_ENV === "development";
}
