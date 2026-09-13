import type { ErrorCategory } from "../../validation/types";

/**
 * STEP 11(재설계) — 업무 데이터 기반 품질 추적.
 *
 * 이 모듈의 핵심 원칙(스펙 0번): 별도 테스트 보고서와 사람이 만든 Ground Truth를 요구하지
 * 않는다. 실제 사용자가 STEP1~10 화면에서 분석 결과를 검토·수정·확정하는 "업무 과정 자체"를
 * 이벤트로 기록하고, 그 이벤트가 쌓이면서 품질 지표가 나온다. AI가 자기 결과를 스스로 정답
 * 판정하지 않는다(스펙 11번) — 여기서 계산하는 것은 "AI가 맞았다"가 아니라 "AI 결과를 사람이
 * 얼마나 그대로 유지했는지/고쳤는지"다.
 */

export type QualityEventType =
  | "damage_added" // 사용자가 AI가 찾지 못한 손상을 직접 추가
  | "damage_deleted" // 손상 행 자체가 삭제됨(원본 STEP9 삭제 기능, 이력만 별도 보존)
  | "field_edited" // 손상 필드(손상명/부위/세부부위/위치/보수방안/규모) 값이 바뀜
  | "status_excluded" // status가 "excluded"로 바뀜 — 사용자가 AI 결과를 업무에서 제외
  | "photo_linked" // 사진↔손상 수동 연결
  | "photo_unlinked" // 사진↔손상 수동 해제
  | "cross_validation_resolved" // STEP8 충돌을 사용자가 해결
  | "cross_validation_enriched" // STEP8 추가자료가 비어 있던 필드를 보완(자동, 사용자 행동 아님이지만 추후 분석을 위해 기록)
  | "bulk_reviewed" // 일괄 검수 완료(값 변경 없이 검토만 함 — "검토 후 유지")
  | "review_completed" // 세션 검수 완료
  | "finalized" // 세션 최종 확정
  | "reanalyzed"; // STEP7/8 재분석 실행(AI 재호출 아님, 재계산)

/**
 * "사용자 수정 = AI 오류"로 단정하지 않는다(스펙 18번). 사용자가 사유를 명시하지 않으면
 * UNKNOWN으로 남기고, 명시적으로 분류했거나(스펙 19번, 선택 입력) 추후 검토자가 확정한
 * 경우에만 AI_ERROR_CANDIDATE로 올릴 수 있다.
 */
export type ChangeClassification = "AI_ERROR_CANDIDATE" | "USER_JUDGMENT_CHANGE" | "SOURCE_INTERPRETATION_DIFFERENCE" | "UNKNOWN";

export interface QualityEvent {
  id: string;
  reportId: string;
  recordId: string | null; // 손상 단위 이벤트가 아니면(finalized 등) null
  type: QualityEventType;
  field?: string; // field_edited일 때만
  from?: string | null;
  to?: string | null;
  at: string;
  source: "ai" | "manual";
  category?: ErrorCategory; // 패턴 분석용 분류일 뿐, "확정된 오류"를 뜻하지 않는다
  classification?: ChangeClassification;
  reason?: string; // 스펙 19번 — 선택 입력
  // 삭제된 손상의 경우 이력 보존을 위해 핵심 필드를 스냅샷으로 남긴다(스펙 6번: 이력을 지우지 않는다).
  snapshot?: { damageName?: string; section?: string; part?: string; location?: string };
}

/** 보고서(분석) 1회 실행의 메타데이터 — 재분석해도 이전 기록을 지우지 않고 배열에 追加한다(스펙 27번). */
export interface AnalysisRunMeta {
  id: string;
  kind: "initial" | "recompute"; // initial = AI 최초 분석, recompute = STEP7/8만 재계산(재분석 버튼)
  provider: string;
  model: string;
  promptVersion: string;
  engineVersion: string;
  runAt: string;
  recordCount: number;
}

/** 데이터가 부족하면 절대 지어낸 숫자를 보이지 않는다(스펙 12/13/23번). */
export interface MetricValue {
  value: number | null; // null이면 계산 불가
  sampleSize: number;
  sufficient: boolean; // sampleSize >= MIN_SAMPLE
}

export const MIN_SAMPLE_SIZE = 5;

export function computeMetric(matched: number, total: number): MetricValue {
  const sufficient = total >= MIN_SAMPLE_SIZE;
  return { value: total > 0 ? matched / total : null, sampleSize: total, sufficient };
}
