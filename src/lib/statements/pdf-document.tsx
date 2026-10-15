import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { longDate } from "@/lib/dates";
import { LEGAL_ENTITY, SITE_URL } from "@/lib/site-config";
import { formatBalanceWords, formatMoney, isZero } from "@/lib/email-outbox/format";
import type { StatementLine } from "@/lib/owner/statement";
import { rangeLabel } from "./period";
import type { StatementData } from "./data";

const NAVY = "#1B2A41";
const NAVY_SOFT = "#E8EDF6";
const INK = "#1B2437";
const MUTE = "#6A7488";
const LINE = "#D9DEE8";
const ZEBRA = "#F6F8FB";

const styles = StyleSheet.create({
  page: { paddingTop: 0, paddingBottom: 56, fontSize: 9.5, fontFamily: "Helvetica", color: INK },
  pageNext: { paddingTop: 36, paddingBottom: 56, fontSize: 9.5, fontFamily: "Helvetica", color: INK },
  banner: { backgroundColor: NAVY, paddingHorizontal: 40, paddingTop: 28, paddingBottom: 20, marginBottom: 18, flexDirection: "row", justifyContent: "space-between" },
  kicker: { fontSize: 8, letterSpacing: 1.2, color: "#C9D1E0", marginBottom: 6 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },
  subtitle: { fontSize: 11, color: "#D8DEEA", marginTop: 4 },
  assoc: { fontSize: 11, color: "#FFFFFF", textAlign: "right", maxWidth: 220 },
  body: { paddingHorizontal: 40 },
  meta: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  metaCol: { width: "48%" },
  metaLabel: { fontSize: 8, color: MUTE, marginBottom: 2 },
  metaValue: { fontSize: 10, marginBottom: 8 },
  strip: { flexDirection: "row", marginBottom: 16 },
  box: { flex: 1, backgroundColor: NAVY_SOFT, paddingVertical: 8, paddingHorizontal: 8, marginRight: 6, borderRadius: 3 },
  boxLabel: { fontSize: 7.5, color: NAVY, fontFamily: "Helvetica-Bold" },
  boxValue: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 4 },
  headerRow: { flexDirection: "row", backgroundColor: NAVY_SOFT, height: 20, alignItems: "center", paddingHorizontal: 6 },
  headerCell: { fontFamily: "Helvetica-Bold", color: NAVY, fontSize: 8.5 },
  row: { flexDirection: "row", height: 18, alignItems: "center", paddingHorizontal: 6 },
  cDate: { width: 62 },
  cWhat: { flex: 1, paddingRight: 6 },
  cAmt: { width: 70, textAlign: "right" },
  cBal: { width: 80, textAlign: "right" },
  how: { marginTop: 14, padding: 10, borderWidth: 0.5, borderColor: LINE, borderRadius: 3 },
  howTitle: { fontFamily: "Helvetica-Bold", color: NAVY, marginBottom: 3 },
  note: { marginTop: 10, color: MUTE, fontSize: 8.5 },
  footer: { position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: MUTE, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 6 },
  footerLine: { position: "absolute", bottom: 8, left: 40, right: 40, fontSize: 7.5, color: MUTE },
  bold: { fontFamily: "Helvetica-Bold" },
});

// Fixed-height rows make the page breaks deterministic: the first page carries the
// banner and summary, so it holds fewer rows. The closing box needs about seven rows.
export const FIRST_PAGE_ROWS = 21;
export const NEXT_PAGE_ROWS = 34;
const CLOSING_ROWS = 7;

export function paginate<T>(rows: T[]): { pages: T[][]; boxOnOwnPage: boolean } {
  const pages: T[][] = [];
  let i = 0;
  let cap = FIRST_PAGE_ROWS;
  do {
    pages.push(rows.slice(i, i + cap));
    i += cap;
    cap = NEXT_PAGE_ROWS;
  } while (i < rows.length);
  const last = pages[pages.length - 1];
  const capacity = pages.length === 1 ? FIRST_PAGE_ROWS : NEXT_PAGE_ROWS;
  const boxOnOwnPage = capacity - last.length < CLOSING_ROWS;
  return { pages, boxOnOwnPage };
}

