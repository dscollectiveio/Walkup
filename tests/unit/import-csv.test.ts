import { describe, expect, it } from "vitest";
import { decodeCsvBytes, detectDelimiter, parseCsv, WINDOWS_TEXT_WARNING } from "@/lib/import/csv";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("parseCsv", () => {
  it("reads quotes, doubled quotes and every kind of line break inside quotes", () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak","cr\rhere"\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["line\nbreak", "cr\rhere"]]);
  });

  it("accepts CRLF, LF and CR row endings and a missing final newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r1,2\r")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("skips blank lines and keeps empty cells", () => {
    expect(parseCsv("a,b,c\n\n1,,3\n   ,  ,\n4,5,6")).toEqual([["a", "b", "c"], ["1", "", "3"], ["4", "5", "6"]]);
  });

  it("detects semicolon and tab delimiters, and ties go to comma", () => {
    expect(detectDelimiter("a;b;c\n1;2;3\n")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3\n")).toBe("\t");
    expect(detectDelimiter("a,b\n1,2\n")).toBe(",");
    expect(detectDelimiter("a\n1\n")).toBe(",");
    expect(detectDelimiter('"a;b;c",d\n"1;2;3",4\n')).toBe(",");
    expect(parseCsv("a;b\n1,5;2")).toEqual([["a", "b"], ["1,5", "2"]]);
  });

  it("passes ragged rows through for the caller to pad or flag", () => {
    expect(parseCsv("a,b\n1\n1,2,3")).toEqual([["a", "b"], ["1"], ["1", "2", "3"]]);
  });

  it("does not run away on an unterminated quote", () => {
    const rows = parseCsv('a,b\n"never closed,1\n2,3');
    expect(rows.length).toBe(2);
  });
});

describe("decodeCsvBytes", () => {
  it("strips a UTF-8 BOM", () => {
    const r = decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("Unit,Owner\n")]));
    expect(r.text).toBe("Unit,Owner\n");
    expect(r.warnings).toEqual([]);
  });

  it("reads UTF-8 with accents without a warning", () => {
    expect(decodeCsvBytes(bytes("Zoë,Müller\n")).text).toBe("Zoë,Müller\n");
  });

  it("falls back to Windows-1252 when the bytes are not valid UTF-8, and says so", () => {
    // "José" saved by old Excel: 0xE9 is e-acute in Windows-1252 and invalid UTF-8 here.
    const r = decodeCsvBytes(new Uint8Array([0x4a, 0x6f, 0x73, 0xe9, 0x2c, 0x31]));
    expect(r.text).toBe("José,1");
    expect(r.warnings).toEqual([WINDOWS_TEXT_WARNING]);
  });

  it("reads UTF-16 (Excel's Unicode Text) from its byte order mark", () => {
    const le = new Uint8Array([0xff, 0xfe, ...Array.from("a\tb\n1\t2").flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(parseCsv(decodeCsvBytes(le).text)).toEqual([["a", "b"], ["1", "2"]]);
    const be = new Uint8Array([0xfe, 0xff, ...Array.from("a,b\n1,2").flatMap((c) => [0, c.charCodeAt(0)])]);
    expect(parseCsv(decodeCsvBytes(be).text)).toEqual([["a", "b"], ["1", "2"]]);
  });
});
