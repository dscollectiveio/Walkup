import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEW_FROM_OWNERS_COPY,
  UNIT_DOCUMENT_CATEGORY,
  UNIT_DOCUMENT_COPY,
  UNIT_DOCUMENT_KINDS,
  UNIT_DOCUMENT_REMOVE_DAYS,
  addedByLine,
  isUnitDocumentKind,
  noticeLine,
  removalDaysLeft,
  unitDocumentKindLabel,
} from "@/lib/owner/unit-documents";
import { buildUnitDocumentPath, parseStoragePath, parseUnitDocumentPath, isUuid } from "@/lib/documents/upload-paths";
import { rowText } from "@/components/upload/upload-copy";

const MIGRATION = readFileSync(path.resolve(import.meta.dirname, "../../supabase/migrations/0079_owner_unit_documents.sql"), "utf8");

const DAMEN = "11111111-1111-1111-1111-111111111111";
const UNIT = "aaaa1111-0000-0000-0000-000000000001";
const DAY = 86_400_000;

describe("unit document kinds", () => {
  it("offers the four kinds the owner picks from", () => {
    expect(UNIT_DOCUMENT_KINDS.map((k) => k.label)).toEqual(["HO6 insurance certificate", "Lease", "Proof of ownership", "Other"]);
  });

  it("accepts only those slugs", () => {
    for (const k of UNIT_DOCUMENT_KINDS) expect(isUnitDocumentKind(k.slug)).toBe(true);
    for (const bad of ["", "LEASE", "mortgage", null, undefined, 3, {}]) expect(isUnitDocumentKind(bad)).toBe(false);
    expect(unitDocumentKindLabel("lease")).toBe("Lease");
    expect(unitDocumentKindLabel("nope")).toBeNull();
  });

  it("matches the labels and slugs the migration stores", () => {
    for (const k of UNIT_DOCUMENT_KINDS) {
      expect(MIGRATION).toContain(`when '${k.slug}'`);
      expect(MIGRATION).toContain(`'${k.label}'`);
    }
    expect(MIGRATION).toMatch(new RegExp(`\\('${UNIT_DOCUMENT_CATEGORY}',\\s+'Unit document',\\s+'board_only'`));
  });
});

describe("the 30 day removal window", () => {
  it("matches the migration", () => {
    expect(UNIT_DOCUMENT_REMOVE_DAYS).toBe(30);
    expect(MIGRATION).toContain("interval '30 days'");
  });

  it("counts whole days left and stops at zero", () => {
    const uploaded = "2026-10-01T12:00:00Z";
    const at = (days: number) => Date.parse(uploaded) + days * DAY;
    expect(removalDaysLeft(uploaded, at(0))).toBe(30);
    expect(removalDaysLeft(uploaded, at(10))).toBe(20);
    expect(removalDaysLeft(uploaded, at(29.5))).toBe(1);
    expect(removalDaysLeft(uploaded, at(30))).toBe(0);
    expect(removalDaysLeft(uploaded, at(45))).toBe(0);
    expect(removalDaysLeft("not a date", at(1))).toBe(0);
  });
});

