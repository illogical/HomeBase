import { describe, expect, it } from "vitest";
import { redactAttributes, redactError } from "../../src/logging/redact.js";

describe("redactAttributes", () => {
  it.each([
    "authorization",
    "Authorization",
    "cookie",
    "set-cookie",
    "apiToken",
    "clientSecret",
    "password",
    "apikey",
    "ApiKey",
  ])("redacts the sensitive key %j", (key) => {
    const result = redactAttributes({ [key]: "canary-secret-value" });
    expect(JSON.stringify(result)).not.toContain("canary-secret-value");
  });

  it("leaves non-sensitive keys untouched", () => {
    const result = redactAttributes({ userId: "abc-123" });
    expect(result).toEqual({ userId: "abc-123" });
  });

  it("redacts sensitive keys nested inside objects and arrays", () => {
    const result = redactAttributes({
      nested: { token: "canary-secret-value" },
      list: [{ password: "canary-secret-value" }],
    });
    expect(JSON.stringify(result)).not.toContain("canary-secret-value");
  });

  it("truncates strings over 2 KiB", () => {
    const long = "a".repeat(3000);
    const result = redactAttributes({ value: long }) as { value: string };
    expect(result.value.length).toBeLessThan(3000);
    expect(result.value.startsWith("a".repeat(2048))).toBe(true);
  });

  it("caps arrays at 50 entries", () => {
    const array = Array.from({ length: 80 }, (_, index) => index);
    const result = redactAttributes({ array }) as { array: number[] };
    expect(result.array).toHaveLength(50);
  });

  it("caps object entries at 50", () => {
    const object: Record<string, number> = {};
    for (let index = 0; index < 80; index += 1) {
      object[`key${index}`] = index;
    }
    const result = redactAttributes({ object }) as { object: Record<string, number> };
    expect(Object.keys(result.object)).toHaveLength(50);
  });

  it("returns undefined for undefined input", () => {
    expect(redactAttributes(undefined)).toBeUndefined();
  });
});

describe("redactError", () => {
  it("redacts secrets embedded in an error message and single-lines the stack", () => {
    const error = new Error("failed with token=canary-secret-value");
    error.stack = "Error: failed\n    at line one\n    at line two";
    const result = redactError(error);
    expect(result?.stack).not.toContain("\n");
    expect(result?.message).toContain("failed with token=canary-secret-value");
  });

  it("returns undefined for undefined input", () => {
    expect(redactError(undefined)).toBeUndefined();
  });

  it("handles non-Error throws", () => {
    const result = redactError("plain string failure");
    expect(result?.name).toBe("NonErrorThrow");
    expect(result?.message).toContain("plain string failure");
  });
});
