import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { money } from "@/components/ui";
import type { MergedRow } from "./summary";
import type { Report } from "./report";

const NAVY = "#14284B";
const NAVY_SOFT = "#E8EDF6";
const INK = "#1B2437";
const MUTE = "#6A7488";
const LINE = "#D9DEE8";
const ZEBRA = "#F6F8FB";
const GOOD = "#1F7A4D";
const GOOD_TINT = "#E6F4EC";
const BAD = "#B3382C";
const BAD_TINT = "#FBEAE7";

const styles = StyleSheet.create({
  page: { paddingTop: 0, paddingBottom: 48, paddingHorizontal: 0, fontSize: 9.5, fontFamily: "Helvetica", color: INK },
  banner: { backgroundColor: NAVY, paddingHorizontal: 40, paddingTop: 30, paddingBottom: 22, marginBottom: 22 },
  kicker: { fontSize: 8, letterSpacing: 1.2, color: "#9FB0D4", textTransform: "uppercase", marginBottom: 6 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },
  subtitle: { fontSize: 11, color: "#C9D4EC", marginTop: 4 },
  body: { paddingHorizontal: 40 },
  headerRow: { flexDirection: "row", backgroundColor: NAVY_SOFT, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 3 },
  headerCell: { fontFamily: "Helvetica-Bold", color: NAVY, fontSize: 8.5 },
  band: { marginTop: 14, paddingVertical: 4, paddingHorizontal: 8, borderLeftWidth: 3, borderLeftColor: NAVY },
  bandText: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: NAVY, textTransform: "uppercase", letterSpacing: 0.8 },
  row: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 8 },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: NAVY,
    marginTop: 2,
  },
  netRow: { flexDirection: "row", paddingVertical: 9, paddingHorizontal: 8, marginTop: 12, borderRadius: 3 },
  account: { flex: 1 },
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
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    paddingTop: 6,
  },
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function FinancialStatementPdf({ report, view }: { report: Report; view: "total" | "expenses" }) {
  const multi = report.labels.length > 1;
  const wide = report.labels.length > 4;
  const colWidth = multi ? Math.max(50, Math.min(84, (wide ? 680 : 440) / (report.labels.length + 1) - 4)) : 96;
  const fontSize = multi && report.labels.length > 6 ? 8 : 9.5;
  const amt = { width: colWidth, textAlign: "right" as const, fontSize };
  const title = view === "total" ? "Profit & Loss" : "Expenses";
  const netTotal = sum(report.netTotals);
  const generated = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const cells = (amounts: number[], total: number, opts: { bold?: boolean; color?: string } = {}) => (
    <>
      {multi
        ? amounts.map((a, i) => (
            <Text key={i} style={[amt, opts.bold ? styles.bold : {}, opts.color ? { color: opts.color } : {}]}>
              {money(a)}
            </Text>
          ))
        : null}
      <Text style={[amt, opts.bold || multi ? styles.bold : {}, opts.color ? { color: opts.color } : {}]}>
        {money(total)}
      </Text>
    </>
  );

  const lines = (rows: MergedRow[]) =>
    rows.length === 0 ? (
      <View style={styles.row}>
        <Text style={{ color: MUTE }}>Nothing posted in this period.</Text>
      </View>
    ) : (
      rows.map((r, i) => (
        <View key={r.account_id} style={[styles.row, i % 2 === 1 ? { backgroundColor: ZEBRA } : {}]} wrap={false}>
          <Text style={styles.account}>{r.account_name}</Text>
          {cells(r.amounts, r.total)}
        </View>
      ))
    );

  const total = (label: string, totals: number[]) => (
    <View style={styles.totalRow} wrap={false}>
      <Text style={[styles.account, styles.bold, { color: NAVY }]}>{label}</Text>
      {cells(totals, sum(totals), { bold: true, color: NAVY })}
    </View>
  );

  const section = (label: string) => (
    <View style={styles.band}>
      <Text style={styles.bandText}>{label}</Text>
    </View>
  );

  return (
    <Document title={`${report.associationName} - ${title} - ${report.rangeLabel}`} author="Walkup">
      <Page size="LETTER" orientation={wide ? "landscape" : "portrait"} style={styles.page}>
        <View style={styles.banner}>
          <Text style={styles.kicker}>{title}</Text>
          <Text style={styles.title}>{report.associationName}</Text>
          <Text style={styles.subtitle}>{report.rangeLabel}</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.headerRow} fixed>
            <Text style={[styles.headerCell, styles.account]}>Account</Text>
            {multi ? report.labels.map((l) => <Text key={l} style={[styles.headerCell, amt]}>{l}</Text>) : null}
            <Text style={[styles.headerCell, amt]}>{multi ? "Total" : "Amount"}</Text>
          </View>

          {view === "total" ? (
            <>
              {section("Income")}
              {lines(report.income)}
              {total("Total income", report.incomeTotals)}
              {section("Expenses")}
              {lines(report.expenses)}
              {total("Total expenses", report.expenseTotals)}
              <View style={[styles.netRow, { backgroundColor: netTotal < 0 ? BAD_TINT : GOOD_TINT }]} wrap={false}>
                <Text style={[styles.account, styles.bold, { color: netTotal < 0 ? BAD : GOOD, fontSize: 11 }]}>
                  {netTotal < 0 ? "Net income (short)" : "Net income"}
                </Text>
                {multi
                  ? report.netTotals.map((n, i) => (
                      <Text key={i} style={[amt, styles.bold, { color: n < 0 ? BAD : GOOD }]}>
                        {money(n)}
                      </Text>
                    ))
                  : null}
                <Text style={[amt, styles.bold, { color: netTotal < 0 ? BAD : GOOD, fontSize: 11 }]}>
                  {money(netTotal)}
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
