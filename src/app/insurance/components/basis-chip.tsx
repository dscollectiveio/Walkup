import type { Basis } from "@/lib/insurance/coverage-check";

/**
 * What a coverage-check finding rests on (brief decision 2), in words. A
 * statute finding names the state's law; the others say whose record or
 * whose practice it is.
 */
export function basisLabel(basis: Basis, stateName: string): string {
  switch (basis) {
    case "statute":
      return `${stateName} law`;
    case "your_documents":
      return "Your declaration";
    case "your_data":
      return "Your numbers";
    default:
      return "Commonly carried";
  }
}

export function BasisChip({ basis, stateName }: { basis: Basis; stateName: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-line-strong bg-paper px-2.5 py-0.5 text-[11px] text-mute">
      {basisLabel(basis, stateName)}
    </span>
  );
}
