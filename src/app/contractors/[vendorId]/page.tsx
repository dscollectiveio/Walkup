import Link from "next/link";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted, money } from "@/components/ui";
import { listLinkedDocuments } from "@/lib/documents/access";
import { EntityDocuments } from "@/app/documents/entity-documents";
import { tradeBySlug, tradeLabel } from "@/lib/contractors/trades";
import { googleKey, googleMapsUrl, isStale } from "@/lib/google/places";
import { refreshGoogle } from "../vendor-actions";
import { EditVendorButton, type VendorRecord } from "../vendor-form";
import { ReviewForm } from "./review-form";
import { NotesEditor } from "./notes-editor";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  preferred: { label: "Preferred", className: "border-good-line bg-good-tint text-good-text" },
  okay: { label: "Okay", className: "border-line bg-fill text-mute" },
  do_not_use: { label: "Do not use", className: "border-bad-line bg-bad-tint text-bad-text" },
};

function Chip({ tone, children }: { tone: "warning" | "bad" | "good"; children: React.ReactNode }) {
  const cls =
    tone === "bad"
      ? "border-bad-line bg-bad-tint text-bad-text"
      : tone === "warning"
        ? "border-warning-line bg-warning-tint text-warning-text"
        : "border-good-line bg-good-tint text-good-text";
  return <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${cls}`}>{children}</span>;
}

export default async function ContractorPage({ params }: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("vendors")
    .select(
      "id, association_id, name, trades, contact_name, phone, email, website_url, address, status, do_not_use_reason, board_rating, entity_type, license_number, license_expires_on, insured_until, w9_on_file, w9_received_on, tin_last4, is_1099_exempt, notes, source, google_place_id, google_rating, google_review_count, google_fetched_at",
    )
    .eq("id", vendorId)
    .limit(1);
  const v = rows?.[0];
  if (!v) return <Restricted what="this contractor" />;

  const [
    { data: isBoardRes },
    { data: tickets },
    { data: expenses },
    { data: reviews },
    { data: persons },
    { data: associations },
    documents,
  ] = await Promise.all([
    supabase.rpc("is_board", { assoc: v.association_id }),
    supabase
      .from("tickets")
      .select("id, reference, title, opened_on, status, estimated_cost")
      .eq("assigned_vendor_id", vendorId)
      .order("opened_on", { ascending: false }),
    supabase
      .from("expenses")
      .select("id, paid_on, amount, memo, accounts(name)")
      .eq("vendor_id", vendorId)
      .order("paid_on", { ascending: false }),
    supabase
      .from("contractor_reviews")
      .select("id, rating, body, created_at, created_by, tickets(id, reference, title)")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false }),
    supabase.from("persons").select("full_name, auth_user_id"),
    supabase.from("associations").select("state_code").limit(1),
    listLinkedDocuments(supabase, "vendors", vendorId),
  ]);
  const canEdit = isBoardRes === true;

  // Google's rating goes stale after 30 days. Refresh after the response so the
  // page never waits on Google; the next visit shows the new figure.
  const googleStale = Boolean(v.google_place_id && googleKey() && isStale(v.google_fetched_at, new Date()));
  if (googleStale && canEdit) after(() => refreshGoogle(vendorId).then(() => undefined));

  const personByUser = new Map((persons ?? []).map((p) => [p.auth_user_id, p.full_name]));
  const today = new Date().toISOString().slice(0, 10);
  const totalPaid = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0);
  const dates = [...(tickets ?? []).map((t) => t.opened_on), ...(expenses ?? []).map((e) => e.paid_on)].filter(Boolean).sort();
  const reviewAvg =
    (reviews ?? []).length > 0 ? (reviews ?? []).reduce((s, r) => s + r.rating, 0) / (reviews ?? []).length : null;
  const badge = STATUS_BADGE[v.status] ?? STATUS_BADGE.okay;
  const stateCode = associations?.[0]?.state_code ?? null;
  const licenseLinks = (v.trades ?? [])
    .map((t: string) => ({ trade: t, url: stateCode ? tradeBySlug(t)?.licenseLookupUrl?.[stateCode] : undefined }))
    .filter((l: { url?: string }) => l.url);

  const paperwork: { tone: "warning" | "bad"; text: string }[] = [];
  if (!v.insured_until) paperwork.push({ tone: "warning", text: "No insurance certificate on file" });
  else if (v.insured_until < today) paperwork.push({ tone: "bad", text: `Insurance certificate expired ${v.insured_until}` });
  if (!v.license_number) paperwork.push({ tone: "warning", text: "No license number on file" });
  else if (v.license_expires_on && v.license_expires_on < today) {
    paperwork.push({ tone: "bad", text: `License expired ${v.license_expires_on}` });
  }
  if (!v.w9_on_file && !v.is_1099_exempt) paperwork.push({ tone: "warning", text: "No W-9 on file" });

  const record: VendorRecord = {
    id: v.id,
    name: v.name,
    trades: v.trades ?? [],
    contact_name: v.contact_name,
    phone: v.phone,
    email: v.email,
    website_url: v.website_url,
    address: v.address,
    status: v.status,
    do_not_use_reason: v.do_not_use_reason,
    board_rating: v.board_rating,
    entity_type: v.entity_type,
    license_number: v.license_number,
    license_expires_on: v.license_expires_on,
    insured_until: v.insured_until,
    w9_on_file: v.w9_on_file,
    w9_received_on: v.w9_received_on,
    tin_last4: v.tin_last4,
    is_1099_exempt: v.is_1099_exempt,
    notes: v.notes,
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/contractors" className="text-[13px] text-mute hover:underline">
          ← All contractors
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-[20px] font-bold tracking-tight text-ink">{v.name}</h1>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${badge.className}`}>{badge.label}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {(v.trades ?? []).map((t: string) => (
            <span key={t} className="rounded-full bg-fill px-2 py-0.5 text-[11px] text-mute">{tradeLabel(t)}</span>
          ))}
        </div>
        {v.status === "do_not_use" && v.do_not_use_reason ? (
          <p className="mt-3 border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
            The board decided not to use them: {v.do_not_use_reason}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {v.phone ? (
            <a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-[44px] items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid">
              Call {v.phone}
            </a>
          ) : null}
          {v.email ? (
            <a href={`mailto:${v.email}`} className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill">
              Email
            </a>
          ) : null}
          {v.website_url ? (
            <a href={v.website_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill">
              Website
            </a>
          ) : null}
          {canEdit ? <EditVendorButton vendor={record} /> : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Your building's rating">
          {v.board_rating === null && reviewAvg === null ? (
            <p className="text-[13px] text-mute">Not rated yet.</p>
          ) : (
            <div className="space-y-1 text-[13px]">
              {v.board_rating !== null ? (
                <div>
                  <span className="figures text-[22px] text-ink">{v.board_rating}</span>
                  <span className="text-mute"> of 5 · the board&rsquo;s rating</span>
                </div>
              ) : null}
              {reviewAvg !== null ? (
                <div className="text-mute">
                  Average of {(reviews ?? []).length} review{(reviews ?? []).length === 1 ? "" : "s"}:{" "}
                  <span className="figures text-ink">{reviewAvg.toFixed(1)}</span> of 5
                </div>
              ) : null}
            </div>
          )}
        </Card>
        <Card title="Google rating">
          {v.google_place_id ? (
            <div className="space-y-1 text-[13px]">
              {v.google_rating !== null ? (
                <div>
                  <span className="figures text-[22px] text-ink">{Number(v.google_rating).toFixed(1)}</span>
                  <span className="text-mute">
                    {" "}of 5{v.google_review_count !== null ? ` · ${v.google_review_count.toLocaleString("en-US")} reviews` : ""}
                  </span>
                </div>
              ) : (
                <p className="text-mute">No Google rating yet.</p>
              )}
              <a href={googleMapsUrl(v.google_place_id)} target="_blank" rel="noopener noreferrer" className="text-[12px] font-medium text-ink underline underline-offset-2">
                See on Google
              </a>
              {v.google_fetched_at ? (
                <p className="text-[11px] text-mute-soft">
                  Updated {new Date(v.google_fetched_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {googleStale ? " · refreshing" : ""}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-[13px] text-mute">Added by hand, so there&rsquo;s no Google listing linked.</p>
          )}
        </Card>
      </div>

      <Card title="Paperwork">
        {paperwork.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {paperwork.map((p) => (
              <Chip key={p.text} tone={p.tone}>{p.text}</Chip>
            ))}
          </div>
        ) : (
          <div className="mb-3">
            <Chip tone="good">Paperwork is in order</Chip>
          </div>
        )}
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-[11px] text-mute">License</dt>
            <dd className="text-ink">
              {v.license_number ?? "—"}
              {v.license_expires_on ? <span className="text-mute"> · expires {v.license_expires_on}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-mute">Insurance certificate</dt>
            <dd className="text-ink">{v.insured_until ? `Expires ${v.insured_until}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-mute">W-9</dt>
            <dd className="text-ink">
              {v.w9_on_file
                ? `On file${v.w9_received_on ? ` since ${v.w9_received_on}` : ""}${v.tin_last4 ? ` · tax ID ending ${v.tin_last4}` : ""}`
                : v.is_1099_exempt
                  ? "Not needed — 1099-exempt"
                  : "Not on file"}
            </dd>
          </div>
          {licenseLinks.length > 0 ? (
            <div>
              <dt className="text-[11px] text-mute">Check license</dt>
              <dd className="flex flex-wrap gap-3">
                {licenseLinks.map((l: { trade: string; url?: string }) => (
                  <a key={l.trade} href={l.url} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
                    {tradeLabel(l.trade)}
                  </a>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-4 border-t border-line pt-4">
          <EntityDocuments targetTable="vendors" targetId={v.id} documents={documents} canWrite={canEdit} />
        </div>
      </Card>

      <Card title="History" hint={dates.length > 0 ? `First hired ${dates[0]} · last used ${dates[dates.length - 1]}` : undefined}>
        {(tickets ?? []).length === 0 && (expenses ?? []).length === 0 ? (
          <Empty>No repairs or payments linked yet.</Empty>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-[12px] font-medium uppercase tracking-wide text-mute">Repairs</h3>
              {(tickets ?? []).length === 0 ? (
                <p className="mt-2 text-[13px] text-mute">None linked.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line text-[13px]">
                  {(tickets ?? []).map((t) => (
                    <li key={t.id} className="flex justify-between gap-3 py-2">
                      <Link href={`/maintenance/${t.id}`} className="text-ink underline-offset-2 hover:underline">
                        #{t.reference} {t.title}
                      </Link>
                      <span className="shrink-0 text-mute">
                        {t.opened_on}
                        {t.estimated_cost ? ` · est. ${money(t.estimated_cost)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-[12px] font-medium uppercase tracking-wide text-mute">
                Payments · {money(totalPaid)} total
              </h3>
              {(expenses ?? []).length === 0 ? (
                <p className="mt-2 text-[13px] text-mute">None linked.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line text-[13px]">
                  {(expenses ?? []).map((e) => (
                    <li key={e.id} className="flex justify-between gap-3 py-2">
                      <span className="text-ink">
                        {e.paid_on}
                        <span className="ml-2 text-mute">
                          {(e.accounts as unknown as { name: string } | null)?.name ?? ""}
                          {e.memo ? ` · ${e.memo}` : ""}
                        </span>
                      </span>
                      <span className="figures shrink-0 text-ink">{money(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card title="Reviews from the board">
        {(reviews ?? []).length === 0 ? (
          <p className="mb-3 text-[13px] text-mute">No reviews yet.</p>
        ) : (
          <ul className="mb-4 space-y-3">
            {(reviews ?? []).map((r) => {
              const ticket = r.tickets as unknown as { id: string; reference: number; title: string } | null;
              return (
                <li key={r.id} className="border-l-2 border-line pl-3 text-[13px]">
                  <div className="text-brass" aria-label={`${r.rating} of 5`}>
                    {"★".repeat(r.rating)}
                    <span className="text-line-strong">{"★".repeat(5 - r.rating)}</span>
                  </div>
                  {r.body ? <p className="mt-1 whitespace-pre-wrap text-ink">{r.body}</p> : null}
                  <p className="mt-1 text-[11px] text-mute-soft">
                    {personByUser.get(r.created_by) ?? "A board member"} · {new Date(r.created_at).toLocaleDateString()}
                    {ticket ? (
                      <>
                        {" · "}
                        <Link href={`/maintenance/${ticket.id}`} className="underline underline-offset-2">
                          #{ticket.reference} {ticket.title}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {canEdit ? (
          <ReviewForm vendorId={v.id} tickets={(tickets ?? []).map((t) => ({ id: t.id, label: `#${t.reference} ${t.title}` }))} />
        ) : null}
      </Card>

      <Card title="Notes" hint="Internal to the board.">
        <NotesEditor vendorId={v.id} notes={v.notes} canEdit={canEdit} />
      </Card>
    </div>
  );
}
