import { describe, expect, it } from "vitest";
import { normalizeName, validateName } from "./names.js";

describe("names", () => {
  it("normalizes case but keeps hyphens meaningful", () => {
    expect(normalizeName("  Prep ")).toBe("prep");
    expect(validateName("Team-Docs")).toBe("team-docs");
    expect(validateName("team-docs")).not.toBe(validateName("teamdocs"));
  });
  it("rejects invalid shapes", () => {
    for (const bad of ["a", "-prep", "prep-", "pre--p", "pre_p", "pré", "a".repeat(64), "with space", ".new", "me"]) {
      expect(() => validateName(bad), bad).toThrow();
    }
  });
  it("accepts digits and single internal hyphens", () => {
    expect(validateName("q3-2026-plan")).toBe("q3-2026-plan");
    expect(validateName("42")).toBe("42");
  });
});
