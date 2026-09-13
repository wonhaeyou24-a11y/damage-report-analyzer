import { describe, expect, it } from "vitest";
import {
  averageHashFromGrayscale,
  classifyDamageRelated,
  computeMatchCandidates,
  detectDuplicateCandidates,
  hammingDistance,
  parseDamageNameFromText,
  parseLocationFromText,
  parsePhotoNo,
  parseSubPartFromText,
} from "./photoAnalysis";
import type { DamageRecord } from "../types";

function damage(overrides: Partial<DamageRecord>): DamageRecord {
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
    sourceReferences: [],
    ...overrides,
  };
}

describe("parsePhotoNo — TEST 3 & 4", () => {
  it("extracts a group-style photo number", () => {
    expect(parsePhotoNo("③-01 소단측구 균열")).toBe("③-01");
  });
  it("extracts '사진 N' style", () => {
    expect(parsePhotoNo("사진 1 전경")).toBe("사진 1");
  });
  it("extracts 'No. N' and 'P-01' style", () => {
    expect(parsePhotoNo("No. 12 상세사진")).toMatch(/No\.?\s?12/i);
    expect(parsePhotoNo("P-01 도수로")).toBe("P-01");
  });
  it("returns null when there is no photo number (must not be dropped upstream)", () => {
    expect(parsePhotoNo("소단측구 균열 165m")).toBeNull();
    expect(parsePhotoNo(null)).toBeNull();
  });
});

describe("parseLocationFromText / parseSubPartFromText / parseDamageNameFromText — TEST 5 & 6", () => {
  it("parses location, subPart and damageName from a caption", () => {
    expect(parseLocationFromText("소단측구 균열 165m")).toBe("165m");
    expect(parseSubPartFromText("소단측구 균열 165m")).toEqual({ subPart: "소단측구", part: "배수시설" });
    expect(parseDamageNameFromText("소단측구 균열 165m")).toBe("균열");
  });
  it("returns null for fields that cannot be confirmed from the text (no fabrication)", () => {
    expect(parseLocationFromText("전경사진")).toBeNull();
    expect(parseSubPartFromText("전경사진")).toBeNull();
    expect(parseDamageNameFromText("전경사진")).toBeNull();
  });
});

describe("classifyDamageRelated — TEST 8 & 9", () => {
  it("marks a damage caption as related", () => {
    expect(classifyDamageRelated("소단측구 균열", null, "③-01")).toBe(true);
  });
  it("marks a cover/logo image as unrelated", () => {
    expect(classifyDamageRelated("표지", null, null)).toBe(false);
  });
  it("marks an ambiguous scenery caption as unknown rather than guessing", () => {
    expect(classifyDamageRelated("전경사진", null, null)).toBe("unknown");
  });
});

describe("image hashing / duplicate detection — TEST 7", () => {
  it("computes a stable average hash and hamming distance", () => {
    const bright = new Array(64).fill(200);
    const dark = new Array(64).fill(50);
    const hashA = averageHashFromGrayscale(bright);
    const hashB = averageHashFromGrayscale(bright);
    const hashC = averageHashFromGrayscale(dark);
    expect(hashA).toBe(hashB);
    expect(hammingDistance(hashA, hashB)).toBe(0);
    expect(hashA).toHaveLength(64);
    void hashC;
  });

  it("flags near-identical images as duplicate candidates regardless of differing photo numbers", () => {
    const base = "1".repeat(60) + "0000";
    const almostSame = "1".repeat(58) + "0" + "1" + "0000"; // 2 bits differ
    const different = "0".repeat(64);
    const result = detectDuplicateCandidates(
      [
        { id: "P001", hash: base },
        { id: "P002", hash: almostSame },
        { id: "P003", hash: different },
      ],
      8
    );
    expect(result.get("P001")).toContain("P002");
    expect(result.get("P002")).toContain("P001");
    expect(result.get("P001")).not.toContain("P003");
  });
});

describe("computeMatchCandidates — STEP 7을 위한 사전 점수 (확정 아님)", () => {
  it("scores an exact photoNo + field match highest, without linking", () => {
    const d1 = damage({ id: "③-01", location: "165m", subPart: "소단측구" });
    const d2 = damage({ id: "③-09", location: "208m", subPart: "도수로" });
    const candidates = computeMatchCandidates(
      {
        photoNo: "③-01",
        caption: "소단측구 균열",
        section: "1구간",
        part: "배수시설",
        subPart: "소단측구",
        location: "165m",
        damageName: "균열",
        ocrText: null,
        nearbyText: null,
        visionInference: null,
      },
      [d1, d2]
    );
    expect(candidates[0].damageId).toBe("③-01");
    expect(candidates[0].score).toBeGreaterThan(candidates.find((c) => c.damageId === "③-09")?.score ?? 0);
  });

  it("returns no candidates when nothing matches (never force a link)", () => {
    const d1 = damage({ id: "③-01" });
    const candidates = computeMatchCandidates(
      {
        photoNo: null,
        caption: "전경사진",
        section: null,
        part: null,
        subPart: null,
        location: null,
        damageName: null,
        ocrText: null,
        nearbyText: null,
        visionInference: null,
      },
      [d1]
    );
    expect(candidates).toHaveLength(0);
  });
});
