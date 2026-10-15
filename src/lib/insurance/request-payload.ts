import { z } from "zod";
import { isCoverageType } from "./coverage";
import type { QuoteRequestPayloadV2 } from "./emails";

/**
 * The quote-request details the browser sends, bounded (REVIEW-2 #24): lengths,
 * counts and numeric ranges, and unknown keys dropped. The payload is stored
 * as JSON and rendered into an email, so nothing here is trusted for size.
 */

const text = (max: number) => z.string().max(max);
const optText = (max: number) => z.string().max(max).nullable();
const optInt = (lo: number, hi: number) => z.number().int().min(lo).max(hi).nullable();

export const quoteRequestPayloadSchema = z.object({
  version: z.literal(2),
  association: z.object({
    legal_name: text(200),
    address: text(300),
    city: optText(100),
    units: z.number().int().min(0).max(5_000),
    year_built: optInt(1600, 2100),
    construction: optText(60),
    stories: optInt(0, 300),
    roof_replaced_year: optInt(1600, 2100),
    total_square_feet: optInt(0, 100_000_000),
    has_sprinklers: z.boolean().nullable(),
    has_amenities: z.boolean().nullable(),
    rental_share: optText(40),
  }),
  coverages: z
    .array(
      z.object({
        coverage: z.string().refine(isCoverageType, "Choose coverage types from the list."),
        wanted: z.record(z.string().max(60), z.string().max(200).nullable()).refine((o) => Object.keys(o).length <= 40),
      }),
    )
    .min(1)
    .max(12),
  deductibles_today: z
    .object({
      property: optText(40),
      water: optText(40),
      wind_hail: optText(40),
      wind_hail_percent: optText(40),
    })
    .nullable(),
  current: z.object({ carrier: text(120), renews_on: text(20), premium: text(30) }).nullable(),
  claims: z
    .array(z.object({ date_of_loss: text(20), description: text(500), status: text(40), amount_paid: optText(30) }))
    .max(20),
  include_claim_amounts: z.boolean(),
  anything_else: optText(2_000),
  contact: z.object({ name: text(120), email: text(254), phone: optText(40) }),
});

/** The payload with unknown keys removed, or the first problem as a sentence. */
export function parseQuoteRequestPayload(raw: unknown): { ok: true; value: QuoteRequestPayloadV2 } | { ok: false; error: string } {
  const r = quoteRequestPayloadSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data as unknown as QuoteRequestPayloadV2 };
  const issue = r.error.issues[0];
  const custom = issue?.code === "custom" && issue.message ? issue.message : null;
  return { ok: false, error: custom ?? "Some of the request details are missing or too long. Reload and try again." };
}
