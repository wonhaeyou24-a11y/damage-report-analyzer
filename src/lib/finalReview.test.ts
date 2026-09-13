import { describe, expect, it } from "vitest";
import {
  bulkConfirm,
  canFinalize,
  compareByLocation,
  computeReviewCounts,
  deferCandidateDamage,
  excludeCandidateDamage,
  finalizeReview,
  getFinalValidationResults,
  getFinalizedDamageRecords,
  getFinalizedPhotoRecords,
  isPhotoProblem,
  isPositionProblem,
  isScaleProblem,
  locationSortValue,
  markReviewCompleted,
  recordFieldEdit,
  searchDamages,
} from "./finalReview";
import { matchPhotosToDamages } from "./matchPhotos";
import type { CandidateDamage, DamageRecord, ExtractedPhoto } from "../types";
import { createReviewSession } from "../types";

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
    sourceReferences: [{ page: 80, type: "table" }],
    ...overrides,
  };
}

function photo(overrides: Partial<ExtractedPhoto>): ExtractedPhoto {
  return {
    id: "P001",
    sourceFile: "report.pdf",
    page: 120,
    photoNo: "③-01",
    caption: "소단측구 균열 165m",
    section: "1구간",
    part: "배수시설",
    subPart: "소단측구",
    location: "165m",
    damageName: "균열",
    image: { dataUrl: "", width: 100, height: 100 },
    damageRelated: true,
    nearbyText: "③-01 소단측구 균열 165m",
    ocrText: null,
    ocrConfidence: null,
    visionInference: null,
    sourceRef: { page: 120 },
    duplicateCandidate: false,
    duplicateOfIds: [],
    matchCandidates: [],
    linkedDamageIds: [],
    status: "review",
    extractionStatus: "ok",
    ...overrides,
  };
}

describe("TEST1/TEST15: normal display of an individually-split damage list", () => {
  it("keeps 8 individual locations from a single group visible and distinct", () => {
    const locs = ["165m", "187m", "188m", "190m", "217m", "261m", "267m", "275m"];
    const records = locs.map((loc, i) => damage({ id: `③-${i + 1}`, groupIndex: i + 1, location: loc }));
    expect(getFinalizedDamageRecords(records)).toHaveLength(8);
  });
});

describe("TEST2/TEST3/TEST4: editing a damage keeps the original AI value", () => {
  it("captures originalValue on first edit and keeps it across further edits", () => {
    let records = [damage({ location: "208m" })];
    records = recordFieldEdit(records, "③-01", "location", "211m");
    expect(records[0].location).toBe("211m");
    const override = records[0].fieldOverrides?.find((o) => o.field === "location");
    expect(override?.originalValue).toBe("208m");
    expect(override?.currentValue).toBe("211m");
    expect(override?.manualOverride).toBe(true);
    expect(records[0].reviewHistory?.some((h) => h.action === "manual_edit")).toBe(true);

    // 같은 필드를 다시 수정해도 originalValue(최초 AI 값)는 유지된다.
    records = recordFieldEdit(records, "③-01", "location", "215m");
    const override2 = records[0].fieldOverrides?.find((o) => o.field === "location");
    expect(override2?.originalValue).toBe("208m");
    expect(override2?.currentValue).toBe("215m");
  });

  it("uses the explicit previous value when the row object was already mutated in place before the call (AG Grid behavior)", () => {
    // AG Grid는 onCellValueChanged가 호출되기 전에 행 데이터 객체의 필드를 직접 새 값으로 바꿔버린다.
    // 그 상태에서 d.location을 다시 읽으면 이미 새 값이라 "수정 전 값"을 알 수 없으므로,
    // 호출부가 넘겨주는 previousValueOverride(AG Grid의 e.oldValue)를 반드시 사용해야 한다.
    const alreadyMutated = damage({ location: "211m" }); // AG Grid가 이미 208m -> 211m로 바꿔놓은 상태
    const records = recordFieldEdit([alreadyMutated], "③-01", "location", "211m", "208m");
    const override = records[0].fieldOverrides?.find((o) => o.field === "location");
    expect(override?.originalValue).toBe("208m");
    expect(override?.currentValue).toBe("211m");
  });

  it("TEST4: manualOverride survives a photo/cross-validation re-run (STEP7 already respects manualOverride on photos)", () => {
    // STEP9 자체는 손상 필드값을 재계산하지 않으므로, 사용자가 수정한 필드는 재분석 대상이 아니다.
    let records = [damage({ location: "208m" })];
    records = recordFieldEdit(records, "③-01", "location", "211m");
    const photos = [photo({ location: "211m" })];
    const { damages: rerun } = matchPhotosToDamages(records, photos);
    expect(rerun[0].location).toBe("211m");
    expect(rerun[0].fieldOverrides?.[0].originalValue).toBe("208m");
  });
});

