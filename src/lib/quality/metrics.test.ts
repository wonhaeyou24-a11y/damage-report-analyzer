import { describe, expect, it } from "vitest";
import type { AnalyzedReport } from "../reportStorage";
import type { DamageRecord, ExtractedPhoto } from "../../types";
import { createReviewSession } from "../../types";
import type { AnalysisRunMeta, QualityEvent } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";
import {
  computeCrossValidationChangeRate,
  computeErrorCategoryBreakdown,
  computeFieldRetention,
  computeImprovementCandidates,
  computePhotoExtractionQuality,
  computePhotoLinkRetention,
  computeRecentTrend,
  computeVersionBreakdown,
  computeWorkQualitySummary,
} from "./metrics";

function damage(overrides: Partial<DamageRecord>): DamageRecord {
  return {
    id: "D1",
    groupNo: "①",
    groupIndex: 1,
    section: "1구간",
    damageName: "균열",
    part: "배수시설",
    subPart: "소단측구",
    location: "165m",
    repairMethod: "주입보수",
    quantity: null,
    quantityGroup: null,
    photos: [],
    status: "review",
    sourcePages: [1],
    sourceReferences: [],
    ...overrides,
  };
}

function reviewedUnchanged(id: string): DamageRecord {
  // "검토했지만 안 고침" — 스펙 6번 ②. status를 confirmed로 바꾸는 것만으로 "검토됨"을 표현한다.
  return damage({ id, status: "confirmed" });
}

function reviewedModified(id: string, field: "location" = "location"): DamageRecord {
  return damage({
    id,
    location: "168m",
    fieldOverrides: [{ field, originalValue: "165m", currentValue: "168m", manualOverride: true, changedAt: "2026-01-01T00:00:00.000Z" }],
  });
}

function report(overrides: Partial<AnalyzedReport>): AnalyzedReport {
  return {
    id: "R1",
    sourceName: "test.pdf",
    createdAt: "2026-01-01T00:00:00.000Z",
    records: [],
    photos: [],
    documents: [],
    candidateDamages: [],
    session: createReviewSession(),
    exportHistory: [],
    analysisRuns: [],
    qualityEvents: [],
    ...overrides,
  };
}

describe("computeWorkQualitySummary / computeFieldRetention — 스펙 35번 anti-fabrication 케이스", () => {
  it("검토 후 유지 90 / 수정 10 → 유지율 90%, 수정률 10%로만 표시하고 Recall이라 부르지 않는다", () => {
    const records = [...Array.from({ length: 90 }, (_, i) => reviewedUnchanged(`U${i}`)), ...Array.from({ length: 10 }, (_, i) => reviewedModified(`M${i}`))];
    const reports = [report({ records })];
    const summary = computeWorkQualitySummary(reports);
    expect(summary.reviewedDamages).toBe(100);
    expect(summary.userModifiedDamages).toBe(10);

    const retention = computeFieldRetention(reports).find((r) => r.field === "location")!;
    expect(retention.retained).toBe(90);
    expect(retention.modified).toBe(10);
    expect(retention.metric.value).toBeCloseTo(0.9);
    // 반환값 자체에 "recall"이라는 이름의 필드가 없다 — 유지율(metric.value)만 있다.
    expect(retention).not.toHaveProperty("recall");
  });

  it("미검토 손상(status가 여전히 review이고 손댄 적 없음)은 유지율 계산에서 제외된다", () => {
    const reviewed = reviewedUnchanged("R-reviewed");
    const untouched = [reviewed, ...Array.from({ length: MIN_SAMPLE_SIZE + 4 }, (_, i) => damage({ id: `T${i}` }))]; // 나머지는 손댄 적 없음(status:"review", overrides 없음)
    const reports = [report({ records: untouched })];
    const summary = computeWorkQualitySummary(reports);
    expect(summary.reviewedDamages).toBe(1);
    expect(summary.unreviewedDamages).toBe(MIN_SAMPLE_SIZE + 4);
  });

  it("AI 분석 100개 + 사용자 추가 5개만으로 Recall=95%를 계산하지 않는다 — userAddedDamages 카운트만 제공한다", () => {
    const aiRecords = Array.from({ length: 100 }, (_, i) => reviewedUnchanged(`A${i}`));
    const userAdded = Array.from({ length: 5 }, (_, i) => damage({ id: `NEW-${i}` }));
    const summary = computeWorkQualitySummary([report({ records: [...aiRecords, ...userAdded] })]);
    expect(summary.userAddedDamages).toBe(5);
    expect(summary).not.toHaveProperty("recall");
  });

  it("표본이 최소치 미만이면 metric.value가 null이고 sufficient가 false다(데이터 부족 표시용)", () => {
    const reports = [report({ records: [reviewedModified("M1")] })]; // 표본 1건
    const retention = computeFieldRetention(reports).find((r) => r.field === "location")!;
    expect(retention.metric.sufficient).toBe(false);
    expect(retention.metric.sampleSize).toBe(1);
  });

  it("보고서/손상이 전혀 없으면 모든 값이 0이고 허위 100%를 표시하지 않는다", () => {
    const summary = computeWorkQualitySummary([]);
    expect(summary.totalDamages).toBe(0);
    const retention = computeFieldRetention([]);
    expect(retention.every((r) => r.metric.value === null && r.metric.sampleSize === 0)).toBe(true);
  });
});

