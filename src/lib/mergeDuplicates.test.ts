import { describe, expect, it } from "vitest";
import { mergeDuplicates } from "./mergeDuplicates";
import type { DamageRecord } from "../types";

function rec(overrides: Partial<DamageRecord>): DamageRecord {
  return {
    id: "③-01",
    groupNo: "③",
    groupIndex: 1,
    section: "1구간",
    damageName: "균열",
    part: "배수시설",
    subPart: "소단측구",
    location: "165m",
    repairMethod: "주입보수",
    quantity: null,
    quantityGroup: "23.3m",
    photos: [],
    status: "review",
    sourcePages: [80],
    sourceReferences: [{ page: 80, type: "table" }],
    ...overrides,
  };
}

describe("mergeDuplicates — STEP 5", () => {
  it("TEST1: same damage on two pages merges into one record", () => {
    const a = rec({ sourcePages: [80], sourceReferences: [{ page: 80, type: "table" }] });
    const b = rec({ sourcePages: [81], sourceReferences: [{ page: 81, type: "conclusion" }] });
    const result = mergeDuplicates([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].mergeInfo?.merged).toBe(true);
    expect(result[0].sourcePages).toEqual([80, 81]);
    expect(result[0].sourceReferences).toHaveLength(2);
    expect(result[0].status).not.toBe("conflict");
  });

  it("TEST2: same damage name, different location from the same source list stays separate", () => {
    const a = rec({ id: "③-01", groupIndex: 1, location: "165m", sourcePages: [80] });
    const b = rec({ id: "③-02", groupIndex: 2, location: "187m", sourcePages: [80] });
    const result = mergeDuplicates([a, b]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.location).sort()).toEqual(["165m", "187m"]);
  });

  it("TEST3: same damage name, different subPart stays separate", () => {
    const a = rec({ id: "③-09", subPart: "도수로", location: "208m", sourcePages: [80] });
    const b = rec({ id: "③-10", subPart: "산마루측구", location: "211m", sourcePages: [81] });
    const result = mergeDuplicates([a, b]);
    expect(result).toHaveLength(2);
  });

  it("TEST4: 8 locations from one group stay as 8 individual records", () => {
    const locs = ["165m", "187m", "188m", "190m", "217m", "261m", "267m", "275m"];
    const records = locs.map((loc, i) => rec({ id: `③-${i + 1}`, groupIndex: i + 1, location: loc, sourcePages: [80, 81] }));
    const result = mergeDuplicates(records);
    expect(result).toHaveLength(8);
  });

  it("TEST5: group quantity is not duplicated when merging duplicates", () => {
    const a = rec({ quantityGroup: "23.3m", sourcePages: [80] });
    const b = rec({ quantityGroup: "23.3m", sourcePages: [81] });
    const result = mergeDuplicates([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].quantityGroup).toBe("23.3m");
    expect(result[0].quantity).toBeNull();
  });

  it("TEST6: conflicting location from disjoint sources is flagged, not guessed", () => {
    const a = rec({
      id: "③-09",
      subPart: "산마루측구",
      location: "208m",
      sourcePages: [80],
      sourceReferences: [{ page: 80, type: "table" }],
    });
    const b = rec({
      id: "③-09",
      subPart: "산마루측구",
      location: "211m",
      sourcePages: [81],
      sourceReferences: [{ page: 81, type: "conclusion" }],
    });
    const result = mergeDuplicates([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].location).toBe("검토필요");
    expect(result[0].status).toBe("conflict");
    const locConflict = result[0].conflicts?.find((c) => c.field === "location");
    expect(locConflict?.values.map((v) => v.value).sort()).toEqual(["208m", "211m"]);
  });

  it("TEST7: conflicting repair method for the same location is flagged", () => {
    const a = rec({ repairMethod: "주입보수", sourcePages: [80] });
    const b = rec({ repairMethod: "표면처리", sourcePages: [81] });
    const result = mergeDuplicates([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("conflict");
    const conflict = result[0].conflicts?.find((c) => c.field === "repairMethod");
    expect(conflict?.values.map((v) => v.value).sort()).toEqual(["주입보수", "표면처리"]);
  });

  it("TEST8: the same damage repeated across table/body/conclusion merges with all sources kept", () => {
    const a = rec({ sourcePages: [80], sourceReferences: [{ page: 80, type: "table" }] });
    const b = rec({ sourcePages: [80], sourceReferences: [{ page: 80, type: "body" }] });
    const c = rec({ sourcePages: [81], sourceReferences: [{ page: 81, type: "conclusion" }] });
    const result = mergeDuplicates([a, b, c]);
    expect(result).toHaveLength(1);
    expect(result[0].sourceReferences).toHaveLength(3);
    expect(result[0].sourcePages).toEqual([80, 81]);
  });

  it("TEST9: a range location passes through merge unchanged", () => {
    const a = rec({ location: "176~206m", sourcePages: [82] });
    const result = mergeDuplicates([a]);
    expect(result[0].location).toBe("176~206m");
  });

  it("TEST10: merged record keeps source page/quote structure for later lookup", () => {
    const a = rec({ sourcePages: [80], sourceReferences: [{ page: 80, type: "table", excerpt: "소단측구 균열 165m" }] });
    const b = rec({ sourcePages: [81], sourceReferences: [{ page: 81, type: "conclusion", excerpt: "소단측구 균열 165m" }] });
    const result = mergeDuplicates([a, b]);
    expect(result[0].sourceReferences.every((r) => typeof r.page === "number")).toBe(true);
  });
});
