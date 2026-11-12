/**
 * The bank's logo beside its name. `logo` is a data: URI from Plaid; when
 * there is none, a tile with the bank's first letter keeps the row aligned.
 * Decorative: the bank's name is printed right next to it.
 */
export function BankLogo({
  name,
  logo,
}: {
  name: string;
  logo: string | null;
}) {
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a small inline data: URI; there is nothing for next/image to optimize
      <img
        src={logo}
        alt=""
        width={32}
        height={32}
        className="h-8 w-8 shrink-0 rounded-md border border-line bg-white object-contain"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-fill text-[13px] font-bold text-ink"
    >
      {name.trim().charAt(0).toUpperCase() || "·"}
    </span>
  );
}
