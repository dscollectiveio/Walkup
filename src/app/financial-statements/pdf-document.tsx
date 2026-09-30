import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { money } from "@/components/ui";
import type { Statement } from "./data";
import type { ViewMode } from "./periods";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 11, color: "#6E7385", marginBottom: 20 },
  sectionLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#6E7385",
    textTransform: "uppercase",
    marginTop: 14,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#DCD8CF",
    paddingBottom: 4,
    marginBottom: 2,
  },
  headerCell: { fontFamily: "Helvetica-Bold", color: "#6E7385", fontSize: 9 },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#EDEAE3",
    paddingVertical: 4,
  },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#DCD8CF",
    paddingTop: 4,
    marginTop: 2,
  },
  netRow: {
    flexDirection: "row",
    borderTopWidth: 2,
    borderTopColor: "#C9C4B8",
    paddingTop: 6,
    marginTop: 8,
  },
  code: { width: 60 },
  account: { flex: 1 },
  amount: { width: 90, textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
});

export function FinancialStatementPdf({
  associationName,
  view,
  statement,
}: {
  associationName: string;
  view: ViewMode;
  statement: Statement;
}) {
  const { bounds, incomeRows, expenseRows, totalIncome, totalExpenses, netIncome } = statement;
  const title = view === "total" ? "Profit & Loss" : "Expenses";

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{associationName}</Text>
        <Text style={styles.subtitle}>
          {title} — {bounds?.label ?? ""}
        </Text>

        <View style={styles.headerRow}>
          <Text style={[styles.headerCell, styles.code]}>Code</Text>
          <Text style={[styles.headerCell, styles.account]}>Account</Text>
          <Text style={[styles.headerCell, styles.amount]}>Amount</Text>
        </View>

        {view === "total" ? (
          <>
            <Text style={styles.sectionLabel}>Income</Text>
            {incomeRows.map((r) => (
              <View key={r.account_id} style={styles.row}>
                <Text style={styles.code}>{r.code}</Text>
                <Text style={styles.account}>{r.account_name}</Text>
                <Text style={styles.amount}>{money(r.amount)}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={[styles.account, styles.bold]}>Total income</Text>
              <Text style={[styles.amount, styles.bold]}>{money(totalIncome)}</Text>
            </View>

            <Text style={styles.sectionLabel}>Expenses</Text>
            {expenseRows.map((r) => (
              <View key={r.account_id} style={styles.row}>
                <Text style={styles.code}>{r.code}</Text>
                <Text style={styles.account}>{r.account_name}</Text>
                <Text style={styles.amount}>{money(r.amount)}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={[styles.account, styles.bold]}>Total expenses</Text>
              <Text style={[styles.amount, styles.bold]}>{money(totalExpenses)}</Text>
            </View>

            <View style={styles.netRow}>
              <Text style={[styles.account, styles.bold]}>Net income</Text>
              <Text style={[styles.amount, styles.bold]}>{money(netIncome)}</Text>
            </View>
          </>
        ) : (
          <>
            {expenseRows.map((r) => (
              <View key={r.account_id} style={styles.row}>
                <Text style={styles.code}>{r.code}</Text>
                <Text style={styles.account}>{r.account_name}</Text>
                <Text style={styles.amount}>{money(r.amount)}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={[styles.account, styles.bold]}>Total expenses</Text>
              <Text style={[styles.amount, styles.bold]}>{money(totalExpenses)}</Text>
            </View>
          </>
        )}
      </Page>
    </Document>
  );
}
