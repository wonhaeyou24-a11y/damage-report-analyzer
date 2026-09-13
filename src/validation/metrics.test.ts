import { describe, expect, it } from "vitest";
import { computeDamageDetectionMetrics, computeFieldAccuracy, computeValidationMetrics, precisionRecallF1 } from "./metrics";
import type { DamageRecord, ExtractedPhoto } from "../types";
import type { GroundTruthDamage, GroundTruthPhoto } from "./types";

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
    photoIds: [],
    ...overrides,
  };
}

describe("precisionRecallF1 — spec section 19 worked example", () => {
  it("TP=90, FP=5, FN=10 matches the spec's own example", () => {
    const result = precisionRecallF1(90, 5, 10);
    expect(result.precision).toBeCloseTo(90 / 95, 4);
    expect(result.recall).toBeCloseTo(90 / 100, 4);
    expect(result.f1).toBeCloseTo((2 * (90 / 95) * (90 / 100)) / (90 / 95 + 90 / 100), 4);
  });

  it("handles the zero-division edge cases without NaN", () => {
    expect(precisionRecallF1(0, 0, 0)).toMatchObject({ precision: 0, recall: 0, f1: 0 });
  });
});

describe("computeDamageDetectionMetrics", () => {
  it("computes from matched/missed/extra counts directly", () => {
    const matched = new Array(90).fill(null).map(() => ({ gt: gt({}), ai: ai({}) }));
    const missed = new Array(10).fill(null).map(() => gt({}));
    const extra = new Array(5).fill(null).map(() => ai({}));
    const result = computeDamageDetectionMetrics(matched, missed, extra);
    expect(result.tp).toBe(90);
    expect(result.fp).toBe(5);
    expect(result.fn).toBe(10);
  });
});

describe("computeFieldAccuracy", () => {
  it("reports per-field match rate only over matched pairs, per spec section 20", () => {
    const matched = [
      { gt: gt({ location: "165m" }), ai: ai({ location: "165m" }) }, // location matches
      { gt: gt({ location: "165m" }), ai: ai({ location: "187m" }) }, // location differs
    ];
    const fields = computeFieldAccuracy(matched);
    const location = fields.find((f) => f.field === "location")!;
    expect(location.matched).toBe(1);
    expect(location.total).toBe(2);
    expect(location.matchRate).toBe(0.5);
  });

  it("compares group quantity via quantityGroup when quantity itself is null", () => {
    const matched = [{ gt: gt({ quantity: null, quantityGroup: "23.3m" }), ai: ai({ quantity: null, quantityGroup: "23.3m" }) }];
    const quantity = computeFieldAccuracy(matched).find((f) => f.field === "quantity")!;
    expect(quantity.matched).toBe(1);
  });
});

describe("computeValidationMetrics — status classification", () => {
  it("classifies GOOD/WARNING/FAIL against the default thresholds", () => {
    const gts = new Array(10).fill(null).map((_, i) => gt({ id: `GT-${i}`, location: `${i}m` }));
    const aisGood = gts.map((g, i) => ai({ id: `A-${i}`, location: g.location }));
    const metricsGood = computeValidationMetrics(gts, aisGood, [], []);
    expect(metricsGood.status).toBe("GOOD");

    const aisFail: DamageRecord[] = [ai({ id: "A-0", location: "999m" })]; // 거의 아무것도 못 맞춘 경우
    const metricsFail = computeValidationMetrics(gts, aisFail, [], []);
    expect(metricsFail.status).toBe("FAIL");
  });
});

describe("photo metrics", () => {
  function photo(overrides: Partial<ExtractedPhoto>): ExtractedPhoto {
    return {
      id: "P001",
      sourceFile: "report.pdf",
      page: 120,
      photoNo: "③-01",
      caption: "소단측구 균열",
      section: "1구간",
      part: "배수시설",
      subPart: "소단측구",
      location: "165m",
      damageName: "균열",
      image: { dataUrl: "", width: 1, height: 1 },
      damageRelated: true,
      nearbyText: null,
      ocrText: null,
      ocrConfidence: null,
      visionInference: null,
      sourceRef: { page: 120 },
      duplicateCandidate: false,
      duplicateOfIds: [],
      matchCandidates: [],
      linkedDamageIds: [],
      status: "confirmed",
      extractionStatus: "ok",
      ...overrides,
    };
  }

  function gtPhoto(overrides: Partial<GroundTruthPhoto>): GroundTruthPhoto {
    return { id: "GT-P001", photoNo: "③-01", page: 120, linkedDamageIds: ["GT-001"], ...overrides };
  }

  it("photo extraction precision/recall reflects missed and spurious photos", () => {
    const gtPhotos = [gtPhoto({}), gtPhoto({ id: "GT-P002", photoNo: "③-02", page: 121 })];
    const aiPhotos = [photo({ id: "P001", photoNo: "③-01" }), photo({ id: "P002", photoNo: "③-09", page: 130 })];
    const metrics = computeValidationMetrics([], [], gtPhotos, aiPhotos);
    expect(metrics.photoExtraction.tp).toBe(1); // ③-01만 일치
    expect(metrics.photoExtraction.fn).toBe(1); // ③-02 놓침
    expect(metrics.photoExtraction.fp).toBe(1); // ③-09는 GT에 없음
  });

  it("photo link metrics compare expected vs actual links only for matched damages", () => {
    const g = gt({ id: "GT-001" });
    const a = ai({ id: "③-01", photoIds: ["P001"] });
    const gtPhotos = [gtPhoto({ linkedDamageIds: ["GT-001"] })];
    const aiPhotos = [photo({ id: "P001", photoNo: "③-01", linkedDamageIds: ["③-01"] })];
    const metrics = computeValidationMetrics([g], [a], gtPhotos, aiPhotos);
    expect(metrics.photoLink.tp).toBe(1);
    expect(metrics.photoLink.fp).toBe(0);
    expect(metrics.photoLink.fn).toBe(0);
  });
});

describe("cross-validation breakdown", () => {
  it("returns null accuracy when Ground Truth never specifies an expected result (no fabrication)", () => {
    const matched = [{ gt: gt({}), ai: ai({ crossValidation: { enabled: true, result: "matched", confidence: 0.9, evidenceCount: 1, evidence: [], conflicts: [], reviewRequired: false } }) }];
    const metrics = computeValidationMetrics(
      matched.map((m) => m.gt),
      matched.map((m) => m.ai),
      [],
      []
    );
    expect(metrics.crossValidation.accuracy).toBeNull();
    expect(metrics.crossValidation.matched).toBe(1);
  });
});
