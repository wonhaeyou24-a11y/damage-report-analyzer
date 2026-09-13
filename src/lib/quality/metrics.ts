import type { AnalyzedReport } from "../reportStorage";
import type { EditableDamageField } from "../../types";
import type { ErrorCategory } from "../../validation/types";
import { computeMetric, type MetricValue, type QualityEvent } from "./types";

/**
 * STEP11(업무기반) 품질 계산 엔진. 전부 순수 함수 — App/컴포넌트 상태에 의존하지 않는다.
 *
 * 반드시 지킨다(스펙 6/8/12/13/18/24번):
 * - 검토되지 않은 손상은 "AI가 맞았다"는 근거로 쓰지 않는다(unreviewed 제외).
 * - 사용자가 고치지 않았다고 정답으로 단정하지 않는다 — "유지율"이라고만 부른다.
 * - 표본이 부족하면(MIN_SAMPLE_SIZE 미만) value를 null로 두고 UI가 "데이터 부족"을 표시하게 한다.
 * - 손상 추가/삭제만으로 Recall을 계산하지 않는다(실제 누락 총량을 모르므로).
 */

const FIELD_LABELS: Record<Exclude<EditableDamageField, "status">, string> = {
  section: "구간",
  damageName: "손상명",
  part: "부위",
  subPart: "세부부위",
  location: "위치",
  repairMethod: "보수방안",
  quantity: "규모/물량",
};
const TRACKED_FIELDS = Object.keys(FIELD_LABELS) as Exclude<EditableDamageField, "status">[];

function isReviewed(d: { fieldOverrides?: unknown[]; status: string; reviewHistory?: unknown[] }): boolean {
  return (d.fieldOverrides?.length ?? 0) > 0 || d.status !== "review" || (d.reviewHistory?.length ?? 0) > 0;
}

export interface WorkQualitySummary {
  totalReports: number;
  totalDamages: number;
  reviewedDamages: number;
  unreviewedDamages: number;
  userModifiedDamages: number;
  userAddedDamages: number;
  userExcludedDamages: number;
}

/** 스펙 22/38번 [전체 품질] 블록. 손상 레코드 현재 상태만 보면 되므로 legacy 보고서도 그대로 포함된다. */
export function computeWorkQualitySummary(reports: AnalyzedReport[]): WorkQualitySummary {
  let totalDamages = 0;
  let reviewedDamages = 0;
  let userModifiedDamages = 0;
  let userAddedDamages = 0;
  let userExcludedDamages = 0;

  for (const r of reports) {
    for (const d of r.records) {
      totalDamages++;
      if (isReviewed(d)) reviewedDamages++;
      if ((d.fieldOverrides?.length ?? 0) > 0) userModifiedDamages++;
      if (d.id.startsWith("NEW-")) userAddedDamages++;
      if (d.status === "excluded") userExcludedDamages++;
    }
  }

  return {
    totalReports: reports.length,
    totalDamages,
    reviewedDamages,
    unreviewedDamages: totalDamages - reviewedDamages,
    userModifiedDamages,
    userAddedDamages,
    userExcludedDamages,
  };
}

export interface FieldRetentionRow {
  field: string;
  label: string;
  retained: number;
  modified: number;
  metric: MetricValue;
}

/** 스펙 11/36/38번 필드별 "검토 후 유지율". 검토된 손상만 대상으로 한다(스펙 6번 ②③ 구분). */
export function computeFieldRetention(reports: AnalyzedReport[]): FieldRetentionRow[] {
  const counts = new Map(TRACKED_FIELDS.map((f) => [f, { retained: 0, modified: 0 }]));
  for (const r of reports) {
    for (const d of r.records) {
      if (!isReviewed(d)) continue;
      const overriddenFields = new Set((d.fieldOverrides ?? []).map((o) => o.field));
      for (const f of TRACKED_FIELDS) {
        const c = counts.get(f)!;
        if (overriddenFields.has(f)) c.modified++;
        else c.retained++;
      }
    }
  }
  return TRACKED_FIELDS.map((f) => {
    const c = counts.get(f)!;
    return { field: f, label: FIELD_LABELS[f], retained: c.retained, modified: c.modified, metric: computeMetric(c.retained, c.retained + c.modified) };
  });
}

/** 스펙 9/10번 사진 추출 품질 — extractionStatus는 사람 판단이 필요 없는 사실이라 그대로 계산 가능. */
export function computePhotoExtractionQuality(reports: AnalyzedReport[]): MetricValue {
  let ok = 0;
  let total = 0;
  for (const r of reports) for (const p of r.photos) {
    total++;
    if (p.extractionStatus === "ok") ok++;
  }
  return computeMetric(ok, total);
}

/** 스펙 9/10번 사진 연결 유지율 — AI가 자동 확정한 연결(matchSource:"auto")이 그대로 남았는지,
 * 아니면 사용자가 손댔는지(matchSource:"manual")를 기준으로 한다. */
