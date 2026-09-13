import type { TestCase, ValidationRun } from "./types";

/**
 * STEP 11 — 시설물별/보고서 양식별/난이도별 집계(스펙 21~23, 42~43번). 실제로 테스트하지
 * 않은 그룹은 "N/A"로 남기고 0%로 표시하지 않는다.
 */
export interface GroupedMetric {
  key: string;
  testCount: number;
  avgF1: number;
  avgLocationAccuracy: number;
  avgPhotoLinkF1: number;
}

export interface RunPair {
  testCase: TestCase;
  run: ValidationRun;
}

function average(nums: number[]): number {
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function groupBy(pairs: RunPair[], keyFn: (tc: TestCase) => string): GroupedMetric[] {
  const groups = new Map<string, RunPair[]>();
  for (const pair of pairs) {
    const key = keyFn(pair.testCase);
    groups.set(key, [...(groups.get(key) ?? []), pair]);
  }
  return Array.from(groups.entries()).map(([key, group]) => ({
    key,
    testCount: group.length,
    avgF1: average(group.map((g) => g.run.metrics.overallF1)),
    avgLocationAccuracy: average(group.map((g) => g.run.metrics.fieldAccuracy.find((f) => f.field === "location")?.matchRate ?? 0)),
    avgPhotoLinkF1: average(group.map((g) => g.run.metrics.photoLink.f1)),
  }));
}

export function aggregateByFacilityType(pairs: RunPair[]): GroupedMetric[] {
  return groupBy(pairs, (tc) => tc.facilityType);
}

export function aggregateByReportFormat(pairs: RunPair[]): GroupedMetric[] {
  return groupBy(pairs, (tc) => tc.vendorType || tc.reportFormat || "미분류");
}

export function aggregateByDifficulty(pairs: RunPair[]): GroupedMetric[] {
  return groupBy(pairs, (tc) => tc.difficulty);
}

export interface OverallSummary {
  totalTestCases: number;
  completed: number;
  good: number;
  warning: number;
  fail: number;
  overallDamageF1: number;
  overallLocationAccuracy: number;
  overallPhotoExtractionF1: number;
  overallPhotoLinkF1: number;
}

export function computeOverallSummary(pairs: RunPair[], totalTestCases: number): OverallSummary {
  const runs = pairs.map((p) => p.run);
  return {
    totalTestCases,
    completed: pairs.length,
    good: runs.filter((r) => r.metrics.status === "GOOD").length,
    warning: runs.filter((r) => r.metrics.status === "WARNING").length,
    fail: runs.filter((r) => r.metrics.status === "FAIL").length,
    overallDamageF1: average(runs.map((r) => r.metrics.overallF1)),
    overallLocationAccuracy: average(runs.map((r) => r.metrics.fieldAccuracy.find((f) => f.field === "location")?.matchRate ?? 0)),
    overallPhotoExtractionF1: average(runs.map((r) => r.metrics.photoExtraction.f1)),
    overallPhotoLinkF1: average(runs.map((r) => r.metrics.photoLink.f1)),
  };
}

/**
 * "범용성 검증 완료" 판단(스펙 57번). 절대적인 보장을 표시하지 않고, 조건 충족 여부만
 * 사실대로 보고한다.
 */
export interface UniversalityCheck {
  ok: boolean;
  reasons: string[];
  label: string;
}

export function checkUniversalityCriteria(pairs: RunPair[], allTestCases: TestCase[]): UniversalityCheck {
  const reasons: string[] = [];
  if (pairs.length < 10) reasons.push(`완료된 테스트가 ${pairs.length}건입니다 (최소 10건 필요).`);

  const distinctFormats = new Set(pairs.map((p) => p.testCase.vendorType || p.testCase.reportFormat).filter(Boolean));
  if (distinctFormats.size < 2) reasons.push(`서로 다른 보고서 구조/양식이 ${distinctFormats.size}종입니다 (최소 2종 필요).`);

  const distinctFacilities = new Set(pairs.map((p) => p.testCase.facilityType));
  if (distinctFacilities.size < 2) reasons.push(`실제 테스트된 시설물 유형이 ${distinctFacilities.size}종입니다 (최소 2종 필요).`);

  const withoutGroundTruth = allTestCases.filter((tc) => !tc.groundTruth || !tc.groundTruth.locked);
  if (withoutGroundTruth.length > 0 && pairs.length < allTestCases.length) {
    reasons.push(`Ground Truth가 확정되지 않은 테스트 케이스가 있습니다.`);
  }

  const ok = reasons.length === 0;
  return {
    ok,
    reasons,
    label: ok ? "현재 테스트 데이터 기준 범용성 검증 완료" : "범용성 검증 기준 미충족",
  };
}
