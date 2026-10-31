import { describe, expect, it } from "vitest";
import { nameKey, parseCsvLine } from "./nflverse.ts";

describe("parseCsvLine", () => {
  it("handles quoted fields with commas and escaped quotes", () => {
    expect(parseCsvLine('2026,1,"Smith, Jr.","say ""hi""",')).toEqual(["2026", "1", "Smith, Jr.", 'say "hi"', ""]);
  });
});

describe("nameKey", () => {
  it("drops punctuation and suffixes", () => {
    expect(nameKey("Marvin Harrison Jr.")).toBe("marvinharrison");
    expect(nameKey("Ja'Marr Chase")).toBe("jamarrchase");
    expect(nameKey("Kenneth Walker III")).toBe("kennethwalker");
  });
});