describe("the unit document storage path", () => {
  const path = buildUnitDocumentPath({ associationId: DAMEN, unitId: UNIT, now: 1760000000000, suffix: "abc123", filename: "HO6 certificate.pdf" });

  it("builds <association>/units/<unit>/<file> and parses back", () => {
    expect(path).toBe(`${DAMEN}/units/${UNIT}/1760000000000-abc123-HO6_certificate.pdf`);
    expect(parseUnitDocumentPath(path)).toEqual({ associationId: DAMEN, unitId: UNIT });
  });

  it("is not a hub document or a ticket photo path, so storage_path_kind stays as it was", () => {
    expect(parseStoragePath(path)).toBeNull();
  });

  it("rejects anything that is not exactly that shape", () => {
    for (const bad of [
      "",
      `${DAMEN}/units/${UNIT}`,
      `${DAMEN}/units/${UNIT}/a.pdf`,
      `${DAMEN}/unit/${UNIT}/1760000000000-abc123-a.pdf`,
      `${DAMEN}/units/not-a-uuid/1760000000000-abc123-a.pdf`,
      `${DAMEN}/units/${UNIT}/x/1760000000000-abc123-a.pdf`,
      `${DAMEN}/tickets/${UNIT}/1760000000000-abc123-a.pdf`,
      `AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA/units/${UNIT}/1760000000000-abc123-a.pdf`,
      `${DAMEN}/units/${UNIT}/1760000000000-ABC123-a.pdf`,
    ]) {
      expect(parseUnitDocumentPath(bad), bad).toBeNull();
    }
  });

  it("uses the same uuid and file rules as the SQL mirror", () => {
    expect(isUuid(UNIT)).toBe(true);
    expect(MIGRATION).toContain("v_parts[2] = 'units'");
    expect(MIGRATION).toContain("'^[0-9]{13}-[a-z0-9]{6}-[A-Za-z0-9_.-]{1,120}$'");
  });
});

describe("the sentences", () => {
  it("say who added a document", () => {
    expect(addedByLine("you", "Oct 3")).toBe("Added by you, Oct 3");
    expect(addedByLine("board", "Oct 3")).toBe("Added by the board, Oct 3");
    expect(addedByLine("owner", "Oct 3")).toBe("Added by another owner of this unit, Oct 3");
    expect(addedByLine("owner", "Oct 3", "Ada Okonkwo")).toBe("Added by Ada Okonkwo, Oct 3");
  });

  it("tell the board what arrived", () => {
    expect(noticeLine({ unitLabel: "Unit 1", uploadedByName: "Ada Okonkwo", kind: "Lease", title: "lease.pdf" })).toBe(
      "Ada Okonkwo added a document for Unit 1: Lease",
    );
    expect(noticeLine({ unitLabel: "Unit 1", uploadedByName: null, kind: null, title: "x" })).toBe("An owner added a document for Unit 1");
  });

  it("explain a duplicate upload for a unit document", () => {
    expect(rowText({ state: "duplicate", purpose: "unit_document" })).toBe("Already added for your unit, so nothing new was added.");
    expect(rowText({ state: "duplicate", purpose: "unit_document", alreadyStored: true })).toBe(
      "Walkup already has this exact file, so it wasn't added again.",
    );
  });

  it("use no em dash", () => {
    expect(JSON.stringify([UNIT_DOCUMENT_COPY, NEW_FROM_OWNERS_COPY, UNIT_DOCUMENT_KINDS])).not.toContain("—");
    expect(rowText({ state: "duplicate", purpose: "unit_document" })).not.toContain("—");
  });
});

describe("the migration keeps the promises the feature makes", () => {
  it("never queues owner uploads for review or reads them", () => {
    expect(MIGRATION).toMatch(/'manual',\s+'ok',/);
    expect(MIGRATION).toContain("'skipped'");
  });

  it("pins every unit document to its unit and keeps it board_only", () => {
    expect(MIGRATION).toMatch(/array\[v_label\],\s+'board_only',\s+p_unit_id/);
  });

  it("does not let anon call any of the new functions", () => {
    for (const fn of [
      "register_unit_document(uuid, text, text, text, bigint, text, text, text)",
      "unit_owner_documents(uuid)",
      "remove_unit_document(uuid)",
      "list_owner_document_notices(uuid)",
      "mark_owner_document_notices_seen(uuid, uuid[])",
      "unit_document_association_id(uuid)",
    ]) {
      expect(MIGRATION).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(MIGRATION).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
  });

  it("pins search_path on every SECURITY DEFINER function", () => {
    const definers = MIGRATION.match(/security definer/g)?.length ?? 0;
    const pinned = MIGRATION.match(/security definer set search_path = ''/g)?.length ?? 0;
    expect(definers).toBeGreaterThan(0);
    expect(pinned).toBe(definers);
  });
});