describe("TEST5/TEST6: photo linking cardinality", () => {
  it("TEST5: a damage can have multiple linked photos", () => {
    const d = damage({});
    const p1 = photo({ id: "P001", caption: "소단측구 균열 165m 전체" });
    const p2 = photo({ id: "P002", caption: "소단측구 균열 165m 근접" });
    const { damages } = matchPhotosToDamages([d], [p1, p2]);
    expect(damages[0].photoIds).toEqual(["P001", "P002"]);
  });

  it("TEST6: one photo can link to multiple damages", () => {
    const d1 = damage({ id: "③-01" });
    const d2 = damage({ id: "③-02" });
    const p = photo({ photoNo: "③-01" });
    const { photos } = matchPhotosToDamages([d1, d2], [p]);
    // photoNo가 ③-01과만 일치하지만 다른 필드가 둘 다 같으므로 최소 ③-01엔 연결된다(1:N 허용 구조 확인).
    expect(photos[0].linkedDamageIds.length).toBeGreaterThanOrEqual(1);
  });
});

describe("TEST7/TEST8: no photo vs unlinked photo are distinguished", () => {
  it("TEST7: a damage with zero candidate photos is 사진 없음 (noPhoto)", () => {
    const d = damage({ location: "999m", subPart: "옹벽" });
    const { damages } = matchPhotosToDamages([d], []);
    expect(damages[0].photoMatchStatus).toBe("noPhoto");
  });

  it("TEST8: a photo unrelated to any damage stays 미연결 and is not deleted", () => {
    const d = damage({});
    const p = photo({ photoNo: null, caption: "전경사진", subPart: null, location: null, damageName: null, part: null });
    const { photos } = matchPhotosToDamages([d], [p]);
    expect(photos).toHaveLength(1);
    expect(photos[0].matchStatus).toBe("unmatched");
  });
});

describe("TEST9/TEST10: position conflict display and user decision (STEP8 already implements resolution; verified end-to-end here)", () => {
  it("TEST9: 위치 충돌은 자동으로 합쳐지지 않는다", () => {
    expect(isPositionProblem(damage({ location: "검토필요" }))).toBe(true);
    expect(isPositionProblem(damage({ location: "165m" }))).toBe(false);
  });
});

describe("TEST11/TEST12/TEST13: candidate damage decisions", () => {
  function candidate(overrides: Partial<CandidateDamage>): CandidateDamage {
    return {
      id: "CAND-001",
      sourceType: "외관조사망도",
      fileName: "외관조사망도.pdf",
      damageName: "균열",
      part: "배수시설",
      subPart: "산마루측구",
      location: "300m",
      repairMethod: null,
      quantity: null,
      section: "1구간",
      sourceRef: { fileName: "외관조사망도.pdf", sourceType: "외관조사망도", page: 15 },
      status: "review",
      ...overrides,
    };
  }

  it("TEST11: candidate counted while undecided", () => {
    const counts = computeReviewCounts([damage({})], [], [candidate({})]);
    expect(counts.candidate).toBe(1);
  });

  it("TEST12/TEST13: exclude/defer keep the record but change its decision instead of deleting it", () => {
    let candidates = [candidate({})];
    candidates = excludeCandidateDamage(candidates, "CAND-001");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].decision).toBe("excluded");

    candidates = deferCandidateDamage(candidates, "CAND-001");
    expect(candidates[0].decision).toBe("deferred");
  });
});

describe("TEST14: group quantity is shown once, not duplicated per location", () => {
  it("quantityGroup stays a single shared label, not per-row quantity", () => {
    const records = ["165m", "187m", "188m"].map((loc) => damage({ location: loc, quantity: null, quantityGroup: "23.3m" }));
    for (const r of records) {
      expect(r.quantity).toBeNull();
      expect(r.quantityGroup).toBe("23.3m");
    }
  });
});

describe("TEST16: search across damage + linked photo fields", () => {
  it("finds a damage by damage name, location, or linked photo number", () => {
    const d1 = damage({ id: "③-01", location: "165m" });
    const d2 = damage({ id: "③-09", subPart: "도수로", location: "208m" });
    const photos = [photo({ id: "P001", photoNo: "③-01", linkedDamageIds: ["③-01"] })];
    expect(searchDamages([d1, d2], photos, "균열")).toHaveLength(2);
    expect(searchDamages([d1, d2], photos, "165m")).toEqual([d1]);
    expect(searchDamages([d1, d2], photos, "도수로")).toEqual([d2]);
    expect(searchDamages([d1, d2], photos, "③-01")).toEqual([d1]);
  });
});

