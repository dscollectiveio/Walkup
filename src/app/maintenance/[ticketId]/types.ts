// What the ticket page loads and hands to its client cards (repairs-spec
// §5.3, §14.2). Plain data only; money is numeric(14,2) text.

import type { ComplianceItem } from "@/lib/contractors/compliance";
import type { Why } from "@/lib/contractors/ranking";
import type { DraftContext } from "@/lib/repairs/drafts";
import type { EmergencyKind } from "@/lib/repairs/emergency";
import type { TicketPriority, TicketStatus } from "@/lib/repairs/labels";
import type { StoredTriage } from "@/lib/repairs/validate";

export interface TicketView {
  id: string;
  associationId: string;
  reference: number;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  unitId: string | null;
  unitLabel: string | null;
  reportedBy: string | null;
  assignedVendorId: string | null;
  openedOn: string;
  resolvedAt: string | null;
  createdAt: string;
  trade: string | null;
  locationDetail: string | null;
  accessNotes: string | null;
  scheduledFor: string | null;
  scheduledWindow: string | null;
  resolutionNote: string | null;
  emergencyKind: EmergencyKind | null;
  upkeepTaskId: string | null;
  upkeepTaskName: string | null;
  /** The original when this was closed as a duplicate; `id` null when the viewer can't see it. */
  duplicateOf: { id: string | null; reference: number | null } | null;
}

export interface BoardDetailsView {
  assigneePersonId: string | null;
  dueOn: string | null;
  estimatedCost: string | null;
  actualCost: string | null;
  expenseId: string | null;
  expense: { paidOn: string; amount: string; memo: string | null } | null;
  /** Parsed with storedTriageSchema; null when absent. */
  triage: StoredTriage | null;
  /** A triage value is stored but doesn't parse (shown as the failed state). */
  triageUnreadable: boolean;
  emergencySuggestionDismissedAt: string | null;
}

export interface VendorView {
  id: string;
  name: string;
  status: "preferred" | "okay" | "do_not_use";
  archived: boolean;
  email: string | null;
  phone: string | null;
  trades: string[];
  compliance: ComplianceItem[];
  /** For "Ask for both". */
  coiOnFile: boolean;
  w9OnFile: boolean;
  googleRating: number | null;
  googleReviewCount: number | null;
  boardAverage: number | null;
  boardReviewCount: number;
  jobs: number;
  lastUsedOn: string | null;
}

export type BidStatus = "requested" | "received" | "accepted" | "declined" | "withdrawn";
export type AmountKind = "fixed" | "estimate" | "not_to_exceed";

export interface BidView {
  id: string;
  vendorId: string;
  vendorName: string;
  status: BidStatus;
  requestedByPhone: boolean;
  requestedOn: string | null;
  /** The quote request draft's status when asked by email. */
  messageStatus: string | null;
  amount: string | null;
  amountKind: AmountKind;
  receivedOn: string | null;
  validUntil: string | null;
  canStartOn: string | null;
  durationText: string | null;
  scopeText: string | null;
  warrantyText: string | null;
  exclusionsText: string | null;
  paymentTermsText: string | null;
  notes: string | null;
  documentId: string | null;
  decidedAt: string | null;
  declineReason: string | null;
}

export interface MessageView {
  id: string;
  vendorId: string;
  vendorName: string;
  kind: string;
  status: string;
  toEmail: string | null;
  subject: string;
  body: string;
  sentAt: string | null;
  createdAt: string;
}

export type TimelineEntry =
  | { type: "event"; id: string; at: string; sentence: string }
  | {
      type: "note";
      id: string;
      at: string;
      body: string;
      author: string;
      internal: boolean;
      kind: "note" | "me_too" | "visit_feedback";
      edited: boolean;
      mine: boolean;
    };

export interface QuoteCandidate {
  vendorId: string;
  name: string;
  email: string | null;
  phone: string | null;
  tradeMatch: boolean;
  why: Why[];
}

export interface PhotoView {
  documentId: string;
  url: string | null;
  heic: boolean;
  filename: string;
  caption: string;
  alt: string;
  canRemove: boolean;
}

export interface PersonOption {
  id: string;
  name: string;
}

export type DraftBasics = Omit<DraftContext, "contractor">;
