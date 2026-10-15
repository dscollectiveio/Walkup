import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { longDate } from "@/lib/dates";
import { formatMoney } from "@/lib/email-outbox/format";
import { pdfText } from "./pdf-document";
import type { LateFeeLetterData } from "./data";

const styles = StyleSheet.create({
  page: { padding: 56, fontSize: 11, fontFamily: "Helvetica", color: "#1B2437", lineHeight: 1.45 },
  letterhead: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#1B2A41", marginBottom: 28 },
  block: { marginBottom: 16 },
  footer: { position: "absolute", bottom: 32, left: 56, right: 56, fontSize: 8.5, color: "#6A7488" },
});

/**
 * The late fee notice as a letter to print and post by hand (money spec 8.5).
 * The two sentences of the email, the board contact, no signature block, and
 * nothing about why the fee was allowed or what happens next.
 */
export function LateFeeLetterPdf({ data }: { data: LateFeeLetterData }) {
  const contact = [data.boardContact.name, data.boardContact.email, data.boardContact.phone].filter(Boolean).join(", ");
  return (
    <Document title={pdfText(`Late fee notice ${data.unitLabel}`)} author="Walkup" producer="Walkup">
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.letterhead}>{pdfText(data.associationName)}</Text>
        <Text style={styles.block}>{longDate(data.generatedOn)}</Text>
        <View style={styles.block}>
          <Text>{pdfText(data.ownerName)}</Text>
          {data.mailingAddress ? <Text>{pdfText(data.mailingAddress)}</Text> : <Text>{pdfText(data.unitLabel)}</Text>}
        </View>
        <Text style={styles.block}>{pdfText(`Late fee on ${data.unitLabel}`)}</Text>
        <Text style={styles.block}>
          {pdfText(`${data.associationName} charged a late fee of ${formatMoney(data.feeAmount)} to ${data.unitLabel} on ${longDate(data.feeChargedOn)}.`)}
        </Text>
        <Text style={styles.block}>{pdfText(`Your balance for ${data.unitLabel}, including that fee, is ${formatMoney(data.owed)}.`)}</Text>
        <Text style={styles.block}>If you think the fee was charged by mistake, please write back and tell us why.</Text>
        {contact ? <Text style={styles.block}>{pdfText(`Questions: ${contact}`)}</Text> : null}
        <Text style={styles.footer}>Prepared by Walkup. Walkup does not give legal advice.</Text>
      </Page>
    </Document>
  );
}
