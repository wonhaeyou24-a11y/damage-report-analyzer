import type { DamageRecord, ExtractedPhoto, ReviewSession } from "../../types";
import type { ErrorCategory } from "../../validation/types";
import type { ChangeClassification, QualityEvent, QualityEventType } from "./types";

/**
 * STEP11(업무기반) 핵심: 화면에서 이미 일어나는 사용자 행동(필드 편집, 손상 추가/삭제, 사진
 * 연결 변경, 충돌 해결, 검수완료/확정)을 "이전 상태 vs 다음 상태" 비교만으로 감지한다.
 * DamageTable/PhotoGallery/FinalReviewBar 등 기존 컴포넌트는 한 줄도 건드리지 않는다 —
 * 이 모든 컴포넌트가 결과적으로 App.tsx의 onRecordsChange/onPhotosChange/onSessionChange로
 * 새 배열/세션을 넘겨주므로, 그 경계 한 곳에서만 비교하면 된다(스펙 39번 "집계 데이터 활용"과
 * 같은 방향 — 매 컴포넌트에 로깅 코드를 흩뿌리지 않는다).
 */

let eventIdCounter = 0;
function nextEventId(): string {
  eventIdCounter += 1;
  return `QE-${Date.now()}-${eventIdCounter}`;
}

const FIELD_CATEGORY: Record<string, ErrorCategory> = {
  section: "SECTION_ERROR",
  damageName: "DAMAGE_NAME_ERROR",
  part: "PART_CLASSIFICATION_ERROR",
  subPart: "SUBPART_ERROR",
  location: "LOCATION_ERROR",
  repairMethod: "REPAIR_METHOD_ERROR",
  quantity: "QUANTITY_ERROR",
};

function baseEvent(reportId: string, recordId: string | null, type: QualityEventType, at: string, source: "ai" | "manual"): QualityEvent {
  return { id: nextEventId(), reportId, recordId, type, at, source };
}

/**
 * 필드 수정이 "AI 오류"인지는 알 수 없다(스펙 18번) — 사용자가 사유를 밝히지 않았으면
 * 항상 UNKNOWN으로 남긴다. reason이 있을 때만 더 구체적으로 분류한다.
 */
function classifyChange(reason?: string): ChangeClassification {
  if (!reason) return "UNKNOWN";
  if (reason.includes("AI") || reason.includes("오류") || reason.includes("오탐") || reason.includes("오분류")) return "AI_ERROR_CANDIDATE";
  if (reason.includes("판단") || reason.includes("의견")) return "USER_JUDGMENT_CHANGE";
  if (reason.includes("표현") || reason.includes("표준화") || reason.includes("해석")) return "SOURCE_INTERPRETATION_DIFFERENCE";
  return "UNKNOWN";
}

const now = () => new Date().toISOString();