describe("computePhotoExtractionQuality / computePhotoLinkRetention", () => {
  function photo(overrides: Partial<ExtractedPhoto>): ExtractedPhoto {
    return {
      id: "P1",
      sourceFile: "r.pdf",
      page: 1,
      photoNo: null,
      caption: null,
      section: null,
      part: null,
      subPart: null,
      location: null,
      damageName: null,
      image: { dataUrl: "", width: 1, height: 1 },
      damageRelated: "unknown",
      nearbyText: null,
      ocrText: null,
      ocrConfidence: null,
      visionInference: null,
      sourceRef: { page: 1 },
      duplicateCandidate: false,
      duplicateOfIds: [],
      matchCandidates: [],
      linkedDamageIds: [],
      status: "confirmed",
      extractionStatus: "ok",
      ...overrides,
    };
  }

  it("추출 성공/실패 건수로 사진 추출 품질을 계산한다(사람 판단 불필요한 객관적 사실)", () => {
    const photos = [photo({ extractionStatus: "ok" }), photo({ extractionStatus: "ok" }), photo({ extractionStatus: "failed" })];
    const metric = computePhotoExtractionQuality([report({ photos })]);
    expect(metric.value).toBeCloseTo(2 / 3);
    expect(metric.sampleSize).toBe(3);
  });

  it("사진 추출과 사진 연결을 혼동하지 않는다 — 연결 유지율은 matchSource 기준으로 별도 계산", () => {
    const photos = [photo({ matchStatus: "confirmed", matchSource: "auto" }), photo({ matchSource: "manual" })];
    const metric = computePhotoLinkRetention([report({ photos })]);
    expect(metric.sampleSize).toBe(2);
    expect(metric.value).toBeCloseTo(0.5);
  });
});

describe("computeCrossValidationChangeRate / computeErrorCategoryBreakdown", () => {
  it("해결된 충돌 중 값이 실제로 바뀐 비율만 변경률로 센다", () => {
    const events: QualityEvent[] = [
      { id: "1", reportId: "R1", recordId: "D1", type: "cross_validation_resolved", from: "165m", to: "168m", at: "t", source: "manual" },
      { id: "2", reportId: "R1", recordId: "D2", type: "cross_validation_resolved", from: "165m", to: "165m", at: "t", source: "manual" },
    ];
    const metric = computeCrossValidationChangeRate(events);
    expect(metric.value).toBeCloseTo(0.5);
    expect(metric.sampleSize).toBe(2);
  });

  it("category가 있는 이벤트만 오류 유형별로 집계하고 빈도 내림차순 정렬한다", () => {
    const events: QualityEvent[] = [
      { id: "1", reportId: "R1", recordId: "D1", type: "field_edited", category: "LOCATION_ERROR", at: "t", source: "manual" },
      { id: "2", reportId: "R1", recordId: "D2", type: "field_edited", category: "LOCATION_ERROR", at: "t", source: "manual" },
      { id: "3", reportId: "R1", recordId: "D3", type: "field_edited", category: "DAMAGE_NAME_ERROR", at: "t", source: "manual" },
      { id: "4", reportId: "R1", recordId: null, type: "reanalyzed", at: "t", source: "manual" },
    ];
    expect(computeErrorCategoryBreakdown(events)).toEqual([
      { category: "LOCATION_ERROR", count: 2 },
      { category: "DAMAGE_NAME_ERROR", count: 1 },
    ]);
  });
});

