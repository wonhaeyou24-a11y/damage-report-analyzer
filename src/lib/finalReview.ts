import type {
  CandidateDamage,
  DamageRecord,
  EditableDamageField,
  ExtractedPhoto,
  FieldOverride,
  ReviewHistoryEntry,
  ReviewSession,
} from "../types";
import { setDamageNoPhoto } from "./matchPhotos";

/**
 * STEP 9 — 최종 검토/검수.
 *
 * STEP 1~8이 만든 damageRecords/photoRecords/additionalDocuments/crossValidation을
 * 그대로 재사용한다. 새 데이터 구조로 복제하지 않고, DamageRecord에 필드 수정 이력
 * (fieldOverrides/reviewHistory)만 추가해 "AI 추출값 vs 사용자 수정값"을 구분한다.
 */

function fieldValue(d: DamageRecord, field: EditableDamageField): string {
  switch (field) {
    case "section":
      return d.section;
    case "damageName":
      return d.damageName;
    case "part":
      return d.part;
    case "subPart":
      return d.subPart;
    case "location":
      return d.location;
    case "repairMethod":
      return d.repairMethod;
    case "quantity":
      return d.quantity ?? "";
    case "status":
      return d.status;
  }
}

function withFieldValue(d: DamageRecord, field: EditableDamageField, value: string): DamageRecord {
  switch (field) {
    case "section":
      return { ...d, section: value };
    case "damageName":
      return { ...d, damageName: value };
    case "part":
      return { ...d, part: value as DamageRecord["part"] };
    case "subPart":
      return { ...d, subPart: value };
    case "location":
      return { ...d, location: value };
    case "repairMethod":
      return { ...d, repairMethod: value };
    case "quantity":
      return { ...d, quantity: value || null };
    case "status":
      return { ...d, status: value as DamageRecord["status"] };
  }
}

/**
 * 사용자가 셀을 직접 수정할 때 호출한다. 이 필드를 처음 수정하는 경우 "수정 직전 값"을
 * originalValue로 보존하고, 이미 수정 이력이 있으면 currentValue만 갱신한다(원본은 그대로).
 * 재분석(STEP7/8 재실행)이 이 값을 덮어쓰지 않도록 manualOverride:true로 표시한다.
 */
export function recordFieldEdit(
  records: DamageRecord[],
  id: string,
  field: EditableDamageField,
  newValue: string,
  previousValueOverride?: string
): DamageRecord[] {
  return records.map((d) => {
    if (d.id !== id) return d;
    // AG Grid는 셀 편집 시 onCellValueChanged가 호출되기 전에 행 데이터 객체를 직접 새 값으로
    // 변경해 버린다. 그 상태에서 d.location 등을 다시 읽으면 이미 새 값이라 "수정 전 값"을
    // 알 수 없으므로, 호출부(AG Grid의 e.oldValue)가 넘겨준 이전 값을 우선 사용한다.
    const previousValue = previousValueOverride ?? fieldValue(d, field);
    if (previousValue === newValue) return d;

    const existing = d.fieldOverrides?.find((o) => o.field === field);
    const changedAt = new Date().toISOString();
    const override: FieldOverride = {
      field,
      originalValue: existing?.originalValue ?? previousValue,
      currentValue: newValue,
      manualOverride: true,
      changedAt,
    };
    const fieldOverrides = [...(d.fieldOverrides ?? []).filter((o) => o.field !== field), override];

    const historyEntry: ReviewHistoryEntry = {
      at: changedAt,
      action: "manual_edit",
      field,
      from: previousValue,
      to: newValue,
      source: "manual",
    };

    return { ...withFieldValue(d, field, newValue), fieldOverrides, reviewHistory: [...(d.reviewHistory ?? []), historyEntry] };
  });
}

const LOCATION_SORT_PATTERN = /(\d+(?:\.\d+)?)/;

/**
 * 위치 문자열을 정렬 가능한 숫자로 바꾼다. "176~206m"처럼 범위면 시작값을 쓰고,
 * 숫자를 전혀 찾을 수 없으면(예: "검토필요") 맨 뒤로 정렬되도록 무한대를 반환한다.
 */
export function locationSortValue(location: string | null | undefined): number {
  if (!location) return Number.POSITIVE_INFINITY;
  const m = location.match(LOCATION_SORT_PATTERN);
  return m ? parseFloat(m[1]) : Number.POSITIVE_INFINITY;
}

export function compareByLocation(a: string | null | undefined, b: string | null | undefined): number {
  return locationSortValue(a) - locationSortValue(b);
}

