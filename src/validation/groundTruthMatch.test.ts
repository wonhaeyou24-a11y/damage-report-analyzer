import { describe, expect, it } from "vitest";
import { matchDamages, normalizeDamageName } from "./groundTruthMatch";
import type { DamageRecord } from "../types";
import type { GroundTruthDamage } from "./types";

function gt(overrides: Partial<GroundTruthDamage>): GroundTruthDamage {
  return {
    id: "GT-001",
    groupNo: "③",
    section: "1구간",
    damageName: "균열",
    part: "배수시설",
    subPart: "소단측구",
    location: "165m",
    quantity: null,
    quantityGroup: "23.3m",
    repairMethod: "주입보수",
    sourceRefs: [{ page: 80, type: "table" }],
    photoNos: [],
    ...overrides,
  };
}

function ai(overrides: Partial<DamageRecord>): DamageRecord {
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
    status: "confirmed",
    sourcePages: [80],
    sourceReferences: [{ page: 80, type: "table" }],
    ...overrides,
  };
}

describe("matchDamages", () => {
  it("matches identical damages on section+damageName+part+subPart+location", () => {
    const result = matchDamages([gt({})], [ai({})]);
    expect(result.matched).toHaveLength(1);
    expect(result.missed).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  it("does not match the same damage name at a different location (spec section 15)", () => {
    const result = matchDamages([gt({ location: "165m" })], [ai({ location: "187m" })]);
    expect(result.matched).toHaveLength(0);
    expect(result.missed).toHaveLength(1);
    expect(result.extra).toHaveLength(1);
  });

  it("treats normalized location variants as equal (STA.165m, 165.0m, K165)", () => {
    for (const variant of ["165 m", "165.0m", "STA.165m", "STA 165", "K165"]) {
      const result = matchDamages([gt({ location: "165m" })], [ai({ location: variant })]);
      expect(result.matched, `variant: ${variant}`).toHaveLength(1);
    }
  });

  it("keeps a location range as its own distinct value, not equal to a point inside it", () => {
    const result = matchDamages([gt({ location: "176~206m" })], [ai({ location: "190m" })]);
    expect(result.matched).toHaveLength(0);
  });

  it("normalizes damage-name synonyms (균열/크랙/crack) but keeps different damage types distinct", () => {
    expect(normalizeDamageName("균열")).toBe(normalizeDamageName("크랙"));
    expect(normalizeDamageName("균열")).not.toBe(normalizeDamageName("누수"));
    const result = matchDamages([gt({ damageName: "균열" })], [ai({ damageName: "크랙" })]);
    expect(result.matched).toHaveLength(1);
  });

  it("performs strict 1:1 matching — one AI record cannot satisfy two identical ground truth entries", () => {
    const result = matchDamages([gt({ id: "GT-001" }), gt({ id: "GT-002" })], [ai({ id: "③-01" })]);
    expect(result.matched).toHaveLength(1);
    expect(result.missed).toHaveLength(1);
  });
});