describe("computeRecentTrend", () => {
  it("표본이 window*2보다 적으면 추세를 표시하지 않는다(성급한 판단 방지)", () => {
    const events: QualityEvent[] = Array.from({ length: 5 }, (_, i) => ({
      id: `${i}`,
      reportId: "R1",
      recordId: "D1",
      type: "field_edited",
      category: "LOCATION_ERROR",
      at: `2026-01-0${i + 1}T00:00:00.000Z`,
      source: "manual",
    }));
    expect(computeRecentTrend(events, 10)).toEqual([]);
  });

  it("최근 구간의 오류 비율이 낮아지면 improved로 표시한다", () => {
    const older: QualityEvent[] = Array.from({ length: 10 }, (_, i) => ({
      id: `old${i}`,
      reportId: "R1",
      recordId: "D1",
      type: "field_edited",
      category: i < 5 ? "LOCATION_ERROR" : "DAMAGE_NAME_ERROR",
      at: `2026-01-01T00:00:0${i}.000Z`,
      source: "manual",
    }));
    const recent: QualityEvent[] = Array.from({ length: 10 }, (_, i) => ({
      id: `new${i}`,
      reportId: "R1",
      recordId: "D1",
      type: "field_edited",
      category: i < 1 ? "LOCATION_ERROR" : "DAMAGE_NAME_ERROR",
      at: `2026-02-01T00:00:0${i}.000Z`,
      source: "manual",
    }));
    const trend = computeRecentTrend([...older, ...recent], 10);
    const location = trend.find((t) => t.category === "LOCATION_ERROR")!;
    expect(location.direction).toBe("improved");
    expect(location.previousSample).toBe(10);
    expect(location.recentSample).toBe(10);
  });
});

describe("computeVersionBreakdown — Provider/Model/Prompt/Engine 버전별 추적", () => {
  function run(overrides: Partial<AnalysisRunMeta>): AnalysisRunMeta {
    return { id: "AR1", kind: "initial", provider: "gemini", model: "gemini-2.5-flash", promptVersion: "v1", engineVersion: "1.0.0", runAt: "t", recordCount: 1, ...overrides };
  }

  it("provider/model/promptVersion/engineVersion 조합별로 묶어서 유지율을 계산한다", () => {
    const reportA = report({ id: "RA", records: [reviewedUnchanged("A1")], analysisRuns: [run({})] });
    const reportB = report({ id: "RB", records: [reviewedModified("B1")], analysisRuns: [run({ engineVersion: "1.1.0" })] });
    const breakdown = computeVersionBreakdown([reportA, reportB]);
    expect(breakdown).toHaveLength(2);
    expect(breakdown.find((b) => b.engineVersion === "1.0.0")?.reportCount).toBe(1);
    expect(breakdown.find((b) => b.engineVersion === "1.1.0")?.reportCount).toBe(1);
  });

  it("analysisRuns에 initial 실행 기록이 없는(legacy) 보고서는 버전을 알 수 없으므로 제외한다", () => {
    const legacyReport = report({ id: "RL", records: [reviewedUnchanged("L1")], analysisRuns: [], legacy: true });
    expect(computeVersionBreakdown([legacyReport])).toEqual([]);
  });
});

describe("computeImprovementCandidates — 스펙 29번: 후보 제안까지만, 자동 변경 없음", () => {
  it("수정률이 임계치를 넘고 표본이 충분한 필드만 후보로 제안한다", () => {
    const records = [
      ...Array.from({ length: 10 }, (_, i) => reviewedModified(`M${i}`)), // location 100% 수정
      ...Array.from({ length: 10 }, (_, i) => reviewedUnchanged(`U${i}`)), // 다른 필드는 안 바뀜
    ];
    const candidates = computeImprovementCandidates([report({ records })]);
    expect(candidates.some((c) => c.field === "location")).toBe(true);
    expect(candidates.find((c) => c.field === "location")?.sampleSize).toBe(20);
    // 메시지가 "권장"이라고만 하지, 실제로 아무 것도 변경하지 않는다(순수 함수라 Prompt/Rule을 건드릴 수 없음이 구조로 보장됨).
    expect(candidates.find((c) => c.field === "location")?.message).toContain("검토 권장");
  });
});