/** 손상명/구간/부위/세부부위/위치/사진번호/페이지/보수방안을 대상으로 검색한다. */
export function searchDamages(records: DamageRecord[], photos: ExtractedPhoto[], query: string): DamageRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return records;

  const photoTextByDamageId = new Map<string, string>();
  for (const p of photos) {
    for (const damageId of p.linkedDamageIds) {
      const existing = photoTextByDamageId.get(damageId) ?? "";
      photoTextByDamageId.set(damageId, `${existing} ${p.photoNo ?? ""} ${p.page}`);
    }
  }

  return records.filter((d) => {
    const haystack = [d.damageName, d.section, d.part, d.subPart, d.location, d.repairMethod, d.id, d.groupNo, photoTextByDamageId.get(d.id) ?? ""]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

// ---- STEP 9 필터 조건 (기존 DamageTable 검토 필터에 추가) ----

export function isPositionProblem(d: DamageRecord): boolean {
  return !d.location || d.location.trim() === "" || d.location === "검토필요";
}

export function isPhotoProblem(d: DamageRecord): boolean {
  return d.photoMatchStatus === "review" || d.photoMatchStatus === "conflict";
}

export function isScaleProblem(d: DamageRecord): boolean {
  return !d.quantity && !d.quantityGroup;
}

export function isManualEntry(d: DamageRecord): boolean {
  return d.id.startsWith("NEW-");
}

// ---- 상단 요약 통계 (섹션 3) ----

export interface ReviewCounts {
  total: number;
  confirmed: number;
  needsReview: number;
  conflict: number;
  candidate: number;
  noPhoto: number;
  unlinkedPhotos: number;
}

export function computeReviewCounts(records: DamageRecord[], photos: ExtractedPhoto[], candidateDamages: CandidateDamage[]): ReviewCounts {
  return {
    total: records.length,
    confirmed: records.filter((r) => r.status === "confirmed").length,
    needsReview: records.filter((r) => r.status === "review").length,
    conflict: records.filter((r) => r.status === "conflict" || r.crossValidation?.result === "conflict").length,
    candidate: candidateDamages.filter((c) => !c.decision).length,
    noPhoto: records.filter((r) => r.photoMatchStatus === "noPhoto" || r.photoMatchStatus == null).length,
    unlinkedPhotos: photos.filter((p) => p.matchStatus !== "confirmed").length,
  };
}

// ---- 후보 손상 결정 (섹션 14) ----

export function excludeCandidateDamage(candidates: CandidateDamage[], id: string): CandidateDamage[] {
  return candidates.map((c) => (c.id === id ? { ...c, decision: "excluded" } : c));
}

export function deferCandidateDamage(candidates: CandidateDamage[], id: string): CandidateDamage[] {
  return candidates.map((c) => (c.id === id ? { ...c, decision: "deferred" } : c));
}

// ---- 일괄 검수 (섹션 24) ----

export function bulkConfirm(records: DamageRecord[], ids: string[]): DamageRecord[] {
  const idSet = new Set(ids);
  const at = new Date().toISOString();
  return records.map((d) => {
    if (!idSet.has(d.id) || d.status === "conflict") return d;
    if (d.status === "confirmed") return d;
    return {
      ...d,
      status: "confirmed",
      reviewHistory: [...(d.reviewHistory ?? []), { at, action: "review_completed", source: "manual" } satisfies ReviewHistoryEntry],
    };
  });
}

export function bulkMarkNoPhoto(records: DamageRecord[], photos: ExtractedPhoto[], ids: string[]): DamageRecord[] {
  let next = records;
  for (const id of ids) next = setDamageNoPhoto(next, id, true);
  void photos; // photoIds/photoMatchStatus는 이미 파생 필드이므로 별도 재계산은 호출부(derive)에서 수행한다.
  return next;
}

// ---- 최종 확정 (섹션 20~21) ----

export interface FinalizeCheck {
  ok: boolean;
  reasons: string[];
}

/** [최종 확정] 버튼 활성화 조건을 검사한다. 사진 없음/미연결 사진 자체는 막지 않는다. */
export function canFinalize(records: DamageRecord[], candidateDamages: CandidateDamage[]): FinalizeCheck {
  const reasons: string[] = [];

  const unresolvedConflicts = records.filter((r) => r.status === "conflict" || (r.crossValidation?.reviewRequired ?? false));
  if (unresolvedConflicts.length > 0) reasons.push(`해결되지 않은 충돌 ${unresolvedConflicts.length}건이 있습니다.`);

  const undecidedCandidates = candidateDamages.filter((c) => !c.decision);
  if (undecidedCandidates.length > 0) reasons.push(`결정되지 않은 후보 손상 ${undecidedCandidates.length}건이 있습니다.`);

  const missingRequiredFields = records.filter((r) => !r.damageName || !r.section || !r.part);
  if (missingRequiredFields.length > 0) reasons.push(`필수 항목(손상명/구간/부위)이 비어있는 손상 ${missingRequiredFields.length}건이 있습니다.`);

  const photoLinkConflicts = records.filter((r) => r.photoMatchStatus === "conflict");
  if (photoLinkConflicts.length > 0) reasons.push(`사진 연결 충돌이 있는 손상 ${photoLinkConflicts.length}건이 있습니다.`);

  return { ok: reasons.length === 0, reasons };
}

export function markReviewCompleted(session: ReviewSession): ReviewSession {
  return { ...session, finalReviewStatus: "completed" };
}

export function finalizeReview(session: ReviewSession, finalizedBy = "검토자"): ReviewSession {
  return { ...session, finalReviewStatus: "finalized", finalizedAt: new Date().toISOString(), finalizedBy, reviewVersion: session.reviewVersion + 1 };
}

// ---- STEP 10 연결용 선택자 (섹션 30) — 이미 존재하는 배열을 그대로 반환/필터링만 한다. ----

export function getFinalizedDamageRecords(records: DamageRecord[]): DamageRecord[] {
  return records.filter((r) => r.status !== "excluded");
}

export function getFinalizedPhotoRecords(photos: ExtractedPhoto[]): ExtractedPhoto[] {
  return photos.filter((p) => p.extractionStatus === "ok");
}

export function getFinalValidationResults(records: DamageRecord[]) {
  return records.filter((r) => !!r.crossValidation).map((r) => ({ damageId: r.id, crossValidation: r.crossValidation! }));
}