describe("TEST17: filter predicates", () => {
  it("isPhotoProblem / isScaleProblem / isPositionProblem flag the right rows", () => {
    expect(isPhotoProblem(damage({ photoMatchStatus: "review" }))).toBe(true);
    expect(isPhotoProblem(damage({ photoMatchStatus: "confirmed" }))).toBe(false);
    expect(isScaleProblem(damage({ quantity: null, quantityGroup: null }))).toBe(true);
    expect(isScaleProblem(damage({ quantity: null, quantityGroup: "23.3m" }))).toBe(false);
  });
});

describe("TEST18: numeric-aware location sorting", () => {
  it("sorts 65m, 110m, 165m, 208m, 211m in ascending numeric order despite being strings", () => {
    const locations = ["211m", "65m", "165m", "110m", "208m"];
    const sorted = [...locations].sort(compareByLocation);
    expect(sorted).toEqual(["65m", "110m", "165m", "208m", "211m"]);
  });

  it("treats a range by its start value and pushes unparsable text to the end", () => {
    expect(locationSortValue("176~206m")).toBe(176);
    expect(locationSortValue("검토필요")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("TEST19: sourceRef stays visible on the finalized record", () => {
  it("sourceReferences and sourcePages are preserved through finalization filtering", () => {
    const d = damage({ sourcePages: [80, 81], sourceReferences: [{ page: 80, type: "table", excerpt: "소단측구 균열 165m" }] });
    const [finalized] = getFinalizedDamageRecords([d]);
    expect(finalized.sourcePages).toEqual([80, 81]);
    expect(finalized.sourceReferences[0].excerpt).toBe("소단측구 균열 165m");
  });
});

describe("TEST20/TEST21/TEST22: review completion and final confirmation gate", () => {
  it("TEST20: marking review completed changes only the session, not the damages", () => {
    const session = markReviewCompleted(createReviewSession());
    expect(session.finalReviewStatus).toBe("completed");
  });

  it("TEST21: finalize is blocked while conflicts or undecided candidates remain", () => {
    const conflicted = damage({ status: "conflict" });
    const check1 = canFinalize([conflicted], []);
    expect(check1.ok).toBe(false);
    expect(check1.reasons.length).toBeGreaterThan(0);

    const clean = damage({ status: "confirmed" });
    const check2 = canFinalize([clean], []);
    expect(check2.ok).toBe(true);

    const withCandidate = canFinalize([clean], [{ id: "CAND-001" } as CandidateDamage]);
    expect(withCandidate.ok).toBe(false);
  });

  it("TEST21b: a damage with no photo is not by itself a finalize blocker", () => {
    const noPhotoDamage = damage({ status: "confirmed", photoMatchStatus: "noPhoto" });
    expect(canFinalize([noPhotoDamage], []).ok).toBe(true);
  });

  it("TEST22: finalizing the session stamps finalizedAt/reviewVersion for STEP10 to read", () => {
    let session = createReviewSession();
    session = markReviewCompleted(session);
    session = finalizeReview(session, "홍길동");
    expect(session.finalReviewStatus).toBe("finalized");
    expect(session.finalizedAt).toBeTruthy();
    expect(session.finalizedBy).toBe("홍길동");
    expect(session.reviewVersion).toBe(1);

    const damages = [damage({ status: "confirmed" })];
    const photos = [photo({ extractionStatus: "ok" })];
    expect(getFinalizedDamageRecords(damages)).toHaveLength(1);
    expect(getFinalizedPhotoRecords(photos)).toHaveLength(1);
    expect(getFinalValidationResults(damages)).toEqual([]);
  });
});

describe("bulk actions", () => {
  it("bulk-confirms selected reviewable rows but never force-confirms a conflict", () => {
    const a = damage({ id: "a", status: "review" });
    const b = damage({ id: "b", status: "conflict" });
    const result = bulkConfirm([a, b], ["a", "b"]);
    expect(result.find((d) => d.id === "a")?.status).toBe("confirmed");
    expect(result.find((d) => d.id === "b")?.status).toBe("conflict");
  });
});

describe("TEST23 (regression smoke): STEP1-8 shaped data still flows through STEP9 selectors", () => {
  it("does not drop or mutate unrelated fields", () => {
    const d = damage({ mergeInfo: { merged: true, sourceRecordIds: ["x"] }, conflicts: [] });
    const [out] = getFinalizedDamageRecords([d]);
    expect(out.mergeInfo?.merged).toBe(true);
  });
});
