import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { money } from "@/components/ui";
import type { MergedRow } from "./summary";
import { lastColumn, lastColumnLabel, shownAmount, type Report } from "./report";

// Walkup's palette.
const NAVY = "#1F2B45";
const NAVY_TEXT = "#B9C1D6";
const CREAM = "#F3EEE3";
const CREAM_DARK = "#E7DFCC";
const TINT = "#FAF8F3";
const GOLD = "#C9A24D";
const INK = "#1F2B45";
const MUTE = "#5B6272";
const LINE = "#E4DDCC";
const LINE_STRONG = "#B9B09A";
const GOOD = "#2F6B4F";
const GOOD_TINT = "#E8F1EA";
const BAD = "#8A2A1F";
const BAD_TINT = "#F6E6E3";

const styles = StyleSheet.create({
  page: { paddingTop: 0, paddingBottom: 54, paddingHorizontal: 0, fontSize: 9.5, fontFamily: "Helvetica", color: INK },
  banner: { backgroundColor: NAVY, paddingHorizontal: 40, paddingTop: 30, paddingBottom: 22 },
  bannerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  kicker: { fontSize: 8, letterSpacing: 1.6, color: GOLD, textTransform: "uppercase", marginBottom: 7, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 21, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },
  subtitle: { fontSize: 11.5, color: NAVY_TEXT, marginTop: 5 },
  prepared: { fontSize: 8, color: NAVY_TEXT, textAlign: "right" },
  goldRule: { height: 3, backgroundColor: GOLD },
  body: { paddingHorizontal: 40, paddingTop: 20 },
  cards: { flexDirection: "row", gap: 10, marginBottom: 20 },
  card: { flex: 1, borderWidth: 0.75, borderColor: LINE, borderRadius: 4, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: TINT },
  cardLabel: { fontSize: 7.5, letterSpacing: 1.1, textTransform: "uppercase", color: MUTE, fontFamily: "Helvetica-Bold" },
  cardValue: { fontSize: 17, fontFamily: "Helvetica-Bold", marginTop: 5 },
  cardSub: { fontSize: 8, color: MUTE, marginTop: 3 },
  headerRow: { flexDirection: "row", backgroundColor: CREAM_DARK, paddingVertical: 7, borderBottomWidth: 1.5, borderBottomColor: LINE_STRONG },
  headerCell: { fontFamily: "Helvetica-Bold", color: NAVY, fontSize: 8.5 },
  band: { backgroundColor: CREAM, paddingVertical: 6, paddingHorizontal: 8, marginTop: 10 },
  bandText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: MUTE, textTransform: "uppercase", letterSpacing: 1 },
  row: { flexDirection: "row", paddingVertical: 5.5, borderBottomWidth: 0.5, borderBottomColor: LINE },
  totalRow: { flexDirection: "row", paddingVertical: 7, backgroundColor: TINT, borderTopWidth: 1.5, borderTopColor: LINE_STRONG, borderBottomWidth: 0.5, borderBottomColor: LINE },
  netRow: { flexDirection: "row", paddingVertical: 10, marginTop: 14, borderTopWidth: 1.5, borderTopColor: NAVY, borderBottomWidth: 1.5, borderBottomColor: NAVY },
  account: { flex: 1, paddingLeft: 8 },
  bold: { fontFamily: "Helvetica-Bold" },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: MUTE,
    borderTopWidth: 0.75,
    borderTopColor: GOLD,
    paddingTop: 6,
  },
});

