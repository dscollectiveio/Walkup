/**
 * The Walkup mark and lockup, from the Brand Logo Package v1.0 (Oct 2026).
 *
 * Three owners, one building: a gold coin with a keyhole on top, a cream and
 * a brick circle beneath it. Thin separators in the colour of whatever sits
 * behind the mark keep the circles distinct, so every variant takes the
 * ground it sits on. Geometry is on the package's 64-unit tile grid (tile =
 * navy square, 22% corner radius).
 *
 * Variants (never build new ones — see the package's "Please don't" page):
 *   icon          navy tile, full-colour mark — app icon, favicon, avatars,
 *                 and anywhere a light ground wants a tile
 *   color         full-colour mark on a light ground (pass `ground`)
 *   on-navy       full-colour mark on navy, no tile — dark backgrounds
 *   mono-navy     one colour, navy
 *   mono-reversed one colour, cream on navy
 *
 * The wordmark is Outfit Medium, −3% tracking, Title case — `.wordmark` in
 * globals.css. Always the same face, whatever the app theme.
 */

export const BRAND = {
  navy: "#1B2A41",
  gold: "#D9A441",
  cream: "#F5EFE3",
  brick: "#A3432F",
  white: "#FFFFFF",
} as const;

type MarkVariant = "icon" | "color" | "on-navy" | "mono-navy" | "mono-reversed";

/** The art alone, in tile coordinates. */
function Art({
  ground,
  coin,
  left,
  right,
  keyhole,
}: {
  ground: string;
  coin: string;
  left: string;
  right: string;
  keyhole: string;
}) {
  return (
    <>
      <circle cx="24" cy="39" r="12" fill={left} />
      <circle cx="40" cy="39" r="14" fill={ground} />
      <circle cx="40" cy="39" r="12" fill={right} />
      <circle cx="32" cy="24" r="15" fill={ground} />
      <circle cx="32" cy="24" r="13" fill={coin} />
      <circle cx="32" cy="20.9" r="3.5" fill={keyhole} />
      <path d="M30.5 22 L28.6 32 H35.4 L33.5 22 Z" fill={keyhole} />
    </>
  );
}

export function Mark({
  variant = "icon",
  size = 32,
  ground = BRAND.white,
  className,
}: {
  variant?: MarkVariant;
  /** Height in px; the artwork is square. */
  size?: number;
  /** The colour behind the mark, for `color`; separators and the keyhole take it. */
  ground?: string;
  className?: string;
}) {
  const common = {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    role: "img" as const,
    "aria-label": "Walkup",
    className,
  };

  if (variant === "icon") {
    return (
      <svg {...common} viewBox="0 0 64 64">
        <rect width="64" height="64" rx="14" fill={BRAND.navy} />
        <Art ground={BRAND.navy} coin={BRAND.gold} left={BRAND.cream} right={BRAND.brick} keyhole={BRAND.navy} />
      </svg>
    );
  }
  const box = "10 9 44 44";
  if (variant === "on-navy") {
    return (
      <svg {...common} viewBox={box}>
        <Art ground={BRAND.navy} coin={BRAND.gold} left={BRAND.cream} right={BRAND.brick} keyhole={BRAND.navy} />
      </svg>
    );
  }
  if (variant === "mono-navy") {
    return (
      <svg {...common} viewBox={box}>
        <Art ground={BRAND.white} coin={BRAND.navy} left={BRAND.navy} right={BRAND.navy} keyhole={BRAND.white} />
      </svg>
    );
  }
  if (variant === "mono-reversed") {
    return (
      <svg {...common} viewBox={box}>
        <Art ground={BRAND.navy} coin={BRAND.cream} left={BRAND.cream} right={BRAND.cream} keyhole={BRAND.navy} />
      </svg>
    );
  }
  return (
    <svg {...common} viewBox={box}>
      <Art ground={ground} coin={BRAND.gold} left={BRAND.cream} right={BRAND.brick} keyhole={ground} />
    </svg>
  );
}

/**
 * Mark + wordmark, horizontal. On a light ground the mark sits on its navy
 * tile with a navy wordmark; on dark the tile drops away and the wordmark is
 * cream. `onDark` forces the dark form (a fixed navy band); otherwise the
 * lockup follows the app theme.
 */
export function Lockup({
  association,
  onDark = false,
  size = 30,
  className,
}: {
  association?: string | null;
  /** Always the dark-background form, regardless of the app theme. */
  onDark?: boolean;
  size?: number;
  className?: string;
}) {
  const text = (cls: string) => (
    <span className="flex flex-col leading-none">
      <span className={`wordmark ${cls}`} style={{ fontSize: Math.round(size * 0.72) }}>
        Walkup
      </span>
      {association ? (
        <span className={`mt-1 text-[11px] font-normal ${onDark ? "text-white/60" : "text-mute"}`}>{association}</span>
      ) : null}
    </span>
  );

  if (onDark) {
    return (
      <span className={`inline-flex items-center gap-[10px] ${className ?? ""}`}>
        <Mark variant="on-navy" size={size} />
        {text("text-[#F5EFE3]")}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-[10px] ${className ?? ""}`}>
      <span className="brand-on-light inline-flex items-center gap-[10px]">
        <Mark variant="icon" size={size} />
        {text("text-[#1B2A41]")}
      </span>
      <span className="brand-on-dark items-center gap-[10px]">
        <Mark variant="on-navy" size={size} />
        {text("text-[#F5EFE3]")}
      </span>
    </span>
  );
}