export function computePhotoLinkRetention(reports: AnalyzedReport[]): MetricValue {
  let retained = 0;
  let modified = 0;
  for (const r of reports) for (const p of r.photos) {
    if (p.matchStatus === "confirmed" && p.matchSource === "auto") retained++;
    else if (p.matchSource === "manual") modified++;
  }
  return computeMetric(retained, retained + modified);
}

/** 스펙 8/13번 교차검증 변경률 — 사용자가 해결한 충돌 중 본문값을 그대로 채택하지 않고 바꾼 비율. */
export function computeCrossValidationChangeRate(events: QualityEvent[]): MetricValue {
  const resolved = events.filter((e) => e.type === "cross_validation_resolved");
  const changed = resolved.filter((e) => e.from !== e.to);
  return computeMetric(changed.length, resolved.length);
}

export interface ErrorCategoryRow {
  category: ErrorCategory;
  count: number;
}

/** 스펙 13/14/38번 — qualityEvents(이 기능 탑재 이후 실제로 기록된 이벤트)만 집계한다.
 * 기능 탑재 이전 과거 데이터는 소급해서 만들어내지 않는다(스펙 25번). */
export function computeErrorCategoryBreakdown(events: QualityEvent[]): ErrorCategoryRow[] {
  const counts = new Map<ErrorCategory, number>();
  for (const e of events) {
    if (!e.category) continue;
    counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}

export interface TrendComparison {
  category: ErrorCategory;
  recentRate: number;
  previousRate: number;
  recentSample: number;
  previousSample: number;
  direction: "improved" | "worsened" | "flat";
}

/** 스펙 14번 최근 추세 — 표본이 window 두 배(양쪽 채우기)에 못 미치면 아예 표시하지 않는다. */
export function computeRecentTrend(events: QualityEvent[], windowSize = 50): TrendComparison[] {
  const categorized = events.filter((e) => e.category).sort((a, b) => a.at.localeCompare(b.at));
  if (categorized.length < windowSize * 2) return [];

  const recent = categorized.slice(-windowSize);
  const previous = categorized.slice(-windowSize * 2, -windowSize);

  const countBy = (list: QualityEvent[]) => {
    const m = new Map<ErrorCategory, number>();
    for (const e of list) m.set(e.category!, (m.get(e.category!) ?? 0) + 1);
    return m;
  };
  const recentCounts = countBy(recent);
  const prevCounts = countBy(previous);
  const categories = new Set([...recentCounts.keys(), ...prevCounts.keys()]);

  return [...categories].map((category) => {
    const recentCount = recentCounts.get(category) ?? 0;
    const prevCount = prevCounts.get(category) ?? 0;
    const recentRate = recentCount / recent.length;
    const previousRate = prevCount / previous.length;
    const direction: TrendComparison["direction"] = recentRate < previousRate ? "improved" : recentRate > previousRate ? "worsened" : "flat";
    return { category, recentRate, previousRate, recentSample: recent.length, previousSample: previous.length, direction };
  });
}

export interface VersionBreakdownRow {
  key: string;
  provider: string;
  model: string;
  promptVersion: string;
  engineVersion: string;
  reportCount: number;
  fieldRetention: FieldRetentionRow[];
}

/** 스펙 16/17번 — Provider/Model/Prompt/Engine 조합별 유지율. legacy(analysisRuns 없는) 보고서는
 * 조합을 알 수 없으므로 별도 그룹으로 뭉치지 않고 breakdown에서 제외한다(허위로 묶지 않는다). */
export function computeVersionBreakdown(reports: AnalyzedReport[]): VersionBreakdownRow[] {
  const groups = new Map<string, AnalyzedReport[]>();
  for (const r of reports) {
    const initial = r.analysisRuns?.find((run) => run.kind === "initial");
    if (!initial) continue;
    const key = `${initial.provider}|${initial.model}|${initial.promptVersion}|${initial.engineVersion}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, list]) => {
    const [provider, model, promptVersion, engineVersion] = key.split("|");
    return { key, provider, model, promptVersion, engineVersion, reportCount: list.length, fieldRetention: computeFieldRetention(list) };
  });
}

export interface ImprovementCandidate {
  field: string;
  label: string;
  modifiedRate: number;
  sampleSize: number;
  message: string;
}

const IMPROVEMENT_THRESHOLD = 0.2;

/** 스펙 29번 — "개선 후보" 제안까지만. Prompt/Rule을 자동으로 바꾸지 않는다. */
export function computeImprovementCandidates(reports: AnalyzedReport[]): ImprovementCandidate[] {
  return computeFieldRetention(reports)
    .filter((row) => row.metric.sufficient && row.metric.value != null && row.metric.value < 1 - IMPROVEMENT_THRESHOLD)
    .map((row) => ({
      field: row.field,
      label: row.label,
      modifiedRate: 1 - (row.metric.value ?? 0),
      sampleSize: row.metric.sampleSize,
      message: `"${row.label}" 항목이 검토 대상 중 ${Math.round((1 - (row.metric.value ?? 0)) * 100)}%에서 수정됨 (표본 ${row.metric.sampleSize}건) — 관련 프롬프트/규칙 검토 권장.`,
    }))
    .sort((a, b) => b.modifiedRate - a.modifiedRate);
}