export function FinancialStatementPdf({ report, view }: { report: Report; view: "total" | "expenses" }) {
  const multi = report.labels.length > 1;
  const wide = report.labels.length > 4;
  const colWidth = multi ? Math.max(54, Math.min(88, (wide ? 680 : 440) / (report.labels.length + 1) - 4)) : 110;
  const fontSize = multi && report.labels.length > 6 ? 8 : 9.5;
  const title = view === "total" ? "Profit & Loss" : "Expenses";
  const netTotal = lastColumn(report, report.netTotals);
  const netBad = report.compare ? false : (netTotal ?? 0) < 0;
  const generated = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const fmt = (n: number | null) => (n === null ? "—" : money(n));
  /** A difference carries its sign so the direction is plain. */
  const signed = (n: number | null) => (n === null ? "—" : n < 0 ? `−${money(-n)}` : n > 0 ? `+${money(n)}` : money(0));
  const lastIsDiff = report.compare;
  const amtBase = { width: colWidth, textAlign: "right" as const, fontSize, paddingHorizontal: 7, borderLeftWidth: 0.5, borderLeftColor: LINE };

  const cells = (amounts: number[], opts: { bold?: boolean; color?: string; tintLast?: boolean } = {}) => {
    const color = opts.color ? { color: opts.color } : {};
    const last = multi ? lastColumn(report, amounts) : shownAmount(report, 0, amounts[0]);
    return (
      <>
        {multi
          ? amounts.map((a, i) => (
              <Text key={i} style={[amtBase, opts.bold ? styles.bold : {}, color]}>
                {fmt(shownAmount(report, i, a))}
              </Text>
            ))
          : null}
        <Text
          style={[
            amtBase,
            opts.bold || multi ? styles.bold : {},
            color,
            opts.tintLast ? { backgroundColor: TINT } : {},
            { paddingRight: 8 },
          ]}
        >
          {multi && lastIsDiff ? signed(last) : fmt(last)}
        </Text>
      </>
    );
  };

  const lines = (rows: MergedRow[]) =>
    rows.length === 0 ? (
      <View style={styles.row}>
        <Text style={[styles.account, { color: MUTE }]}>Nothing posted in this period.</Text>
      </View>
    ) : (
      rows.map((r) => (
        <View key={r.account_id} style={styles.row} wrap={false}>
          <Text style={[styles.account, { paddingLeft: 18 }]}>{r.account_name}</Text>
          {cells(r.amounts, { tintLast: true })}
        </View>
      ))
    );

  const total = (label: string, totals: number[]) => (
    <View style={styles.totalRow} wrap={false}>
      <Text style={[styles.account, { paddingLeft: 18 }, styles.bold, { color: NAVY }]}>{label}</Text>
      {cells(totals, { bold: true, color: NAVY })}
    </View>
  );

  const section = (label: string) => (
    <View style={styles.band} wrap={false}>
      <Text style={styles.bandText}>{label}</Text>
    </View>
  );

  const sumOf = (xs: number[]) => lastColumn(report, xs);
  const card = (label: string, totals: number[], tone?: "good" | "bad") => {
    const color = tone === "bad" ? BAD : tone === "good" ? GOOD : NAVY;
    const first = report.compare ? shownAmount(report, 0, totals[0]) : sumOf(totals);
    const sub = report.compare
      ? shownAmount(report, 1, totals[1]) === null
        ? `no posted data in ${report.labels[1]}`
        : `vs. ${fmt(shownAmount(report, 1, Math.abs(totals[1])))} in ${report.labels[1]}`
      : multi
        ? `across ${report.labels.length} periods`
        : report.rangeLabel;
    return (
      <View style={[styles.card, tone === "bad" ? { backgroundColor: BAD_TINT } : tone === "good" ? { backgroundColor: GOOD_TINT } : {}]}>
        <Text style={styles.cardLabel}>{label}</Text>
        <Text style={[styles.cardValue, { color }]}>{fmt(first === null ? null : tone === "bad" ? Math.abs(first) : first)}</Text>
        <Text style={styles.cardSub}>{sub}</Text>
      </View>
    );
  };
  // The headline number the cards lead with: first column when comparing, the overall figure otherwise.
  const headlineNet = report.compare ? report.netTotals[0] : (sumOf(report.netTotals) ?? 0);
  const headlineBad = headlineNet < 0;

  return (
    <Document title={`${report.associationName} - ${title} - ${report.rangeLabel}`} author="Walkup">
      <Page size="LETTER" orientation={wide ? "landscape" : "portrait"} style={styles.page}>
        <View>
          <View style={styles.banner}>
            <View style={styles.bannerTop}>
              <View>
                <Text style={styles.kicker}>{title}</Text>
                <Text style={styles.title}>{report.associationName}</Text>
                <Text style={styles.subtitle}>{report.rangeLabel}</Text>
              </View>
              <Text style={styles.prepared}>Prepared {generated}</Text>
            </View>
          </View>
          <View style={styles.goldRule} />
        </View>

        <View style={styles.body}>
          <View style={styles.cards} wrap={false}>
            {view === "total" ? (
              <>
                {card("Total income", report.incomeTotals)}
                {card("Total expenses", report.expenseTotals)}
                {card(headlineBad ? "Deficit" : "Excess", report.netTotals, headlineBad ? "bad" : "good")}
              </>
            ) : (
              card("Total expenses", report.expenseTotals)
            )}
          </View>

          <View style={styles.headerRow} fixed>
            <Text style={[styles.headerCell, styles.account]}>Category</Text>
            {multi
              ? report.labels.map((l) => (
                  <Text key={l} style={[styles.headerCell, amtBase, { fontSize: 8.5 }]}>
                    {l}
                  </Text>
                ))
              : null}
            <Text style={[styles.headerCell, amtBase, { fontSize: 8.5, paddingRight: 8 }]}>{multi ? lastColumnLabel(report) : "Amount"}</Text>
          </View>

          {view === "total" ? (
            <>
              {section("Income")}
              {lines(report.income)}
              {total("Total income", report.incomeTotals)}
              {section("Expenses")}
              {lines(report.expenses)}
              {total("Total expenses", report.expenseTotals)}
              <View style={[styles.netRow, { backgroundColor: report.compare ? CREAM : netBad ? BAD_TINT : GOOD_TINT }]} wrap={false}>
                <Text style={[styles.account, styles.bold, { color: report.compare ? NAVY : netBad ? BAD : GOOD, fontSize: 11.5 }]}>
                  {(report.compare ? report.netTotals[0] < 0 : netBad) ? "Deficit" : "Excess"}
                </Text>
                {multi
                  ? report.netTotals.map((n, i) => (
                      <Text key={i} style={[amtBase, styles.bold, { color: n < 0 ? BAD : GOOD, fontSize: 11 }]}>
                        {fmt(shownAmount(report, i, Math.abs(n)))}
                      </Text>
                    ))
                  : null}
                <Text style={[amtBase, styles.bold, { paddingRight: 8, color: report.compare ? NAVY : netBad ? BAD : GOOD, fontSize: 11.5 }]}>
                  {multi
                    ? report.compare
                      ? signed(netTotal)
                      : fmt(netTotal === null ? null : Math.abs(netTotal))
                    : fmt(shownAmount(report, 0, Math.abs(report.netTotals[0])))}
                </Text>
              </View>
            </>
          ) : (
            <>
              {section("Expenses")}
              {lines(report.expenses)}
              {total("Total expenses", report.expenseTotals)}
            </>
          )}
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {report.associationName} · Prepared {generated} from posted bank transactions
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
