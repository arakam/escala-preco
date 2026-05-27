/**
 * Ícones em traço (estilo Feather / admin tipo Adminty).
 * Usados na sidebar do shell Adminty.
 */
const iconBase = "h-[17px] w-[17px] shrink-0 text-white/75";

function stroke() {
  return {
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function AdmintyIconHome() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <path {...stroke()} d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5a.5.5 0 0 1-.5-.5V14.5h-4V20.5a.5.5 0 0 1-.5.5H5a1 1 0 0 1-1-1v-9.5z" />
    </svg>
  );
}

function strokeBold() {
  return {
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

/** Megafone (Lucide megaphone) — menu Anúncios. */
export function AdmintyIconMegaphone() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <path
        {...strokeBold()}
        d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
      />
      <path
        {...strokeBold()}
        d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"
      />
      <path {...strokeBold()} d="M8 6v8" />
    </svg>
  );
}

export function AdmintyIconBoxes() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <rect {...stroke()} x="3" y="3" width="7" height="7" rx="1" />
      <rect {...stroke()} x="14" y="3" width="7" height="7" rx="1" />
      <rect {...stroke()} x="3" y="14" width="7" height="7" rx="1" />
      <rect {...stroke()} x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function AdmintyIconTag() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <path {...stroke()} d="M3 5a2 2 0 0 1 2-2h4.2L20 13.8a2 2 0 0 1 0 2.8l-2.8 2.8a2 2 0 0 1-2.8 0L3 9.2V5z" />
      <circle cx="7.5" cy="6.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function AdmintyIconCurrency() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <path {...stroke()} d="M12 2v20M16 6H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H7" />
    </svg>
  );
}

/** Carteira / recebimento — menu dev Recebimento. */
export function AdmintyIconWallet() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <path {...stroke()} d="M3 7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1H5a2 2 0 0 1-2-2z" />
      <path {...stroke()} d="M3 10h18v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7z" />
      <path {...stroke()} d="M16 14h2" />
    </svg>
  );
}

/** Carrinho de compras (estilo Feather shopping-cart) — menu Vendas. */
export function AdmintyIconShoppingCart() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <circle cx="9" cy="21" r="1" fill="currentColor" />
      <circle cx="20" cy="21" r="1" fill="currentColor" />
      <path
        {...stroke()}
        d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"
      />
    </svg>
  );
}

export function AdmintyIconPromo() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <path {...stroke()} d="M19 5 5 19" />
      <circle {...stroke()} cx="6.5" cy="6.5" r="2.5" />
      <circle {...stroke()} cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}

/** Engrenagem (estilo Feather cog) — menu Configuração. */
export function AdmintyIconSettings() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <circle {...stroke()} cx="12" cy="12" r="3" />
      <path
        {...stroke()}
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
      />
    </svg>
  );
}

export function AdmintyIconHistory() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <path {...stroke()} d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path {...stroke()} d="M3 4v4h4M12 7v5l3 2" />
    </svg>
  );
}

export function AdmintyIconPlug() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <path {...stroke()} d="M8 2v6M16 2v6M7 8h10v4a5 5 0 0 1-10 0V8zM12 17v5" />
    </svg>
  );
}

export function AdmintyIconLogout() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <path {...stroke()} d="M10 17H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h5M15 7l5 5-5 5M20 12H9" />
    </svg>
  );
}

export function AdmintyIconMenu() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-white" aria-hidden="true">
      <path {...stroke()} d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
