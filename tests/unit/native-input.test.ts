import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  base64DecodedBytes,
  NATIVE_IMAGE_MAX_BYTES,
  NATIVE_IMAGE_TYPES,
  NATIVE_MAX_IMAGES,
  NATIVE_PDF_MAX_BYTES,
  nativeInputProblem,
} from "@/lib/ai/native-input";

type Content = Anthropic.MessageParam["content"];

/** Base64 text that decodes to exactly `bytes` bytes. */
function b64(bytes: number): string {
  return Buffer.alloc(bytes).toString("base64");
}
const image = (mediaType: string, bytes = 10) =>
  ({ type: "image", source: { type: "base64", media_type: mediaType, data: b64(bytes) } }) as Anthropic.ImageBlockParam;
const pdf = (bytes: number) =>
  ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(bytes) } }) as Anthropic.DocumentBlockParam;

describe("base64DecodedBytes", () => {
  it("accounts for padding", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 1000]) expect(base64DecodedBytes(b64(n))).toBe(n);
  });
});

describe("nativeInputProblem", () => {
  it("accepts each supported image type", () => {
    for (const t of NATIVE_IMAGE_TYPES) expect(nativeInputProblem([image(t)])).toBeNull();
  });
  it("refuses HEIC and HEIF", () => {
    expect(nativeInputProblem([image("image/heic")])).toBe("unsupported_file");
    expect(nativeInputProblem([image("image/heif")])).toBe("unsupported_file");
  });
  it("refuses an image over the size cap and too many images", () => {
    expect(nativeInputProblem([image("image/png", NATIVE_IMAGE_MAX_BYTES)])).toBeNull();
    expect(nativeInputProblem([image("image/png", NATIVE_IMAGE_MAX_BYTES + 1)])).toBe("too_long");
    const many: Content = Array.from({ length: NATIVE_MAX_IMAGES + 1 }, () => image("image/jpeg"));
    expect(nativeInputProblem(many)).toBe("too_long");
  });
  it("caps PDFs at 20 MB raw", () => {
    expect(nativeInputProblem([pdf(NATIVE_PDF_MAX_BYTES)])).toBeNull();
    expect(nativeInputProblem([pdf(21 * 1024 * 1024)])).toBe("too_long");
  });
  it("ignores text-only content", () => {
    expect(nativeInputProblem("hello")).toBeNull();
    expect(nativeInputProblem([{ type: "text", text: "hello" }])).toBeNull();
  });
});
