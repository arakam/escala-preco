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

export function AdmintyIconMegaphone() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <path
        {...stroke()}
        d="M4 10.5v3a1 1 0 0 0 1.2.98L9 13v5a1 1 0 0 0 1 .9h1l3-2.5V9.6L11 7H8a1 1 0 0 0-.8.4L5.2 9.52A1 1 0 0 0 4 10.5z"
      />
      <path {...stroke()} d="M15.5 9.5a4 4 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
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

export function AdmintyIconPromo() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <path {...stroke()} d="M19 5 5 19" />
      <circle {...stroke()} cx="6.5" cy="6.5" r="2.5" />
      <circle {...stroke()} cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}

export function AdmintyIconSettings() {
  return (
    <svg viewBox="0 0 24 24" className={iconBase} aria-hidden="true">
      <circle {...stroke()} cx="12" cy="12" r="3" />
      <path
        {...stroke()}
        d="M12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M17.4 5.8l1.4-1.4"
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
