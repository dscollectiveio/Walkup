import { describe, expect, it, vi } from "vitest";
import { documentError } from "@/lib/documents/errors";

describe("documentError", () => {
  it("says which documents can be shared with all owners, in words", () => {
    expect(
      documentError({ code: "23514", message: "only governing documents, minutes and financial statements can be shared with all owners" }),
    ).toBe("Only governing documents, minutes and financial statements can be shared with all owners.");
  });

  it("keeps hiding the raw message of any other check failure", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(documentError({ code: "23514", message: 'new row violates check constraint "documents_x"' })).toBe("Something went wrong saving that. Try again.");
    log.mockRestore();
  });
});
