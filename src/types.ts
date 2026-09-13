// 손상 데이터 모델 — 개요는 README.md 및 개발 스펙 문서 참고.

export type StandardPart =
  | "상부자연사면"
  | "사면"
  | "사면하부"
  | "보강시설"
  | "보수시설"
  | "배수시설"
  | "기타";

export const STANDARD_PARTS: StandardPart[] = [
  "상부자연사면",
  "사면",
  "사면하부",
  "보강시설",
  "보수시설",
  "배수시설",
  "기타",
];

export type DamageStatus = "confirmed" | "review" | "conflict" | "excluded";

export const STATUS_LABEL: Record<DamageStatus, string> = {
  confirmed: "🟢 확인완료",
  review: "🟡 검토필요",
  conflict: "🔴 수정필요",
  excluded: "⚫ 제외됨",
};

export interface SourceReference {
  page: number;
  type: string; // "table" | "conclusion" | "photo" | "body" 등, 자유 텍스트
  excerpt?: string; // 원문 문장/표 셀 내용 (가능한 경우)
}

export interface DamagePhoto {
  id: string;
  url?: string; // object URL 또는 저장 경로
  caption?: string;
  page?: number;
  linked: "group" | "individual"; // 그룹 단위 연결인지 개별 손상 연결인지
}

/** STEP 5: 통합된 손상이 어느 원본 STEP4 레코드들로부터 만들어졌는지 추적. */
export interface MergeInfo {
  merged: boolean;
  sourceRecordIds: string[];
}

/** STEP 5: 동일 손상으로 통합되었지만 필드 값이 서로 달라 확정하지 못한 경우. */
export interface ConflictValue {
  value: string;
  page: number | null;
}

export interface ConflictEntry {
  field: "damageName" | "part" | "subPart" | "location" | "quantity" | "repairMethod" | "section" | "groupNo" | "photoReference";
  values: ConflictValue[];
}

/** STEP 9 — 사용자가 직접 수정 가능한 필드. */
export type EditableDamageField = "section" | "damageName" | "part" | "subPart" | "location" | "repairMethod" | "quantity" | "status";

/** STEP 9 — 필드별 원본값/현재값 추적. AI가 재분석해도 manualOverride 필드는 덮어쓰지 않는다. */
export interface FieldOverride {
  field: EditableDamageField;
  originalValue: string;
  currentValue: string;
  manualOverride: true;
  changedAt: string;
}

/** STEP 9 — 검수 기록(감사 로그). 원본 AI 결과를 지우지 않고 이력으로만 남긴다. */
export interface ReviewHistoryEntry {
  at: string;
  action: "ai_extracted" | "ai_updated" | "manual_edit" | "review_completed" | "finalized";
  field?: string;
  from?: string;
  to?: string;
  source: "ai" | "manual";
  note?: string;
}

export interface DamageRecord {
  id: string; // 예: "D003-01" 또는 "③-01"
  groupNo: string; // 보고서 원문 그룹 번호, 예: "③"
  groupIndex: number; // 그룹 내 개별 순번 (1부터)
  section: string; // 구간, 예: "1구간"
  damageName: string; // 손상명, 예: "균열"
  part: StandardPart; // 표준 부위
  subPart: string; // 세부부위 (원문 시설명), 없으면 "-"
  location: string; // 위치 (단일 값 또는 범위), 예: "165m", "176~206m". 불일치 시 "검토필요"
  repairMethod: string; // 보수방안
  quantity: string | null; // 개별 물량이 보고서에 명시된 경우만
  quantityGroup: string | null; // 그룹 합계 물량 (개별 물량이 없을 때)
  photos: DamagePhoto[];
  status: DamageStatus;
  sourcePages: number[];
  sourceReferences: SourceReference[];
  notes?: string; // 검토 메모 (예: 물량 산정 불확실, 사진 연결 불확실 사유)
  mergeInfo?: MergeInfo; // STEP 5: 다중 페이지 중복 통합 결과
  conflicts?: ConflictEntry[]; // STEP 5: 통합 과정에서 발견된 정보 불일치
  photoIds?: string[]; // STEP 7: 연결된 ExtractedPhoto ID (자동+수동 통합, photos[]에서 파생)
  photoMatchStatus?: DamagePhotoMatchStatus; // STEP 7: 사진 연결 상태
  photoMatchOverride?: "noPhoto"; // STEP 7: 사용자가 "사진 없음"으로 직접 지정
  crossValidation?: CrossValidation; // STEP 8: 추가자료 교차검증 결과 (선택사항)
  fieldOverrides?: FieldOverride[]; // STEP 9: 필드별 수동 수정 이력 (원본값 보존)
  reviewHistory?: ReviewHistoryEntry[]; // STEP 9: 검수 감사 로그
}

// ==================================================
// STEP 6 — 손상사진 추출 및 사진 메타데이터
// ==================================================

export interface PhotoImage {
  dataUrl: string; // 크롭된 원본 이미지 (data URL)
  thumbnailDataUrl?: string;
  width: number;
  height: number;
}

