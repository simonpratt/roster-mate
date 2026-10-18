import { describe, expect, it } from "vitest";
import { codeInfo, isStandardCode, isValidCode, OTHER_STYLE, STANDARD_CODES } from "./codes";

describe("shift codes", () => {
  it("accepts one or two uppercase letters only", () => {
    expect(isValidCode("D")).toBe(true);
    expect(isValidCode("SE")).toBe(true);
    for (const bad of ["se", "ABC", "D1", "", "A/L"]) expect(isValidCode(bad)).toBe(false);
  });

  it("knows the five standard codes", () => {
    expect(STANDARD_CODES.map((c) => c.code)).toEqual(["D", "E", "L", "N", "X"]);
    expect(isStandardCode("X")).toBe(true);
    expect(isStandardCode("SE")).toBe(false);
    expect(codeInfo("L")).toMatchObject({ label: "Late", standard: true, chip: "bg-violet-surface text-violet" });
  });

  it("gives an Other code the lime classes and its own letters as the label", () => {
    expect(codeInfo("SE")).toEqual({ code: "SE", label: "SE", standard: false, ...OTHER_STYLE });
    expect(OTHER_STYLE.chip).toBe("bg-lime-surface text-lime");
  });
});