/** damageRecords 이전/다음 배열을 비교해 필드수정/추가/삭제/제외 이벤트를 뽑는다. */
export function diffRecordsForQualityEvents(reportId: string, prevRecords: DamageRecord[], nextRecords: DamageRecord[]): QualityEvent[] {
  const events: QualityEvent[] = [];
  const prevById = new Map(prevRecords.map((r) => [r.id, r]));
  const nextById = new Map(nextRecords.map((r) => [r.id, r]));
  const at = now();

  for (const next of nextRecords) {
    const prev = prevById.get(next.id);
    if (!prev) {
      // AI가 STEP4~5에서 만든 레코드는 순간적으로 "새로 생김"이지만 그건 최초 분석이지 사용자
      // 추가가 아니다 — STEP9의 "+ 손상 추가" 버튼이 만드는 id만 사용자 추가로 본다(기존 규칙 재사용).
      if (next.id.startsWith("NEW-")) {
        events.push({
          ...baseEvent(reportId, next.id, "damage_added", at, "manual"),
          category: "MISSING_DAMAGE",
          classification: "UNKNOWN",
          snapshot: { damageName: next.damageName, section: next.section, part: next.part, location: next.location },
        });
      }
      continue;
    }

    // 필드 수정: fieldOverrides의 changedAt으로 "이번에 새로 생긴 것"만 골라낸다(중복 기록 방지).
    const prevOverrides = new Map((prev.fieldOverrides ?? []).map((o) => [o.field, o]));
    for (const ov of next.fieldOverrides ?? []) {
      const prevOv = prevOverrides.get(ov.field);
      if (prevOv && prevOv.changedAt === ov.changedAt) continue; // 이미 기록된 변경
      if (ov.field === "status" && ov.currentValue === "excluded") {
        events.push({
          ...baseEvent(reportId, next.id, "status_excluded", ov.changedAt, "manual"),
          field: "status",
          from: ov.originalValue,
          to: ov.currentValue,
          classification: "UNKNOWN",
        });
        continue;
      }
      events.push({
        ...baseEvent(reportId, next.id, "field_edited", ov.changedAt, "manual"),
        field: ov.field,
        from: ov.originalValue,
        to: ov.currentValue,
        category: FIELD_CATEGORY[ov.field],
        classification: classifyChange(),
      });
    }

    // 검토 후 유지(값 변경 없이 검수만 완료) — bulkConfirm이 남기는 review_completed 이력만 대상.
    const prevHistoryLen = prev.reviewHistory?.length ?? 0;
    const nextHistory = next.reviewHistory ?? [];
    for (let i = prevHistoryLen; i < nextHistory.length; i++) {
      const h = nextHistory[i];
      if (h.action === "review_completed") {
        events.push({ ...baseEvent(reportId, next.id, "bulk_reviewed", h.at, "manual") });
      }
    }

    // STEP8 추가자료 보완(enrichment) — 비어 있던 필드가 새로 채워진 항목만. 사용자 행동이
    // 아니라 자동 보완이므로 source는 "ai"로 남기되, STEP11에서 "어떤 추가자료가 어떤 손상을
    // 어떻게 보완했는지" 집계할 수 있도록 이벤트 자체는 기록한다(스펙 28번).
    const prevEnrichedKeys = new Set((prev.crossValidation?.enrichments ?? []).map((e) => `${e.field}|${e.appliedAt}`));
    for (const e of next.crossValidation?.enrichments ?? []) {
      const key = `${e.field}|${e.appliedAt}`;
      if (prevEnrichedKeys.has(key)) continue;
      events.push({
        ...baseEvent(reportId, next.id, "cross_validation_enriched", e.appliedAt, "ai"),
        field: e.field,
        to: e.value,
        category: FIELD_CATEGORY[e.field],
      });
    }

    // STEP8 교차검증 충돌 해결 — conflicts[].resolved가 새로 채워진 항목만.
    const prevResolvedKeys = new Set(
      (prev.crossValidation?.conflicts ?? []).filter((c) => c.resolved).map((c) => `${c.field}|${c.resolved!.decidedAt}`)
    );
    for (const c of next.crossValidation?.conflicts ?? []) {
      if (!c.resolved) continue;
      const key = `${c.field}|${c.resolved.decidedAt}`;
      if (prevResolvedKeys.has(key)) continue;
      events.push({
        ...baseEvent(reportId, next.id, "cross_validation_resolved", c.resolved.decidedAt, "manual"),
        field: c.field,
        from: c.mainReport.value,
        to: c.resolved.value,
        category: "CROSS_VALIDATION_ERROR",
        classification: "UNKNOWN",
        reason: c.resolved.reason,
      });
    }
  }

  for (const prev of prevRecords) {
    if (!nextById.has(prev.id)) {
      events.push({
        ...baseEvent(reportId, prev.id, "damage_deleted", at, "manual"),
        snapshot: { damageName: prev.damageName, section: prev.section, part: prev.part, location: prev.location },
      });
    }
  }

  return events;
}

/** ExtractedPhoto[]의 linkedDamageIds 집합 변화를 비교해 연결/해제 이벤트를 뽑는다(1:N, N:M 지원). */
export function diffPhotosForQualityEvents(reportId: string, prevPhotos: ExtractedPhoto[], nextPhotos: ExtractedPhoto[]): QualityEvent[] {
  const events: QualityEvent[] = [];
  const prevById = new Map(prevPhotos.map((p) => [p.id, p]));
  const at = now();

  for (const next of nextPhotos) {
    const prev = prevById.get(next.id);
    if (!prev) continue; // 새로 추출된 사진(STEP6) — 사용자 행동 아님
    if (next.matchSource !== "manual") continue; // 자동 재매칭 결과는 품질 이벤트로 기록하지 않는다
    const prevLinked = new Set(prev.linkedDamageIds);
    const nextLinked = new Set(next.linkedDamageIds);
    for (const damageId of nextLinked) {
      if (!prevLinked.has(damageId)) {
        events.push({ ...baseEvent(reportId, damageId, "photo_linked", at, "manual"), field: "photoLink", to: next.id, category: "PHOTO_LINK_ERROR" });
      }
    }
    for (const damageId of prevLinked) {
      if (!nextLinked.has(damageId)) {
        events.push({ ...baseEvent(reportId, damageId, "photo_unlinked", at, "manual"), field: "photoLink", from: next.id, category: "PHOTO_LINK_ERROR" });
      }
    }
  }
  return events;
}

/** ReviewSession의 finalReviewStatus 전이(진행중→완료→확정)만 이벤트로 남긴다. */
export function diffSessionForQualityEvents(reportId: string, prevSession: ReviewSession, nextSession: ReviewSession): QualityEvent[] {
  const events: QualityEvent[] = [];
  if (prevSession.finalReviewStatus !== "completed" && nextSession.finalReviewStatus === "completed") {
    events.push({ ...baseEvent(reportId, null, "review_completed", now(), "manual") });
  }
  if (prevSession.finalReviewStatus !== "finalized" && nextSession.finalReviewStatus === "finalized") {
    events.push({ ...baseEvent(reportId, null, "finalized", nextSession.finalizedAt ?? now(), "manual") });
  }
  return events;
}

export function buildReanalyzedEvent(reportId: string): QualityEvent {
  return baseEvent(reportId, null, "reanalyzed", now(), "manual");
}
