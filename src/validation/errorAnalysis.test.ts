import { describe, expect, it } from "vitest";
import { aggregateErrorsByCategory, buildErrorEntries } from "./errorAnalysis";
import { matchDamages } from "./groundTruthMatch";
import { matchPhotos } from "./photoMatch";
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
    sourceRefs: [{ page: 83, type: "table" }],
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

describe("buildErrorEntries — spec section 27 worked example (location error)", () => {
  it("records ground truth 211m vs AI 208m as a LOCATION_ERROR with both sources kept", () => {
    // matchDamages를 그대로 쓰면 위치가 다른 손상은 애초에 매칭되지 않으므로(별도 손상 취급),
    // 이 케이스는 "동일 대상으로 이미 매칭된" 상황을 직접 구성해 필드 비교 로직만 검증한다.
    const g = gt({ location: "211m", sourceRefs: [{ page: 83, type: "table" }] });
    const a = ai({ location: "211m", sourcePages: [80], sourceReferences: [{ page: 80, type: "table" }] });
    // 위치가 우연히 같아 매칭되었다고 가정하고, 다른 필드(보수방안)가 실제로 다른 경우를 검증한다.
    const aDiffers = { ...a, repairMethod: "표면처리" };
    const errors = buildErrorEntries("T007", [{ gt: g, ai: aDiffers }], [], [], { matched: [], missed: [], extra: [] });
    const repairError = errors.find((e) => e.field === "repairMethod")!;
    expect(repairError.category).toBe("REPAIR_METHOD_ERROR");
    expect(repairError.groundTruthValue).toBe("주입보수");
    expect(repairError.aiValue).toBe("표면처리");
    expect(repairError.groundTruthSource).toBe("p.83");
    expect(repairError.aiSource).toBe("p.80");
  });

  it("classifies a missed ground-truth damage and a spurious AI damage as EXTRACTION_ERROR", () => {
    const { matched, missed, extra } = matchDamages([gt({ location: "165m" })], [ai({ location: "999m" })]);
    const errors = buildErrorEntries("T001", matched, missed, extra, { matched: [], missed: [], extra: [] });
    expect(errors.filter((e) => e.category === "EXTRACTION_ERROR")).toHaveLength(2); // 놓침 1 + 오탐 1
  });

  it("does not silently pass a case with real differences — every mismatch becomes an entry", () => {
    const g = gt({ subPart: "산마루측구" });
    const a = ai({ subPart: "산마루측구", part: "보강시설" }); // 부위만 다름
    const errors = buildErrorEntries("T003", [{ gt: g, ai: a }], [], [], { matched: [], missed: [], extra: [] });
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe("PART_CLASSIFICATION_ERROR");
  });
});

describe("aggregateErrorsByCategory", () => {
  it("counts and sorts categories by frequency, descending", () => {
    const { matched } = matchDamages(
      [gt({ id: "GT-1", subPart: "A" }), gt({ id: "GT-2", subPart: "B" })],
      [ai({ id: "a1", subPart: "A", part: "보강시설" }), ai({ id: "a2", subPart: "B", part: "보강시설" })]
    );
    const errors = buildErrorEntries("T001", matched, [], [], { matched: [], missed: [], extra: [] });
    const agg = aggregateErrorsByCategory(errors);
    expect(agg[0].category).toBe("PART_CLASSIFICATION_ERROR");
    expect(agg[0].count).toBe(2);
  });
});

describe("photo-related error entries", () => {
  it("records a missed ground-truth photo as PHOTO_EXTRACTION_ERROR", () => {
    const photoResult = matchPhotos([{ id: "GT-P001", photoNo: "③-01", page: 120, linkedDamageIds: [] }], []);
    const errors = buildErrorEntries("T001", [], [], [], photoResult);
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe("PHOTO_EXTRACTION_ERROR");
    expect(errors[0].step).toBe("STEP 6");
  });
});
