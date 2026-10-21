import "server-only";
import { taxFlag, vendorColumns, vendorRows, vendorSource } from "@/lib/contractors/vendor-source";
import { listLinkedDocuments, type LinkedDocument } from "@/lib/documents/access";
import { complianceFor } from "@/lib/contractors/compliance";
import { rankSaved, type SavedCandidate } from "@/lib/contractors/ranking";
import { tradeBySlug, tradeLabel } from "@/lib/contractors/trades";
import { aiConfigured } from "@/lib/ai/client";
import { inForce } from "@/lib/insurance/status";
import { loadDraftBasics } from "@/lib/repairs/contractor-drafts";
import { EMERGENCY_KINDS, type EmergencyKind } from "@/lib/repairs/emergency";
import { eventSentence, type Actor, type TicketEventRow, type TicketPriority, type TicketStatus } from "@/lib/repairs/labels";
import { loadEmergencyContractors, loadEmergencyInfo, type EmergencyInfo, type RepairsViewer } from "@/lib/repairs/page-data";
import type { Supabase } from "@/lib/repairs/server";
import { ticketStage, type BidCounts, type Stage } from "@/lib/repairs/stage";
import { loadTicketPhotos } from "@/lib/repairs/ticket-photos";
import { parseStoredTriage } from "@/lib/repairs/validate";
import type { EmergencyContractor } from "@/components/repairs/emergency-banner";
import type {
  BidView,
  BoardDetailsView,
  DraftBasics,
  MessageView,
  PersonOption,
  PhotoView,
  QuoteCandidate,
  TicketView,
  TimelineEntry,
  VendorView,
} from "./types";

/**
 * Everything the ticket page shows (repairs-spec §5.3, §14.2), read with
 * the viewer's own client. Owners get exactly what RLS and the narrow
 * SECURITY DEFINER readers give them: no costs, no contractors table, no
 * internal notes, roles instead of names.
 */

