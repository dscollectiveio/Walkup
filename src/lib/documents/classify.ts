import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * The only place Walkup talks to a model.
 *
 * Isolated on purpose: the prompt, the schema, and the model choice are one
 * reviewable unit, and every caller gets a plain object back. Swapping the
 * model, or replacing this with a local classifier, touches nothing else.
 *
 * The text arriving here has already had taxpayer numbers stripped
 * (extract-text.ts). Nothing in this file needs to see one.
 */

/** Structured outputs: the model must return exactly this, or the SDK retries. */
function schemaFor(categorySlugs: [string, ...string[]]) {
  return z.object({
    category: z
      .enum(categorySlugs)
      .describe("The single category slug that best fits this document."),
    confidence: z
      .number()
      .describe("How sure you are of the category, from 0 to 1. Be honest — a low number is useful."),
    documentDate: z.string().nullable().describe("ISO date the document itself carries, or null."),
    effectiveDate: z.string().nullable().describe("ISO date cover or a term begins, or null."),
    expirationDate: z.string().nullable().describe("ISO date cover or a term ends, or null."),
    amount: z.number().nullable().describe("The single headline money amount, or null."),
    currency: z.string().nullable().describe("ISO currency code for that amount, or null."),
    counterpartyName: z
      .string()
      .nullable()
      .describe("The other party: insurer, contractor, agency, bank. Null if none."),
    accountOrPolicyNumber: z
      .string()
      .nullable()
      .describe("Policy, account or reference number exactly as printed, or null."),
    taxYear: z.number().nullable().describe("Four-digit tax year, or null."),
    unitReference: z
      .string()
      .nullable()
      .describe("A unit this document is about, as written in the document. Null if building-wide."),
    summary: z
      .string()
      .describe("Two sentences, plain language, for a board member with no accounting training."),
  });
}

export type Extraction = z.infer<ReturnType<typeof schemaFor>>;

export type ClassifyResult =
  | { ok: true; extraction: Extraction }
  | { ok: false; reason: string; configured: boolean };

const SYSTEM = `You are filing documents for a small self-managed condominium association's records.

Return only what the document actually says.

- If a field is not present, return null. Do not infer it, do not carry it over
  from a similar document, and do not derive it from today's date.
- Never invent an amount, a policy number, or an expiration date. A blank field
  is correct and useful. A plausible-looking wrong one is worse than useless:
  these records feed an insurance renewal calendar and a tax return.
- Some numbers have been replaced with [redacted] before you saw them. That is
  deliberate. Treat a redacted value as absent — never guess what it was.
- Set confidence to what you actually believe. Anything you are unsure of will
  be shown to a person for confirmation, which is the desired outcome — an
  inflated score defeats that and is the one answer that causes real harm.
- Write the summary for someone doing this unpaid in the evening: what the
  document is and why it matters, no jargon.`;

/** Claude 4.6+ removed budget_tokens; adaptive thinking is the supported form. */
const MODEL = "claude-opus-4-8";

export async function classifyDocument(opts: {
  filename: string;
  mimeType: string | null;
  text: string;
  categories: { slug: string; label: string }[];
}): Promise<ClassifyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      reason: "No Anthropic API key is configured, so nothing was read automatically.",
    };
  }

  const slugs = opts.categories.map((c) => c.slug);
  if (slugs.length === 0) {
    return { ok: false, configured: true, reason: "No categories are set up to file under." };
  }

  const client = new Anthropic({ apiKey });

  // Long documents are truncated rather than refused: the identifying details
  // of an invoice, policy or notice are near the front, and a partial read that
  // a person confirms beats no read at all.
  const excerpt = opts.text.slice(0, 60_000);

  const catalogue = opts.categories.map((c) => `- ${c.slug}: ${c.label}`).join("\n");

  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: {
        format: zodOutputFormat(schemaFor(slugs as [string, ...string[]])),
        // This is extraction from text that is already in front of the model,
        // not open-ended reasoning; medium keeps latency sane without costing
        // accuracy on the judgement that matters (which category).
        effort: "medium",
      },
      messages: [
        {
          role: "user",
          content: `Categories available:\n${catalogue}\n\nFilename: ${opts.filename}\nType: ${opts.mimeType ?? "unknown"}\n\nDocument text follows.\n\n---\n${excerpt}`,
        },
      ],
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      return { ok: false, configured: true, reason: "The model's answer didn't match the schema." };
    }

    // Clamp rather than constrain in the schema: structured outputs strip
    // numeric bounds, so validating them here is the honest place to do it.
    return {
      ok: true,
      extraction: { ...parsed, confidence: Math.min(1, Math.max(0, parsed.confidence)) },
    };
  } catch (cause) {
    return { ok: false, configured: true, reason: (cause as Error).message };
  }
}

/**
 * The line between "filed" and "someone should look at this".
 *
 * 0.85 per the brief. Deliberately not tuned downward if accuracy disappoints —
 * lowering it doesn't make the guesses better, it just hides them.
 */
export const CONFIDENCE_THRESHOLD = 0.85;
