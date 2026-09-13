import type { AdditionalFileType, CrossValidationResult, SourceReference, StandardPart } from "../types";

/**
 * STEP 11 — 정확도/범용성 검증 시스템의 데이터 모델.
 * 운영 데이터(DamageRecord/ExtractedPhoto 등, ../types.ts)와 완전히 분리된 별도
 * 네임스페이스(src/validation/)에 둔다 — 스펙 48번 "운영/테스트 데이터 분리" 원칙.
 * Ground Truth는 AI 결과와 독립적으로 사람이 작성하는 정답 데이터이며, 기존
 * DamageRecord의 핵심 필드 구조를 재사용하되 STEP5~9 전용 파생 필드는 포함하지 않는다.
 */

export type FacilityType = "비탈면" | "옹벽" | "교량" | "터널" | "기타";
export const FACILITY_TYPES: FacilityType[] = ["비탈면", "옹벽", "교량", "터널", "기타"];

export type Difficulty = "LOW" | "MEDIUM" | "HIGH";
export const DIFFICULTIES: Difficulty[] = ["LOW", "MEDIUM", "HIGH"];

export interface AdditionalTestFile {
  fileName: string;
  fileType: AdditionalFileType;
}

/** 사람이 실제 보고서를 읽고 작성하는 정답 손상 데이터. AI 결과로 채우지 않는다. */
export interface GroundTruthDamage {
  id: string; // 예: "GT-001"
  groupNo: string;
  section: string;
  damageName: string;
  part: StandardPart;
  subPart: string;
  location: string;
  quantity: string | null;
  quantityGroup: string | null;
  repairMethod: string;
  sourceRefs: SourceReference[];
  photoNos: string[]; // 이 손상과 연결된다고 사람이 직접 확인한 사진번호
  /** 선택 사항 — 추가자료 교차검증까지 사람이 확인해 기대 결과를 남긴 경우에만 채운다. */
  expectedCrossValidation?: CrossValidationResult;
}

export interface GroundTruthPhoto {
  id: string; // 예: "GT-P001"
  photoNo: string | null;
  page: number;
  linkedDamageIds: string[]; // GroundTruthDamage.id 참조
}

export interface GroundTruthRevision {
  at: string;
  note: string;
}

export interface GroundTruth {
  damages: GroundTruthDamage[];
  photos: GroundTruthPhoto[];
  locked: boolean; // [검증 기준 확정] 이후 true — 이후에는 명시적 수정 과정을 거쳐야 한다.
  lockedAt?: string;
  revisions: GroundTruthRevision[];
}

export function createEmptyGroundTruth(): GroundTruth {
  return { damages: [], photos: [], locked: false, revisions: [] };
}

export interface TestCase {
  id: string; // 예: "T001"
  reportFileName: string; // 원본 파일명만 저장(원본 File 객체는 세션 메모리에 별도 보관, 직렬화하지 않음)
  reportName: string;
  facilityType: FacilityType;
  reportFormat: string; // 자유 입력, 예: "표 중심", "이미지 중심", "손상조사표 중심"
  vendorType: string; // 회사/양식 식별용 자유 라벨 (실제 회사명을 코드에 하드코딩하지 않기 위해 사용자가 임의로 붙이는 라벨)
  difficulty: Difficulty;
  additionalFiles: AdditionalTestFile[];
  groundTruth: GroundTruth | null;
  runs: string[]; // ValidationRun id 목록 (재실행해도 이전 기록을 지우지 않는다 — 스펙 34번)
  status: "not_run" | "running" | "completed" | "failed";
}

// ---- 정확도 지표 ----

export interface PrecisionRecallF1 {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface FieldAccuracy {
  field: string;
  matched: number;
  total: number;
  matchRate: number; // 0~1, total===0이면 null 대신 0으로 두고 total로 "N/A" 여부를 판단한다.
}

export type ValidationStatus = "GOOD" | "WARNING" | "FAIL";

export interface ValidationThresholds {
  good: number; // 이 값 이상이면 GOOD (기본 0.90)
  warning: number; // 이 값 이상이면 WARNING, 미만이면 FAIL (기본 0.75)
}

export const DEFAULT_THRESHOLDS: ValidationThresholds = { good: 0.9, warning: 0.75 };

export function classifyStatus(f1: number, thresholds: ValidationThresholds = DEFAULT_THRESHOLDS): ValidationStatus {
  if (f1 >= thresholds.good) return "GOOD";
  if (f1 >= thresholds.warning) return "WARNING";
  return "FAIL";
}

export interface CrossValidationBreakdown {
  matched: number;
  conflict: number;
  missingInAdditional: number;
  candidate: number;
  unsupported: number;
  accuracy: number | null; // GroundTruthDamage.expectedCrossValidation을 채운 케이스가 있을 때만 계산, 없으면 null(N/A)
}

export interface ValidationMetrics {
  damageDetection: PrecisionRecallF1;
  fieldAccuracy: FieldAccuracy[]; // damageName/part/subPart/location/quantity/repairMethod
  photoExtraction: PrecisionRecallF1;
  photoLink: PrecisionRecallF1;
  crossValidation: CrossValidationBreakdown;
  overallF1: number; // = damageDetection.f1 (헤드라인 지표)
  status: ValidationStatus;
}

// ---- 오류 분석 ----

export type ErrorCategory =
  | "EXTRACTION_ERROR"
  | "SECTION_ERROR"
  | "LOCATION_ERROR"
  | "DAMAGE_NAME_ERROR"
  | "PART_CLASSIFICATION_ERROR"
  | "SUBPART_ERROR"
  | "QUANTITY_ERROR"
  | "REPAIR_METHOD_ERROR"
  | "PHOTO_EXTRACTION_ERROR"
  | "PHOTO_LINK_ERROR"
  | "OCR_ERROR"
  | "VISION_ERROR"
  | "CROSS_VALIDATION_ERROR"
  | "DUPLICATE_ERROR"
  | "CONFLICT_DETECTION_ERROR"
  | "SOURCE_REFERENCE_ERROR"
  | "MISSING_DAMAGE" // STEP11(업무기반): 사용자가 AI가 놓친 손상을 직접 추가한 경우의 후보 분류
  | "OTHER";

export interface ErrorEntry {
  id: string;
  testCaseId: string;
  step: string; // 예: "STEP 4"
  field: string | null;
  category: ErrorCategory;
  groundTruthValue: string | null;
  aiValue: string | null;
  groundTruthSource: string | null;
  aiSource: string | null;
  damageId?: string;
}

// ---- 검증 실행(Run) ----

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: string; // provider가 실제 비용을 제공하지 않으면 "미제공"
}

export interface ValidationRun {
  id: string; // 예: "VR-20260913-001"
  testCaseId: string;
  runNumber: number;
  engineVersion: string;
  promptVersion: string;
  provider: string;
  model: string;
  timestamp: string;
  processingTimeMs: number | null;
  stepStatuses: Record<string, ValidationStatus>;
  metrics: ValidationMetrics;
  errors: ErrorEntry[];
  tokenUsage: TokenUsage;
}

// ---- 개선 후보 ----

export interface ImprovementCandidate {
  id: string;
  category: ErrorCategory;
  affectedStep: string;
  description: string;
  affectedCases: string[];
  frequency: number;
  severity: "low" | "medium" | "high";
  suggestedAction: string;
  status: "open" | "reviewed" | "implemented" | "rejected";
}
