import "server-only";
import { googleKey } from "@/lib/google/places";

/**
 * Checks one address line against USPS data through Google's Address Validation
 * API (the same Google key as Places; the API must be enabled on it). It cannot
 * list a building's units, but it can tell whether an address WITH a unit is a
 * real delivery point, and whether a unit is missing. When the API is off or
 * unreachable the answer is "unavailable" and the form simply says nothing.
 */

export type AddressCheckStatus = "confirmed" | "unit_missing" | "unit_unconfirmed" | "not_found" | "unavailable";

export interface AddressCheck {
  status: AddressCheckStatus;
  /** USPS's spelling of the whole address, when it gave one. */
  standardized: string | null;
}

interface ValidationBody {
  result?: {
    verdict?: { addressComplete?: boolean };
    address?: { missingComponentTypes?: string[]; unconfirmedComponentTypes?: string[] };
    uspsData?: {
      dpvConfirmation?: string;
      standardizedAddress?: { firstAddressLine?: string; city?: string; state?: string; zipCode?: string; zipCodeExtension?: string };
    };
  };
}

/** Turns Google's answer into the four things a person needs to know. Pure, so it can be tested. */
export function interpretValidation(body: ValidationBody): AddressCheck {
  const r = body.result;
  if (!r) return { status: "unavailable", standardized: null };
  const std = r.uspsData?.standardizedAddress;
  const standardized =
    std?.firstAddressLine && std.city && std.state
      ? `${std.firstAddressLine}, ${std.city}, ${std.state}${std.zipCode ? ` ${std.zipCode}${std.zipCodeExtension ? `-${std.zipCodeExtension}` : ""}` : ""}`
      : null;

  // USPS delivery-point confirmation: Y = confirmed (with the unit, if one was given), S = the building is
  // real but the unit was not confirmed, D = the building is real and needs a unit, N = not found.
  const dpv = r.uspsData?.dpvConfirmation;
  if (dpv === "Y") return { status: "confirmed", standardized };
  if (dpv === "D") return { status: "unit_missing", standardized };
  if (dpv === "S") return { status: "unit_unconfirmed", standardized };
  if (dpv === "N") return { status: "not_found", standardized };

  // No USPS data came back: fall back on what Google itself decided.
  if (r.address?.missingComponentTypes?.includes("subpremise")) return { status: "unit_missing", standardized };
  if (r.address?.unconfirmedComponentTypes?.includes("subpremise")) return { status: "unit_unconfirmed", standardized };
  if (r.verdict?.addressComplete) return { status: "confirmed", standardized };
  return { status: "not_found", standardized };
}

export async function validateAddress(line: string): Promise<AddressCheck> {
  const key = googleKey();
  if (!key) return { status: "unavailable", standardized: null };
  try {
    const res = await fetch(`https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: { regionCode: "US", addressLines: [line] }, enableUspsCass: true }),
      cache: "no-store",
    });
    if (!res.ok) {
      // 403 usually means the API isn't enabled on the key. Status only: never the key or the address.
      console.error("[address] validation request failed", { http: res.status });
      return { status: "unavailable", standardized: null };
    }
    return interpretValidation((await res.json()) as ValidationBody);
  } catch (cause) {
    console.error("[address] validation failed", cause instanceof Error ? cause.name : "error");
    return { status: "unavailable", standardized: null };
  }
}
