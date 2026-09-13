import { describe, expect, it } from "vitest";
import type { DamageRecord, ExtractedPhoto, ReviewSession } from "../../types";
import { createReviewSession } from "../../types";
import { recordFieldEdit } from "../finalReview";
import { buildReanalyzedEvent, diffPhotosForQualityEvents, diffRecordsForQualityEvents, diffSessionForQualityEvents } from "./diffEvents";

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
    page: 5,
    photoNo: "①-01",
    caption: null,
    section: null,
    part: null,
    subPart: null,
    location: null,
    damageName: null,
    image: { dataUrl: "", width: 10, height: 10 },
    damageRelated: "unknown",
    nearbyText: null,
    ocrText: null,
    ocrConfidence: null,
    visionInference: null,
    sourceRef: { page: 5 },
    duplicateCandidate: false,
    duplicateOfIds: [],
    matchCandidates: [],
    linkedDamageIds: [],
    status: "review",
    extractionStatus: "ok",
    ...overrides,
  };
}

describe("diffRecordsForQualityEvents — TEST 3/4/5/6 (스펙 34번)", () => {
  it("사용자 수정 없음: 배열이 그대로면 이벤트가 없다", () => {
    const records = [damage({})];
    expect(diffRecordsForQualityEvents("R1", records, records)).toEqual([]);
  });

  it("사용자 수정: 필드 편집이 field_edited 이벤트로 기록되고 AI 원본값(from)을 보존한다", () => {
    const prev = [damage({})];
    const next = recordFieldEdit(prev, "③-01", "location", "168m");
    const events = diffRecordsForQualityEvents("R1", prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "field_edited", field: "location", from: "165m", to: "168m", recordId: "③-01" });
  });

  it("같은 편집을 두 번 diff해도 이미 기록된 변경은 중복 기록하지 않는다", () => {
    const prev = [damage({})];
    const afterFirstEdit = recordFieldEdit(prev, "③-01", "location", "168m");
    // 두 번째 diff는 "이전 상태"가 이미 afterFirstEdit이므로 새 이벤트가 없어야 한다.
    expect(diffRecordsForQualityEvents("R1", afterFirstEdit, afterFirstEdit)).toEqual([]);
  });

  it("손상 추가: NEW- id를 가진 새 레코드만 damage_added로 기록한다(AI가 만든 레코드는 추가로 안 본다)", () => {
    const prev: DamageRecord[] = [];
    const aiCreated = damage({ id: "③-01" }); // AI가 STEP4~5에서 만든 것 — 최초 분석이지 사용자 추가가 아니다
    const userAdded = damage({ id: "NEW-123", damageName: "" });
    const events = diffRecordsForQualityEvents("R1", prev, [aiCreated, userAdded]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "damage_added", recordId: "NEW-123" });
  });

  it("손상 삭제: 레코드가 사라지면 damage_deleted 이벤트로 핵심 필드를 스냅샷 보존한다", () => {
    const prev = [damage({ id: "③-01", damageName: "균열" })];
    const events = diffRecordsForQualityEvents("R1", prev, []);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "damage_deleted", recordId: "③-01" });
    expect(events[0].snapshot?.damageName).toBe("균열");
  });

  it("손상 제외: status가 excluded로 바뀌면 field_edited가 아니라 status_excluded로 분류한다", () => {
    const prev = [damage({})];
    const next = recordFieldEdit(prev, "③-01", "status", "excluded");
    const events = diffRecordsForQualityEvents("R1", prev, next);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("status_excluded");
  });

  it("교차검증 충돌 해결이 cross_validation_resolved로 기록된다", () => {
    const prev = [
      damage({
        crossValidation: {
          enabled: true,
          result: "conflict",
          confidence: 0.5,
          evidenceCount: 1,
          evidence: [],
          conflicts: [
            {
              field: "location",
              mainReport: { value: "165m", source: "본문" },
              additional: { value: "168m", source: "사진대지", fileName: "add.xlsx", sourceType: "사진대지" },
            },
          ],
          reviewRequired: true,
        },
      }),
    ];
    const next: DamageRecord[] = [
      {
        ...prev[0],
        crossValidation: {
          ...prev[0].crossValidation!,
          conflicts: [
            { ...prev[0].crossValidation!.conflicts[0], resolved: { value: "168m", source: "manual", decidedAt: "2026-01-01T00:00:00.000Z" } },
          ],
        },
      },
    ];
    const events = diffRecordsForQualityEvents("R1", prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "cross_validation_resolved", field: "location", from: "165m", to: "168m" });
  });

  it("재검토(값 변경 없이 검수만 완료)는 bulk_reviewed로 구분되고 field_edited와 섞이지 않는다", () => {
    const prev = [damage({})];
    const next: DamageRecord[] = [
      { ...prev[0], status: "confirmed", reviewHistory: [{ at: "2026-01-01T00:00:00.000Z", action: "review_completed", source: "manual" }] },
    ];
    const events = diffRecordsForQualityEvents("R1", prev, next);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("bulk_reviewed");
  });
});

