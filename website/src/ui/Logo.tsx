/** Compact nm monogram; inherits the foreground on both paper and dark surfaces. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 68 40"
      width={size * 1.7}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M4 33V7M4 18C4 3 24 3 24 18V27C24 37 36 37 36 27V17C36 3 50 3 50 17V33M50 17C50 3 64 3 64 17V33"
        stroke="currentColor"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="36" cy="21" r="3.25" fill="var(--logo-accent, #b7452c)" />
    </svg>
  );
}

export function Logo({ size = 32, subtitle }: { size?: number; subtitle?: string }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo__text">
        <span className="logo__name">NeuroMove</span>
        {subtitle && <span className="logo__sub">{subtitle}</span>}
      </span>
    </span>
  );
}
