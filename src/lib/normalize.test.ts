import { describe, expect, it } from "vitest";
import { expandAllGroups, parseLocationBlock, parseLocationList } from "./normalize";
import type { RawDamageGroup } from "../types";

function baseGroup(overrides: Partial<RawDamageGroup>): RawDamageGroup {
  return {
    groupNo: "③",
    section: "1구간",
    damageName: "균열",
    part: "배수시설",
    repairMethod: "주입보수",
    quantityGroupTotal: "23.3m",
    locations: [],
    photoCount: null,
    sourcePages: [80],
    sourceReferences: [{ page: 80, type: "table" }],
    ...overrides,
  };
}

describe("parseLocationList", () => {
  it("splits a comma list and keeps ranges intact", () => {
    expect(parseLocationList("165, 187, 188m", "소단측구")).toEqual([
      { subPart: "소단측구", location: "165m", quantity: null },
      { subPart: "소단측구", location: "187m", quantity: null },
      { subPart: "소단측구", location: "188m", quantity: null },
    ]);
  });

  it("does not split a range into individual meters (test 4)", () => {
    expect(parseLocationList("176~206m", "소단측구")).toEqual([
      { subPart: "소단측구", location: "176~206m", quantity: null },
    ]);
  });

  it("keeps a single value and a range as two separate entries", () => {
    expect(parseLocationList("65m, 176~206m", "소단측구")).toEqual([
      { subPart: "소단측구", location: "65m", quantity: null },
      { subPart: "소단측구", location: "176~206m", quantity: null },
    ]);
  });
});

describe("parseLocationBlock", () => {
  it("splits a multi-subpart block into 11 individual entries (test 1)", () => {
    const text = "165, 187, 188, 190, 217, 261, 267, 275m\n도수로 208m\n산마루측구 211, 323m";
    const entries = parseLocationBlock(text, "소단측구");
    expect(entries).toHaveLength(11);
    expect(entries.filter((e) => e.subPart === "소단측구")).toHaveLength(8);
    expect(entries.filter((e) => e.subPart === "도수로")).toHaveLength(1);
    expect(entries.filter((e) => e.subPart === "산마루측구")).toHaveLength(2);
    expect(entries.map((e) => e.location)).toEqual([
      "165m",
      "187m",
      "188m",
      "190m",
      "217m",
      "261m",
      "267m",
      "275m",
      "208m",
      "211m",
      "323m",
    ]);
  });
});

describe("expandAllGroups", () => {
  it("test 1: one group with 8 locations produces 8 records", () => {
    const group = baseGroup({
      locations: parseLocationList("165, 187, 188, 190, 217, 261, 267, 275m", "소단측구"),
    });
    const records = expandAllGroups([group]);
    expect(records).toHaveLength(8);
    expect(records[0].id).toBe("③-01");
    expect(records[7].id).toBe("③-08");
  });

  it("test 2 & 3: same damage name, different subPart/part yields separate records", () => {
    const group = baseGroup({
      locations: [
        { subPart: "소단측구", location: "165m", quantity: null },
        { subPart: "도수로", location: "208m", quantity: null },
      ],
    });
    const records = expandAllGroups([group]);
    expect(records).toHaveLength(2);
    expect(records[0].subPart).not.toBe(records[1].subPart);
    expect(records[0].damageName).toBe(records[1].damageName);
  });

  it("test 4: a range location is kept as a single record", () => {
    const group = baseGroup({
      damageName: "낙엽·이물질 집적",
      quantityGroupTotal: "37.5m",
      locations: parseLocationList("65m, 176~206m", "소단측구"),
    });
    const records = expandAllGroups([group]);
    expect(records).toHaveLength(2);
    expect(records[1].location).toBe("176~206m");
  });

  it("test 5: shared group total is not duplicated as individual quantity", () => {
    const group = baseGroup({
      quantityGroupTotal: "23.3m",
      locations: parseLocationList("165, 187, 188m", "소단측구"),
    });
    const records = expandAllGroups([group]);
    for (const r of records) {
      expect(r.quantity).toBeNull();
      expect(r.quantityGroup).toBe("그룹 합계 23.3m에 포함");
    }
  });

  it("single-location group uses the group number without a suffix", () => {
    const group = baseGroup({
      groupNo: "①",
      damageName: "기붕괴흔",
      part: "사면하부",
      quantityGroupTotal: null,
      locations: [{ subPart: "-", location: "110m", quantity: "25㎥" }],
    });
    const records = expandAllGroups([group]);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("①");
    expect(records[0].quantity).toBe("25㎥");
    expect(records[0].quantityGroup).toBeNull();
  });

  it("unrecognized part falls back to 기타 and flags for review", () => {
    const group = baseGroup({
      part: "소단측구",
      locations: [{ subPart: "-", location: "100m", quantity: null }],
    });
    const records = expandAllGroups([group]);
    expect(records[0].part).toBe("기타");
    expect(records[0].notes).toContain("소단측구");
  });
});