describe("diffPhotosForQualityEvents — TEST 7/8/9 (사진 연결, N:M)", () => {
  it("사진 연결: manuallyLinkPhoto로 연결된 사진이 photo_linked로 기록된다", () => {
    const prev = [photo({ id: "P001", linkedDamageIds: [] })];
    const next = [photo({ id: "P001", linkedDamageIds: ["③-01"], matchSource: "manual" })];
    const events = diffPhotosForQualityEvents("R1", prev, next);
    expect(events).toEqual([expect.objectContaining({ type: "photo_linked", recordId: "③-01", to: "P001" })]);
  });

  it("사진 연결 변경: AI가 D003에 연결했던 사진을 사용자가 D004로 바꾸면 연결/해제가 모두 기록된다", () => {
    const prev = [photo({ id: "P001", linkedDamageIds: ["D003"], matchSource: "auto" })];
    const next = [photo({ id: "P001", linkedDamageIds: ["D004"], matchSource: "manual" })];
    const events = diffPhotosForQualityEvents("R1", prev, next);
    expect(events).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({ type: "photo_unlinked", recordId: "D003", from: "P001" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "photo_linked", recordId: "D004", to: "P001" }));
  });

  it("N:M 연결: 사진 1장이 손상 2건에 동시에 연결되면 연결 이벤트가 2건 기록된다", () => {
    const prev = [photo({ id: "P001", linkedDamageIds: [] })];
    const next = [photo({ id: "P001", linkedDamageIds: ["D001", "D002"], matchSource: "manual" })];
    const events = diffPhotosForQualityEvents("R1", prev, next);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.recordId).sort()).toEqual(["D001", "D002"]);
  });

  it("자동 재매칭 결과(matchSource:auto)는 사용자 행동이 아니므로 이벤트를 남기지 않는다", () => {
    const prev = [photo({ id: "P001", linkedDamageIds: [], matchSource: "none" })];
    const next = [photo({ id: "P001", linkedDamageIds: ["D001"], matchSource: "auto" })];
    expect(diffPhotosForQualityEvents("R1", prev, next)).toEqual([]);
  });
});

describe("diffSessionForQualityEvents / buildReanalyzedEvent — TEST 11/12", () => {
  it("검수 완료 전이만 review_completed로 기록하고, 무관한 세션 편집(보고서명 입력 등)은 무시한다", () => {
    const s0: ReviewSession = createReviewSession();
    const s1: ReviewSession = { ...s0, reportName: "테스트 보고서" };
    expect(diffSessionForQualityEvents("R1", s0, s1)).toEqual([]);
    const s2: ReviewSession = { ...s1, finalReviewStatus: "completed" };
    const events = diffSessionForQualityEvents("R1", s1, s2);
    expect(events).toEqual([expect.objectContaining({ type: "review_completed" })]);
  });

  it("최종 확정 전이가 finalized로 기록된다", () => {
    const s0: ReviewSession = { ...createReviewSession(), finalReviewStatus: "completed" };
    const s1: ReviewSession = { ...s0, finalReviewStatus: "finalized", finalizedAt: "2026-01-01T00:00:00.000Z" };
    const events = diffSessionForQualityEvents("R1", s0, s1);
    expect(events).toEqual([expect.objectContaining({ type: "finalized" })]);
  });

  it("재분석 이벤트는 항상 reanalyzed 타입을 갖는다", () => {
    expect(buildReanalyzedEvent("R1")).toMatchObject({ reportId: "R1", type: "reanalyzed", recordId: null });
  });
});