/** Plain strings only, ASCII-folded where the core font cannot draw a character (the P&L PDF does the same). */
export function pdfText(s: string): string {
  return String(s ?? "")
    .normalize("NFC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x09\x0a\x20-\x7e\u00a0-\u00ff]/g, "?");
}

function lineAmounts(l: StatementLine): { charge: string; paid: string } {
  if (l.kind === "charge") return { charge: formatMoney(l.charge ?? "0.00"), paid: "" };
  if (l.kind === "payment") return { charge: "", paid: formatMoney(l.payment ?? "0.00") };
  if (l.kind === "waiver" || l.kind === "write_off") return { charge: "", paid: formatMoney(l.adjustment ?? "0.00") };
  return { charge: "", paid: "" };
}

function Footer({ data }: { data: StatementData }) {
  return (
    <>
      <View style={styles.footer} fixed>
        <Text>{pdfText(`${data.associationName} - Statement for ${data.unit.label}`)}</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
      <Text style={styles.footerLine} fixed>
        {pdfText(`Prepared by Walkup, operated by ${LEGAL_ENTITY}. Walkup does not hold or move money.`)}
      </Text>
    </>
  );
}

function TableHeader() {
  return (
    <View style={styles.headerRow}>
      <Text style={[styles.headerCell, styles.cDate]}>Date</Text>
      <Text style={[styles.headerCell, styles.cWhat]}>What</Text>
      <Text style={[styles.headerCell, styles.cAmt]}>Charged</Text>
      <Text style={[styles.headerCell, styles.cAmt]}>Paid</Text>
      <Text style={[styles.headerCell, styles.cBal]}>Balance</Text>
    </View>
  );
}

function Rows({ lines }: { lines: StatementLine[] }) {
  return (
    <>
      {lines.map((l, i) => {
        const a = lineAmounts(l);
        return (
          <View key={l.seq} style={[styles.row, i % 2 === 1 ? { backgroundColor: ZEBRA } : {}]}>
            <Text style={styles.cDate}>{l.line_date ? longDateShort(l.line_date) : ""}</Text>
            <Text style={styles.cWhat}>{pdfText(l.description).slice(0, 62)}</Text>
            <Text style={styles.cAmt}>{a.charge}</Text>
            <Text style={styles.cAmt}>{a.paid}</Text>
            <Text style={styles.cBal}>{formatBalanceWords(l.balance)}</Text>
          </View>
        );
      })}
    </>
  );
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function longDateShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso;
}

function ClosingBox({ data, annual }: { data: StatementData; annual: boolean }) {
  return (
    <View wrap={false}>
      <View style={styles.how}>
        <Text style={styles.howTitle}>How to pay</Text>
        <Text>{pdfText(data.paymentNote)}</Text>
        <Text>{`${SITE_URL}/owner/pay`}</Text>
      </View>
      {annual ? <Text style={styles.note}>This is a record of your account. It is not a tax document.</Text> : null}
    </View>
  );
}

export function OwnerStatementPdf({ data, annual }: { data: StatementData; annual: boolean }) {
  const { totals } = data;
  const label = rangeLabel(data.from, data.to, data.allHistory);
  const rows = data.lines.filter((l) => l.kind !== "opening");
  const opening = data.lines.find((l) => l.kind === "opening");
  const tableRows: StatementLine[] = opening ? [opening, ...rows] : rows;
  const { pages, boxOnOwnPage } = paginate(tableRows);
  const boxes: { label: string; value: string }[] = [
    { label: "Balance at the start", value: formatBalanceWords(totals.opening) },
    { label: "Charged", value: formatMoney(totals.charges) },
    { label: "Paid", value: formatMoney(totals.payments) },
  ];
  if (!isZero(totals.adjustments)) boxes.push({ label: "Waived or written off", value: formatMoney(totals.adjustments) });
  boxes.push({ label: "Balance at the end", value: formatBalanceWords(totals.closing) });

  return (
    <Document title={pdfText(`${data.unit.label} statement ${label}`)} author="Walkup" producer="Walkup">
      {pages.map((chunk, pi) => {
        const first = pi === 0;
        const last = pi === pages.length - 1;
        return (
          <Page key={pi} size="LETTER" style={first ? styles.page : styles.pageNext}>
            {first ? (
              <>
                <View style={styles.banner}>
                  <View>
                    <Text style={styles.kicker}>{annual ? "ANNUAL STATEMENT" : "STATEMENT"}</Text>
                    <Text style={styles.title}>{pdfText(data.unit.label)}</Text>
                    <Text style={styles.subtitle}>{label}</Text>
                  </View>
                  <Text style={styles.assoc}>{pdfText(data.associationName)}</Text>
                </View>
                <View style={styles.body}>
                  <View style={styles.meta}>
                    <View style={styles.metaCol}>
                      <Text style={styles.metaLabel}>Prepared for</Text>
                      <Text style={styles.metaValue}>{pdfText(data.ownerNames.join(", ") || data.unit.label)}</Text>
                      {data.mailingAddress ? (
                        <>
                          <Text style={styles.metaLabel}>Mailing address</Text>
                          <Text style={styles.metaValue}>{pdfText(data.mailingAddress)}</Text>
                        </>
                      ) : null}
                    </View>
                    <View style={styles.metaCol}>
                      <Text style={styles.metaLabel}>Date prepared</Text>
                      <Text style={styles.metaValue}>{longDate(data.generatedOn)}</Text>
                      <Text style={styles.metaLabel}>Statement period</Text>
                      <Text style={styles.metaValue}>{data.allHistory ? `All activity through ${longDate(data.to)}` : `${longDate(data.from)} to ${longDate(data.to)}`}</Text>
                    </View>
                  </View>
                  <View style={styles.strip}>
                    {boxes.map((b) => (
                      <View key={b.label} style={styles.box}>
                        <Text style={styles.boxLabel}>{b.label}</Text>
                        <Text style={styles.boxValue}>{b.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </>
            ) : null}
            <View style={styles.body}>
              <TableHeader />
              <Rows lines={chunk} />
              {tableRows.length === 0 ? <Text style={styles.note}>Nothing was charged or paid in this period.</Text> : null}
              {last && !boxOnOwnPage ? <ClosingBox data={data} annual={annual} /> : null}
            </View>
            <Footer data={data} />
          </Page>
        );
      })}
      {boxOnOwnPage ? (
        <Page size="LETTER" style={styles.pageNext}>
          <View style={styles.body}>
            <ClosingBox data={data} annual={annual} />
          </View>
          <Footer data={data} />
        </Page>
      ) : null}
    </Document>
  );
}
