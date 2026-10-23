/**
 * The Walkup mark ("Coin on top") and lockup, from the Brand Logo Package
 * v1.0 (Oct 2026). Three owners, one building: a gold coin with a keyhole on
 * top of a cream and a brick circle. The navy strokes are the separators;
 * they always take the colour of whatever sits behind the mark.
 *
 * <WalkupMark variant="tile" /> is the app icon: navy square, 22% radius.
 * <WalkupMark variant="bare" background="#fff" /> drops the tile; the
 * separators and keyhole become `background`.
 *
 * `animate` plays a short entrance when the mark first appears (coin drops onto the two circles, keyhole fades in).
 * It is the same mark, drawn the same, only moving once; reduced motion skips it.
 *
 * Never build other variants (the package's "Please don't" page).
 */

export const BRAND = {
  navy: "#1B2A41",
  gold: "#D9A441",
  cream: "#F5EFE3",
  brick: "#A3432F",
} as const;

export function WalkupMark({
  size = 32,
  variant = "tile",
  background = BRAND.navy,
  className,
  title = "Walkup",
  animate = false,
}: {
  animate?: boolean;
  size?: number;
  variant?: "tile" | "bare";
  /** For `bare`: the colour behind the mark. Separators and keyhole take it. */
  background?: string;
  className?: string;
  /** Accessible name; pass "" when a visible "Walkup" sits next to it. */
  title?: string;
}) {
  const ink = variant === "tile" ? BRAND.navy : background;
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      {variant === "tile" ? <rect width="64" height="64" rx="14" fill={BRAND.navy} /> : null}
      <circle cx="24" cy="39" r="13" fill={BRAND.cream} stroke={ink} strokeWidth="2" className={animate ? "mark-a1" : undefined} />
      <circle cx="40" cy="39" r="13" fill={BRAND.brick} stroke={ink} strokeWidth="2" className={animate ? "mark-a2" : undefined} />
      <circle cx="32" cy="24" r="14" fill={BRAND.gold} stroke={ink} strokeWidth="2" className={animate ? "mark-a3" : undefined} />
      <g className={animate ? "mark-a4" : undefined}>
        <circle cx="32" cy="21" r="3.6" fill={ink} />
        <path d="M30.1 23.5H33.9L35.4 32H28.6Z" fill={ink} />
      </g>
    </svg>
  );
}

/**
 * Mark + "Walkup" in Outfit Medium, −3% tracking. The gap is 22% of the mark
 * height and the word 80% of it. Light grounds: tile + navy word. Dark
 * grounds: bare mark + cream word. `onDark` forces the dark form (a fixed
 * navy band); otherwise the lockup follows the app theme.
 */
export function Lockup({
  association,
  onDark = false,
  size = 30,
  className,
  animate = false,
}: {
  /** Plays the mark's entrance once, on load. */
  animate?: boolean;
  association?: string | null;
  onDark?: boolean;
  /** Mark height in px. */
  size?: number;
  className?: string;
}) {
  const gap = Math.round(size * 0.22);
  const word = (color: string) => (
    <span className="flex flex-col leading-none">
      <span className="wordmark" style={{ fontSize: Math.round(size * 0.8), color }}>
        Walkup
      </span>
      {association ? (
        <span className={`mt-1 text-[11px] font-normal ${onDark ? "text-white/60" : "text-mute"}`}>{association}</span>
      ) : null}
    </span>
  );
  const dark = (
    <span className="inline-flex items-center" style={{ gap }}>
      <WalkupMark variant="bare" background={BRAND.navy} size={size} title="" animate={animate} />
      {word(BRAND.cream)}
    </span>
  );
  if (onDark) return <span className={`inline-flex items-center ${className ?? ""}`}>{dark}</span>;
  return (
    <span className={`inline-flex items-center ${className ?? ""}`}>
      <span className="brand-on-light inline-flex items-center" style={{ gap }}>
        <WalkupMark variant="tile" size={size} title="" animate={animate} />
        {word(BRAND.navy)}
      </span>
      <span className="brand-on-dark items-center" style={{ gap }}>
        <WalkupMark variant="bare" background="var(--w-bone)" size={size} title="" animate={animate} />
        {word(BRAND.cream)}
      </span>
    </span>
  );
}
