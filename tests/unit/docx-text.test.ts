import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { docxXmlToPages, extractDocxPages } from "@/lib/documents/docx-text";
import { chooseReadMethod, DOCX_MIME } from "@/lib/insurance/read-schema";

/** A minimal single-entry zip, enough for the reader to find word/document.xml. */
function zip(name: string, content: string, method: 0 | 8 = 8): Uint8Array {
  const data = Buffer.from(content, "utf8");
  const body = method === 8 ? deflateRawSync(data) : data;
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const localPart = Buffer.concat([local, nameBuf, body]);
  const centralPart = Buffer.concat([central, nameBuf]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return new Uint8Array(Buffer.concat([localPart, centralPart, eocd]));
}

const XML =
  '<w:document><w:body><w:p><w:r><w:t>Carrier: Lakeshore &amp; Co</w:t></w:r></w:p>' +
  '<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t>Building limit $2,400,000</w:t></w:r></w:p></w:body></w:document>';

describe("reading a Word document", () => {
  it("splits pages at recorded page breaks and decodes entities", () => {
    expect(docxXmlToPages(XML)).toEqual(["Carrier: Lakeshore & Co", "Building limit $2,400,000"]);
  });

  it("reads word/document.xml out of the zip, deflated or stored", async () => {
    expect(await extractDocxPages(zip("word/document.xml", XML))).toHaveLength(2);
    expect(await extractDocxPages(zip("word/document.xml", XML, 0))).toHaveLength(2);
  });

  it("returns null for a file that is not a .docx or has no text", async () => {
    expect(await extractDocxPages(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(await extractDocxPages(zip("other.xml", XML))).toBeNull();
    expect(await extractDocxPages(zip("word/document.xml", "<w:document/>"))).toBeNull();
  });

  it("refuses an entry that inflates past the cap", async () => {
    const bomb = zip("word/document.xml", `<w:t>${"a".repeat(13 * 1024 * 1024)}</w:t>`);
    expect(await extractDocxPages(bomb)).toBeNull();
  });

  it("reads a Word document as text, and says so when it has none", () => {
    const body = "Declarations page. ".repeat(10);
    expect(chooseReadMethod({ mime: DOCX_MIME, byteSize: 1000, pages: [body], pageCount: null })).toMatchObject({ method: "text" });
    expect(chooseReadMethod({ mime: DOCX_MIME, byteSize: 1000, pages: null, pageCount: null })).toMatchObject({ method: "unreadable" });
  });
});