export interface TicketPageData {
  ticket: TicketView;
  stage: Stage;
  bidCounts: BidCounts;
  board: BoardDetailsView | null;
  reporterName: string | null;
  reporterIsBoard: boolean;
  /** Owners: the assigned contractor's name from ticket_contractor_names(). Board: from vendors. */
  contractorName: string | null;
  assignedVendor: VendorView | null;
  vendors: VendorView[];
  quoteCandidates: QuoteCandidate[];
  bids: BidView[];
  messages: MessageView[];
  timeline: TimelineEntry[];
  meTooCount: number;
  iSaidMeToo: boolean;
  photos: PhotoView[];
  documents: LinkedDocument[];
  emergency: EmergencyInfo | null;
  emergencyContractors: EmergencyContractor[];
  boardPeople: PersonOption[];
  claims: {
    id: string;
    policyId: string | null;
    claimNumber: string | null;
    status: string;
    dateOfLoss: string;
    amountClaimed: string | null;
    amountPaid: string | null;
  }[];
  /** The in-force master policy (insurance-spec §12 R-5: inForce(), so an early renewal doesn't hide it). */
  policy: { id: string; propertyDeductible: string | null; waterDeductible: string | null } | null;
  capitalizationThreshold: string | null;
  draftBasics: DraftBasics | null;
  aiConfigured: boolean;
  /** Visit feedback already sent by the reporter. */
  feedbackSent: boolean;
  /** Reported under two minutes ago (triage may still be running). */
  justReported: boolean;
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

const TICKET_COLUMNS =
  "id, association_id, reference, title, description, status, priority, unit_id, reported_by, assigned_vendor_id, opened_on, resolved_at, created_at, trade, location_detail, access_notes, scheduled_for, scheduled_window, resolution_note, emergency_kind, upkeep_task_id, duplicate_of_id, units(label)";
const TICKET_COLUMNS_BOARD = `${TICKET_COLUMNS}, ticket_board_details(assignee_person_id, due_on, estimated_cost::text, actual_cost::text, expense_id, triage, emergency_suggestion_dismissed_at)`;

export async function loadTicketPage(supabase: Supabase, ticketId: string, viewer: RepairsViewer): Promise<TicketPageData | null> {
  const { data: rows } = await supabase
    .from("tickets")
    .select(viewer.staffView ? TICKET_COLUMNS_BOARD : TICKET_COLUMNS)
    .eq("id", ticketId)
    .limit(1);
  const t = (rows?.[0] ?? null) as Record<string, unknown> | null;
  if (!t) return null;
  const today = viewer.todayIso;
  // The staff layout: board details, quotes and contractors. The board, the accountant and a property manager (0080).
  const fin = viewer.staffView;

  const emergencyKind = (EMERGENCY_KINDS as readonly string[]).includes(String(t.emergency_kind)) ? (t.emergency_kind as EmergencyKind) : null;
  const ticket: TicketView = {
    id: t.id as string,
    associationId: t.association_id as string,
    reference: t.reference as number,
    title: t.title as string,
    description: str(t.description),
    status: t.status as TicketStatus,
    priority: t.priority as TicketPriority,
    unitId: (t.unit_id as string | null) ?? null,
    unitLabel: (one(t.units as { label: string } | null)?.label as string | undefined) ?? null,
    reportedBy: (t.reported_by as string | null) ?? null,
    assignedVendorId: (t.assigned_vendor_id as string | null) ?? null,
    openedOn: t.opened_on as string,
    resolvedAt: (t.resolved_at as string | null) ?? null,
    createdAt: t.created_at as string,
    trade: str(t.trade),
    locationDetail: str(t.location_detail),
    accessNotes: str(t.access_notes),
    scheduledFor: (t.scheduled_for as string | null) ?? null,
    scheduledWindow: str(t.scheduled_window),
    resolutionNote: str(t.resolution_note),
    emergencyKind,
    upkeepTaskId: (t.upkeep_task_id as string | null) ?? null,
    upkeepTaskName: null,
    duplicateOf: t.duplicate_of_id ? { id: null, reference: null } : null,
  };

  const bd = fin ? (one(t.ticket_board_details as Record<string, unknown> | Record<string, unknown>[] | null) as Record<string, unknown> | null) : null;

  const [
    eventsRes,
    commentsRes,
    rolesRes,
    photos,
    documents,
    namesRes,
    taskRes,
    dupRes,
  ] = await Promise.all([
    supabase
      .from("ticket_events")
      .select("id, kind, from_value, to_value, data, created_at, actor_person_id")
      .eq("ticket_id", ticket.id)
      .order("created_at"),
    supabase
      .from("ticket_comments")
      .select("id, body, created_at, edited_at, person_id, is_internal, kind")
      .eq("ticket_id", ticket.id)
      .order("created_at"),
    fin ? Promise.resolve({ data: null }) : supabase.rpc("ticket_event_actor_roles", { p_ticket_id: ticket.id }),
    loadTicketPhotos(supabase, ticket.id, { seesNames: fin }),
    listLinkedDocuments(supabase, "tickets", ticket.id),
    !fin && ticket.assignedVendorId
      ? supabase.rpc("ticket_contractor_names", { p_ticket_ids: [ticket.id] })
      : Promise.resolve({ data: null }),
    ticket.upkeepTaskId
      ? supabase.from("upkeep_tasks").select("name").eq("id", ticket.upkeepTaskId).limit(1)
      : Promise.resolve({ data: null }),
    t.duplicate_of_id
      ? supabase.from("tickets").select("id, reference").eq("id", t.duplicate_of_id as string).limit(1)
      : Promise.resolve({ data: null }),
  ]);

  ticket.upkeepTaskName = (taskRes.data?.[0]?.name as string | undefined) ?? null;
  if (ticket.duplicateOf) {
    const d = dupRes.data?.[0];
    ticket.duplicateOf = d ? { id: d.id as string, reference: d.reference as number } : { id: null, reference: null };
    if (!d && ticket.resolutionNote) {
      const m = /#(\d+)/.exec(ticket.resolutionNote);
      if (m) ticket.duplicateOf.reference = Number(m[1]);
    }
  }

  // Board and accountant: everything else they need.
  let persons = new Map<string, string>();
  let reporterIsBoard = false;
  let vendors: VendorView[] = [];
  let quoteCandidates: QuoteCandidate[] = [];
  let bids: BidView[] = [];
  let messages: MessageView[] = [];
  let boardPeople: PersonOption[] = [];
  let claims: TicketPageData["claims"] = [];
  let policy: TicketPageData["policy"] = null;
  let capitalizationThreshold: string | null = null;
  let draftBasics: DraftBasics | null = null;
  let emergencyContractors: EmergencyContractor[] = [];
  let expense: BoardDetailsView["expense"] = null;

  if (fin) {
    const [
      personsRes,
      grantsRes,
      vendorsRes,
      reviewsRes,
      usedRes,
      bidsRes,
      messagesRes,
      claimsRes,
      policyRes,
      assocRes,
      expenseRes,
      basics,
      ec,
    ] = await Promise.all([
      supabase.from("persons").select("id, full_name"),
      supabase
        .from("role_grants")
        .select("person_id, role, granted_on, revoked_at, expires_on")
        .in("role", ["board_admin", "board_member"])
        .is("revoked_at", null),
      supabase
        // A property manager reads contractors through vendors_manager: no W-9 flags, no tax identity (0081).
        .from(vendorSource(viewer.canReadFinancials))
        .select(
          vendorColumns(
            "id, name, status, archived_at, email, phone, trades, insured_until, license_number, license_expires_on, w9_on_file, is_1099_exempt, emergency_service, google_rating, google_review_count, board_rating, last_used_on, job_tags, rate_hourly::text, rate_trip_fee::text, rate_after_hours::text, rates_as_of, website_url",
            viewer.canReadFinancials,
          ),
        )
        .order("name"),
      supabase.from("contractor_reviews").select("vendor_id, rating, tags"),
      supabase.from("tickets").select("assigned_vendor_id, opened_on, status").not("assigned_vendor_id", "is", null),
      supabase
        .from("ticket_bids")
        .select(
          "id, vendor_id, status, requested_by_phone, requested_on, message_id, amount::text, amount_kind, received_on, valid_until, can_start_on, duration_text, scope_text, warranty_text, exclusions_text, payment_terms_text, notes, document_id, decided_at, decline_reason, created_at, contractor_messages(status)",
        )
        .eq("ticket_id", ticket.id)
        .order("created_at"),
      supabase
        .from("contractor_messages")
        .select("id, vendor_id, kind, status, to_email, subject, body, sent_at, created_at")
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("insurance_claims")
        .select("id, policy_id, date_of_loss, claim_number, status, amount_claimed::text, amount_paid::text")
        .eq("ticket_id", ticket.id)
        .order("date_of_loss", { ascending: false }),
      supabase
        .from("insurance_policies")
        .select(
          "id, coverage, effective_from, effective_to, archived_at, replaced_by_policy_id, replaced_at, renewal_reminder_days, property_deductible::text, water_damage_deductible::text",
        )
        .eq("coverage", "property"),
      supabase.from("associations").select("capitalization_threshold::text").eq("id", ticket.associationId).limit(1),
      bd?.expense_id
        ? supabase.from("expenses").select("paid_on, amount::text, memo").eq("id", bd.expense_id as string).limit(1)
        : Promise.resolve({ data: null }),
      viewer.canManage ? loadDraftBasics(supabase, ticket.associationId) : Promise.resolve(null),
      viewer.canManage ? loadEmergencyContractors(supabase) : Promise.resolve([]),
    ]);

    persons = new Map((personsRes.data ?? []).map((p) => [p.id as string, (p.full_name as string) ?? ""]));
    const boardIds = new Set(
      (grantsRes.data ?? [])
        .filter((g) => (g.granted_on as string) <= today && (!g.expires_on || (g.expires_on as string) >= today))
        .map((g) => g.person_id as string),
    );
    reporterIsBoard = ticket.reportedBy ? boardIds.has(ticket.reportedBy) : false;
    boardPeople = [...boardIds]
      .map((id) => ({ id, name: persons.get(id) || "Board member" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Reviews and history, for ranking and the comparison's "your history".
    const reviews = new Map<string, { sum: number; count: number; tags: Record<string, number> }>();
    for (const r of reviewsRes.data ?? []) {
      const cur = reviews.get(r.vendor_id as string) ?? { sum: 0, count: 0, tags: {} };
      cur.sum += Number(r.rating);
      cur.count += 1;
      for (const tag of (r.tags as string[] | null) ?? []) cur.tags[tag] = (cur.tags[tag] ?? 0) + 1;
      reviews.set(r.vendor_id as string, cur);
    }
    const used = new Map<string, { jobs: number; last: string | null; open: boolean }>();
    for (const u of usedRes.data ?? []) {
      const id = u.assigned_vendor_id as string;
      const cur = used.get(id) ?? { jobs: 0, last: null, open: false };
      cur.jobs += 1;
      const d = u.opened_on as string;
      if (!cur.last || d > cur.last) cur.last = d;
      if (u.status !== "resolved" && u.status !== "closed") cur.open = true;
      used.set(id, cur);
    }

    const raw = vendorRows(vendorsRes.data);
    const books = viewer.canReadFinancials;
    const savedCandidates: SavedCandidate[] = [];
    vendors = raw.map((v) => {
      const id = v.id as string;
      const r = reviews.get(id);
      const u = used.get(id);
      const lastUsedOn = [v.last_used_on as string | null, u?.last ?? null].filter(Boolean).sort().pop() ?? null;
      const trades = (v.trades as string[] | null) ?? [];
      const recently = lastUsedOn ? lastUsedOn >= addDays(today, -365) : false;
      const inUse = Boolean(u?.open) || recently || id === ticket.assignedVendorId;
      const { items } = complianceFor(
        {
          insured_until: (v.insured_until as string | null) ?? null,
          license_number: (v.license_number as string | null) ?? null,
          license_expires_on: (v.license_expires_on as string | null) ?? null,
          // Not shown to a property manager, so never read as "missing".
          w9_on_file: taxFlag(v.w9_on_file, books),
          is_1099_exempt: taxFlag(v.is_1099_exempt, books),
          status: v.status as string,
          archived_at: (v.archived_at as string | null) ?? null,
          inUse,
          tradeNeedsLicense: trades.some((s) => tradeBySlug(s)?.licenseTypical),
        },
        today,
      );
      const insured = (v.insured_until as string | null) ?? null;
      const view: VendorView = {
        id,
        name: v.name as string,
        status: v.status as VendorView["status"],
        archived: Boolean(v.archived_at),
        email: str(v.email),
        phone: str(v.phone),
        trades,
        compliance: items,
        coiOnFile: Boolean(insured && insured >= today),
        w9OnFile: !books || v.w9_on_file === true || v.is_1099_exempt === true,
        googleRating: v.google_rating === null || v.google_rating === undefined ? null : Number(v.google_rating),
        googleReviewCount: (v.google_review_count as number | null) ?? null,
        boardAverage: r && r.count ? Math.round((r.sum / r.count) * 10) / 10 : null,
        boardReviewCount: r?.count ?? 0,
        jobs: u?.jobs ?? 0,
        lastUsedOn,
      };
      if (!view.archived && view.status !== "do_not_use") {
        savedCandidates.push({
          kind: "saved",
          vendorId: id,
          name: view.name,
          trades,
          status: view.status as "preferred" | "okay",
          phone: view.phone,
          email: view.email,
          website: str(v.website_url),
          googleRating: view.googleRating,
          googleReviewCount: view.googleReviewCount,
          boardReviews: { count: r?.count ?? 0, average: r && r.count ? r.sum / r.count : null, tags: (r?.tags ?? {}) as SavedCandidate["boardReviews"]["tags"] },
          boardRating: (v.board_rating as number | null) ?? null,
          jobs: view.jobs,
          lastUsedOn,
          emergencyService: v.emergency_service === true,
          jobTags: ((v.job_tags as string[] | null) ?? []) as SavedCandidate["jobTags"],
          rates: {
            hourly: (v.rate_hourly as string | null) ?? null,
            tripFee: (v.rate_trip_fee as string | null) ?? null,
            afterHours: (v.rate_after_hours as string | null) ?? null,
            asOf: (v.rates_as_of as string | null) ?? null,
          },
          compliance: {
            coiCurrent: view.coiOnFile,
            coiExpired: Boolean(insured && insured < today),
            licenseOnFile: Boolean(str(v.license_number)),
            w9OnFile: taxFlag(v.w9_on_file, books),
          },
          distanceMiles: null,
        });
      }
      return view;
    });

    const trade = ticket.trade ?? "general";
    const ranked = rankSaved(savedCandidates, {
      trade,
      relatedTrades: tradeBySlug(trade)?.related ?? [],
      urgent: ticket.priority === "urgent" || ticket.emergencyKind !== null,
      wants: [],
      todayIso: today,
    });
    quoteCandidates = ranked.map((c) => ({
      vendorId: c.vendorId,
      name: c.name,
      email: c.email,
      phone: c.phone,
      tradeMatch: ticket.trade ? c.trades.includes(ticket.trade) : false,
      why: c.why.filter((w) => w.key !== "trade").slice(0, 2),
    }));

    const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
    bids = (bidsRes.data ?? []).map((b) => ({
      id: b.id as string,
      vendorId: b.vendor_id as string,
      vendorName: vendorName.get(b.vendor_id as string) ?? "A contractor",
      status: b.status as BidView["status"],
      requestedByPhone: b.requested_by_phone === true,
      requestedOn: (b.requested_on as string | null) ?? null,
      messageStatus: (one(b.contractor_messages as unknown as { status: string } | { status: string }[] | null)?.status as string | undefined) ?? null,
      amount: (b.amount as string | null) ?? null,
      amountKind: (b.amount_kind as BidView["amountKind"]) ?? "fixed",
      receivedOn: (b.received_on as string | null) ?? null,
      validUntil: (b.valid_until as string | null) ?? null,
      canStartOn: (b.can_start_on as string | null) ?? null,
      durationText: str(b.duration_text),
      scopeText: str(b.scope_text),
      warrantyText: str(b.warranty_text),
      exclusionsText: str(b.exclusions_text),
      paymentTermsText: str(b.payment_terms_text),
      notes: str(b.notes),
      documentId: (b.document_id as string | null) ?? null,
      decidedAt: (b.decided_at as string | null) ?? null,
      declineReason: str(b.decline_reason),
    }));

    messages = (messagesRes.data ?? []).map((m) => ({
      id: m.id as string,
      vendorId: m.vendor_id as string,
      vendorName: vendorName.get(m.vendor_id as string) ?? "A contractor",
      kind: (m.kind as string) ?? "general",
      status: m.status as string,
      toEmail: str(m.to_email),
      subject: (m.subject as string) ?? "",
      body: (m.body as string) ?? "",
      sentAt: (m.sent_at as string | null) ?? null,
      createdAt: m.created_at as string,
    }));

    claims = (claimsRes.data ?? []).map((c) => ({
      id: c.id as string,
      policyId: (c.policy_id as string | null) ?? null,
      claimNumber: str(c.claim_number),
      status: c.status as string,
      dateOfLoss: c.date_of_loss as string,
      amountClaimed: (c.amount_claimed as string | null) ?? null,
      amountPaid: (c.amount_paid as string | null) ?? null,
    }));
    type PolicyRead = {
      id: string; coverage: string; effective_from: string; effective_to: string; archived_at: string | null;
      replaced_by_policy_id: string | null; replaced_at: string | null; renewal_reminder_days: number;
      property_deductible: string | null; water_damage_deductible: string | null;
    };
    const p = inForce((policyRes.data ?? []) as unknown as PolicyRead[], today).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    policy = p
      ? { id: p.id as string, propertyDeductible: (p.property_deductible as string | null) ?? null, waterDeductible: (p.water_damage_deductible as string | null) ?? null }
      : null;
    capitalizationThreshold = (assocRes.data?.[0]?.capitalization_threshold as string | undefined) ?? null;
    const e = expenseRes.data?.[0];
    expense = e ? { paidOn: e.paid_on as string, amount: e.amount as string, memo: str(e.memo) } : null;
    draftBasics = basics;
    emergencyContractors = ec;
  }

  // Bid counts drive the stage; owners have none (they see statuses).
  const bidCounts: BidCounts = {
    requested: bids.filter((b) => b.status === "requested").length,
    received: bids.filter((b) => b.status === "received").length,
    accepted: bids.filter((b) => b.status === "accepted").length,
  };
  const stage = ticketStage({ status: ticket.status, assigned_vendor_id: ticket.assignedVendorId, scheduled_for: ticket.scheduledFor }, bidCounts, today);

  const board: BoardDetailsView | null = fin
    ? {
        assigneePersonId: (bd?.assignee_person_id as string | null) ?? null,
        dueOn: (bd?.due_on as string | null) ?? null,
        estimatedCost: (bd?.estimated_cost as string | null) ?? null,
        actualCost: (bd?.actual_cost as string | null) ?? null,
        expenseId: (bd?.expense_id as string | null) ?? null,
        expense,
        triage: bd?.triage ? parseStoredTriage(bd.triage) : null,
        triageUnreadable: Boolean(bd?.triage) && parseStoredTriage(bd?.triage) === null,
        emergencySuggestionDismissedAt: (bd?.emergency_suggestion_dismissed_at as string | null) ?? null,
      }
    : null;

  // Who did what: names for the board and accountant, roles for owners.
  const roleByEvent = new Map<string, string>(
    ((rolesRes.data ?? []) as { event_id: string; actor_role: string }[]).map((r) => [r.event_id, r.actor_role]),
  );
  const events = (eventsRes.data ?? []) as unknown as TicketEventRow[];
  const actorFor = (e: TicketEventRow): Actor => {
    if (fin) {
      if (!e.actor_person_id) return { kind: "unknown" };
      if (e.actor_person_id === viewer.personId) return { kind: "you" };
      const name = persons.get(e.actor_person_id);
      return name ? { kind: "name", name } : { kind: "unknown" };
    }
    switch (roleByEvent.get(e.id)) {
      case "you":
        return { kind: "you" };
      case "board":
        return { kind: "board" };
      case "accountant":
        return { kind: "accountant" };
      case "owner":
        return { kind: "owner" };
      default:
        return { kind: "unknown" };
    }
  };
  const actorByComment = new Map<string, Actor>();
  for (const e of events) {
    if (e.kind === "note_added" && typeof e.data?.comment_id === "string") actorByComment.set(e.data.comment_id, actorFor(e));
  }

  const comments = commentsRes.data ?? [];
  const timeline: TimelineEntry[] = [];
  for (const e of events) {
    if (e.kind === "note_added") continue;
    timeline.push({ type: "event", id: e.id, at: e.created_at, sentence: eventSentence(e, actorFor(e), today) });
  }
  let meTooCount = 0;
  let iSaidMeToo = false;
  let feedbackSent = false;
  for (const c of comments) {
    const mine = Boolean(viewer.personId && c.person_id === viewer.personId);
    const kind = (c.kind as "note" | "me_too" | "visit_feedback") ?? "note";
    if (kind === "me_too") {
      meTooCount += 1;
      if (mine) iSaidMeToo = true;
    }
    if (kind === "visit_feedback" && mine) feedbackSent = true;
    let author: string;
    if (mine) author = "You";
    else if (fin) author = (c.person_id && persons.get(c.person_id as string)) || "Someone";
    else {
      const a = actorByComment.get(c.id as string);
      author = a ? (a.kind === "you" ? "You" : a.kind === "board" ? "The board" : a.kind === "accountant" ? "The building's accountant" : a.kind === "owner" ? "Another owner" : "Someone") : "Someone";
    }
    timeline.push({
      type: "note",
      id: c.id as string,
      at: c.created_at as string,
      body: c.body as string,
      author,
      internal: c.is_internal === true,
      kind,
      edited: Boolean(c.edited_at),
      mine,
    });
  }
  timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  // The safety facts, when there's (or may be) an emergency, or the reporter landed here on an urgent report.
  const triageEmergency = board?.triage?.state === "done" && board.triage.emergency && board.triage.emergency !== "none";
  const needsEmergency = ticket.emergencyKind !== null || ticket.priority === "urgent" || triageEmergency;
  const emergency = needsEmergency ? await loadEmergencyInfo(supabase, ticket.associationId) : null;

  const contractorName = fin
    ? (vendors.find((v) => v.id === ticket.assignedVendorId)?.name ?? null)
    : ((namesRes.data as { contractor_name: string }[] | null)?.[0]?.contractor_name ?? null);

  return {
    ticket,
    stage,
    bidCounts,
    board,
    reporterName: ticket.reportedBy ? (persons.get(ticket.reportedBy) ?? null) : null,
    reporterIsBoard,
    contractorName,
    assignedVendor: vendors.find((v) => v.id === ticket.assignedVendorId) ?? null,
    vendors,
    quoteCandidates,
    bids,
    messages,
    timeline,
    meTooCount,
    iSaidMeToo,
    photos: photos.map((p) => ({
      documentId: p.documentId,
      url: p.url,
      heic: p.heic,
      filename: p.filename,
      caption: p.caption,
      alt: p.alt,
      canRemove: p.canRemove && viewer.canManage,
    })),
    documents: documents.filter((d) => d.relation !== "photo"),
    emergency,
    emergencyContractors,
    boardPeople,
    claims,
    policy,
    capitalizationThreshold,
    draftBasics,
    aiConfigured: aiConfigured(),
    feedbackSent,
    justReported: Date.now() - Date.parse(ticket.createdAt) < 2 * 60_000,
  };
}

function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "Plumbing" or "Kind of work not set". */
export function tradeWords(trade: string | null): string {
  return trade ? tradeLabel(trade) : "Kind of work not set";
}