/** AI Vision이 이미지를 보고 추정한 정보. 보고서 원문 사실(documentEvidence)과 반드시 구분한다. */
export interface VisionInference {
  damageType?: string;
  facility?: string;
  confidence: number; // 0~1
}

export interface PhotoSourceRef {
  page: number;
  quote?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export type ExtractionStatus = "ok" | "failed";
export type PhotoStatus = "confirmed" | "review" | "failed";

export const PHOTO_STATUS_LABEL: Record<PhotoStatus, string> = {
  confirmed: "🟢 손상사진",
  review: "🟡 검토",
  failed: "🔴 추출실패",
};

/** STEP 7에서 손상과 매칭할 때 참고할 사전 점수. 확정 연결이 아니다. */
export interface PhotoMatchCandidate {
  damageId: string;
  score: number;
  reasons: string[];
  conflict?: boolean; // 강한 정보 충돌(예: 위치 불일치) 발견 시 true — 점수가 높아도 자동 확정하지 않는다.
}

export type PhotoMatchStatus = "confirmed" | "review" | "unmatched";
export type DamagePhotoMatchStatus = "confirmed" | "review" | "noPhoto" | "conflict";
export type MatchSource = "auto" | "manual" | "none";

export interface ExtractedPhoto {
  id: string; // 내부 고유 ID, 예: "P001"
  sourceFile: string;
  page: number;
  photoNo: string | null; // 보고서 원문 표기 그대로 (③-01, 사진 1, No.1 등). 없으면 null.
  caption: string | null;
  section: string | null;
  part: StandardPart | null;
  subPart: string | null;
  location: string | null;
  damageName: string | null;
  image: PhotoImage;
  damageRelated: boolean | "unknown";
  nearbyText: string | null;
  ocrText: string | null;
  ocrConfidence: number | null;
  visionInference: VisionInference | null;
  sourceRef: PhotoSourceRef;
  duplicateCandidate: boolean;
  duplicateOfIds: string[];
  matchCandidates: PhotoMatchCandidate[]; // STEP 7용, STEP 6에서는 확정하지 않음
  linkedDamageIds: string[]; // STEP 6에서는 기본적으로 비어 있음
  status: PhotoStatus;
  extractionStatus: ExtractionStatus;
  error?: string;
  matchStatus?: PhotoMatchStatus; // STEP 7: 손상 연결 상태
  confidence?: number | null; // STEP 7: 최상위 후보의 신뢰도(0~1)
  matchReasons?: string[]; // STEP 7: 확정된 연결의 근거
  matchSource?: MatchSource; // STEP 7: 자동/수동 연결 여부
  manualOverride?: boolean; // STEP 7: 사용자가 직접 수정했으면 true — 자동 재분석이 덮어쓰지 않는다.
}

// AI가 반환하는 "손상 그룹" 원시 구조 — 개별 레코드로 분해되기 전 단계.
export interface RawDamageGroup {
  groupNo: string;
  section: string;
  damageName: string;
  part: string; // AI가 표준값을 시도하지만 검증 필요
  repairMethod: string;
  quantityGroupTotal: string | null; // 보고서에 명시된 그룹 총 물량 (있는 경우)
  locations: RawLocationEntry[];
  photoCount: number | null; // 그룹에 연결된 사진 총 수 (보고서에 명시된 경우)
  sourcePages: number[];
  sourceReferences: SourceReference[];
}

export interface RawLocationEntry {
  subPart: string; // 세부부위 (예: "소단측구", "도수로"), 없으면 "-"
  location: string; // 개별 위치 문자열 (이미 분리됨), 예: "165m" 또는 "176~206m"
  quantity: string | null; // 이 위치에만 명시적으로 대응되는 개별 물량 (드묾)
}

// ==================================================
// STEP 8 — 추가자료 교차검증 (선택사항)
// ==================================================

export type AdditionalFileType = "pdf" | "xlsx" | "xls" | "docx" | "doc";

export type AdditionalSourceType = "외관조사망도" | "사진대지" | "보수보강표" | "수량표" | "도면" | "종합결론" | "기타";

export interface AdditionalSourceRef {
  fileName: string;
  sourceType: AdditionalSourceType;
  page?: number;
  sheet?: string;
  cell?: string;
  row?: number;
  column?: string;
  paragraph?: number;
  table?: number;
  quote?: string;
}

/** 추가자료 안에서 발견된 손상 후보 원시 데이터 — 아직 기본 손상과 매칭되지 않은 상태. */
export interface AdditionalEvidenceCandidate {
  section: string | null;
  damageName: string | null;
  part: StandardPart | null;
  subPart: string | null;
  location: string | null;
  repairMethod: string | null;
  quantity: string | null;
  photoNo: string | null;
  sourceRef: AdditionalSourceRef;
}

export type AdditionalDocStatus = "ok" | "failed";

export interface AdditionalDocument {
  id: string; // 예: "AD001"
  fileName: string;
  fileType: AdditionalFileType;
  sourceType: AdditionalSourceType;
  sourceTypeConfidence: number; // 0~1, 낮으면 "기타"로 남기고 검토 필요
  status: AdditionalDocStatus;
  error?: string;
  candidates: AdditionalEvidenceCandidate[];
  duplicateOfIds: string[]; // 내용이 거의 동일한 다른 추가자료 (삭제하지 않고 표시만 함)
}

export type CrossValidationResult = "matched" | "conflict" | "missingInAdditional" | "candidate" | "unsupported" | "skipped";

export interface CrossValidationEvidence {
  sourceType: AdditionalSourceType;
  fileName: string;
  result: "matched" | "conflict" | "unsupported";
  sourceRef: AdditionalSourceRef;
  reasons: string[];
}

export interface CrossValidationConflictSide {
  value: string;
  source: string; // "본문" 등 기본 보고서 쪽 출처 설명, 또는 추가자료 파일명
  page?: number;
}

export interface CrossValidationConflict {
  field: "damageName" | "part" | "subPart" | "location" | "quantity" | "repairMethod" | "section";
  mainReport: CrossValidationConflictSide;
  additional: CrossValidationConflictSide & { fileName: string; sourceType: AdditionalSourceType };
  resolved?: { value: string; source: "manual"; reason?: string; decidedAt: string }; // 사용자가 해결한 경우 — 재실행해도 보존됨
}

export interface CrossValidation {
  enabled: boolean;
  result: CrossValidationResult;
  confidence: number; // 0~1
  evidenceCount: number;
  evidence: CrossValidationEvidence[];
  conflicts: CrossValidationConflict[];
  reviewRequired: boolean;
}

/** 추가자료에서만 발견되고 기본 손상목록과 연결되지 않은 손상 후보. 사용자가 승인해야 정식 추가된다. */
export interface CandidateDamage {
  id: string; // 예: "CAND-001"
  sourceType: AdditionalSourceType;
  fileName: string;
  damageName: string | null;
  part: StandardPart | null;
  subPart: string | null;
  location: string | null;
  repairMethod: string | null;
  quantity: string | null;
  section: string | null;
  sourceRef: AdditionalSourceRef;
  status: "review";
  decision?: "excluded" | "deferred"; // STEP 9: 사용자 결정. 승인된 경우는 목록에서 제거되므로 별도 값 불필요.
}

export type ValidationStatus = "skipped" | "ok";

// ==================================================
// STEP 9 — 최종 검토/검수
// ==================================================

export type FinalReviewStatus = "in_progress" | "completed" | "finalized";

/** 보고서/세션 단위 메타데이터. 개별 손상 레코드와 분리해서 관리한다. */
export interface ReviewSession {
  reportName: string;
  facilityName: string;
  facilityType: string; // 예: "비탈면", "옹벽", "교량", "터널" — 자유 입력, 특정 시설물에 종속되지 않음
  finalReviewStatus: FinalReviewStatus;
  finalizedAt?: string;
  finalizedBy?: string;
  reviewVersion: number;
}

export function createReviewSession(): ReviewSession {
  return { reportName: "", facilityName: "", facilityType: "", finalReviewStatus: "in_progress", reviewVersion: 0 };
}

// ==================================================
// STEP 10 — 최종 데이터 출력 (Excel/Word/PDF)
// ==================================================

export type ExportFormat = "excel" | "word" | "pdf";

export interface ExportOptions {
  includeDamageList: boolean;
  includePhotos: boolean;
  includeCrossValidation: boolean;
  includeSources: boolean;
  includeReviewHistory: boolean;
  includeUnlinkedPhotos: boolean; // 기본값 true (스펙 13번)
  scope: "all" | "selected";
  selectedDamageIds: string[]; // scope === "selected"일 때만 사용
}

export function createDefaultExportOptions(): ExportOptions {
  return {
    includeDamageList: true,
    includePhotos: true,
    includeCrossValidation: true,
    includeSources: true,
    includeReviewHistory: true,
    includeUnlinkedPhotos: true,
    scope: "all",
    selectedDamageIds: [],
  };
}

export interface ExportHistoryEntry {
  id: string;
  type: ExportFormat;
  createdAt: string;
  reviewVersion: number;
  selectedDamageIds: string[];
  fileName: string;
  status: "success" | "failed";
  error?: string;
}

/**
 * 향후 회사별 보고서 양식을 지원하기 위한 확장 지점. STEP 10에서는 템플릿 편집기를
 * 만들지 않고, 이 구조만 정의해 둔다(현재 생성기들은 이 템플릿을 사용하지 않음).
 */
export interface ReportTemplate {
  id: string;
  name: string;
  version: string;
  sections: string[]; // 예: ["cover", "summary", "damageTable", "damagePhotos", "crossValidation", "reviewResult"]
  styles?: Record<string, string>;
  tokens?: string[]; // 예: ["{{projectName}}", "{{facilityName}}", "{{damageCount}}", "{{damageTable}}"]
}
