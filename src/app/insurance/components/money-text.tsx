import { formatMoney } from "@/lib/insurance/format";

/**
 * Money that arrived as numeric text ("2400000.00"), shown in figures type.
 * Never parsed to a float (DECISIONS #20). Null shows `empty`.
 */
export function MoneyText({
  value,
  cents,
  empty = "Not recorded",
  className = "",
}: {
  value: string | null | undefined;
  cents?: boolean;
  empty?: string;
  className?: string;
}) {
  const shown = formatMoney(value ?? null, cents ? { cents: true } : undefined);
  if (shown === null) return <span className={`text-mute-soft ${className}`}>{empty}</span>;
  return <span className={`figures ${className}`}>{shown}</span>;
}
