/**
 * The Walkup mark: three risers ascending to a doorway. See
 * WALKUP_BRAND.md section 4 and Appendix A for construction and rules.
 *
 * Below 20px, use `variant="door"` (the favicon form) rather than shrinking
 * the full mark — the risers stop reading at small sizes.
 */

type MarkVariant = "full" | "dark" | "door" | "mono-light" | "mono-dark";

const STAIR_PATH = "M5 27V21.5H11.5V16H18V10.5H27V27Z";

export function Mark({
  variant = "full",
  size = 32,
  className,
}: {
  variant?: MarkVariant;
  size?: number;
  className?: string;
}) {
  const props = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 32 32",
    width: size,
    height: size,
    role: "img" as const,
    "aria-label": "Walkup",
    className,
  };

  if (variant === "dark") {
    return (
      <svg {...props}>
        <rect width="32" height="32" rx="7" fill="#1E2E52" />
        <path d={STAIR_PATH} fill="#FFFFFF" />
        <rect x="20" y="4" width="5.5" height="6.5" rx="1" fill="#C08A3E" />
      </svg>
    );
  }

  if (variant === "door") {
    return (
      <svg {...props}>
        <rect width="32" height="32" rx="7" fill="#14213D" />
        <rect x="9" y="6" width="14" height="20" rx="2" fill="#C08A3E" />
      </svg>
    );
  }

  if (variant === "mono-light") {
    return (
      <svg {...props}>
        <rect width="32" height="32" rx="7" fill="#14213D" />
        <path d={STAIR_PATH} fill="#FFFFFF" />
        <rect
          x="20"
          y="4"
          width="5.5"
          height="6.5"
          rx="1"
          fill="#FFFFFF"
          opacity="0.6"
        />
      </svg>
    );
  }

  if (variant === "mono-dark") {
    return (
      <svg {...props}>
        <path d={STAIR_PATH} fill="#14213D" />
        <rect
          x="20"
          y="4"
          width="5.5"
          height="6.5"
          rx="1"
          fill="#14213D"
          opacity="0.6"
        />
      </svg>
    );
  }

  return (
    <svg {...props}>
      <rect width="32" height="32" rx="7" fill="#14213D" />
      <path d={STAIR_PATH} fill="#FFFFFF" />
      <rect x="20" y="4" width="5.5" height="6.5" rx="1" fill="#C08A3E" />
    </svg>
  );
}

/**
 * Mark + wordmark lockup, with an optional association name beneath —
 * multi-tenant is the product, so the slot is built in from day one. See
 * WALKUP_BRAND.md section 4, "Lockup."
 */
export function Lockup({
  association,
  dark = false,
  className,
}: {
  association?: string | null;
  dark?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-[11px] ${className ?? ""}`}>
      <Mark variant={dark ? "dark" : "full"} size={28} />
      <span className="flex flex-col leading-none">
        <span
          className={`text-base font-semibold tracking-[-0.014em] ${
            dark ? "text-paper" : "text-ink"
          }`}
        >
          Walkup
        </span>
        {association ? (
          <span
            className={`mt-1 text-[11px] font-normal ${
              dark ? "text-ondark-mute" : "text-mute"
            }`}
          >
            {association}
          </span>
        ) : null}
      </span>
    </span>
  );
}
