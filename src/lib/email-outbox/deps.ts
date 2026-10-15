import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { Supabase } from "@/lib/repairs/server";
import { isAnnual } from "@/lib/statements/period";
import { loadStatementData } from "@/lib/statements/data";
import { OwnerStatementPdf } from "@/lib/statements/pdf-document";
import { buildingTodayIso } from "@/lib/dates";
import { LEGAL_ADDRESS, LEGAL_ENTITY, SITE_URL } from "@/lib/site-config";
import { resendSender, type SenderDeps, type SenderSite } from "./send-batch";
import type { SendConfig } from "./config";

/** Static facts every email footer needs. */
export const senderSite: SenderSite = { siteUrl: SITE_URL, legalEntity: LEGAL_ENTITY, legalAddress: LEGAL_ADDRESS };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The sender's dependencies when the board admin is signed in: every RPC runs
 * as them, so the database checks that they are an admin of the batch's
 * association, and statement PDFs are read through their own RLS.
 */
export function boardSessionDeps(supabase: Supabase, config: Extract<SendConfig, { ok: true }>): SenderDeps {
  return {
    rpc: (async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(name, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    }) as SenderDeps["rpc"],
    loadAnnouncement: async (id) => {
      const { data } = await supabase
        .from("announcements")
        .select("title, body, attachment_document_id, status")
        .eq("id", id)
        .maybeSingle();
      if (!data || data.status !== "published") return null;
      return { title: data.title as string, body: data.body as string, hasAttachment: Boolean(data.attachment_document_id) };
    },
    loadStatementPdf: async ({ unitId, from, to }) => {
      try {
        const statement = await loadStatementData(supabase, unitId, from, to);
        if (!statement) return null;
        return await renderToBuffer(OwnerStatementPdf({ data: statement, annual: isAnnual(from, to) }));
      } catch (cause) {
        console.error("[walkup-email] statement_pdf_failed", (cause as Error).name);
        return null;
      }
    },
    send: resendSender(config),
    sleep: wait,
    now: () => Date.now(),
    today: () => buildingTodayIso(),
  };
}
