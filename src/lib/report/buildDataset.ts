import type { CandidateDamage, DamageRecord, ExportOptions, ExtractedPhoto, ReviewSession } from "../../types";
import { STATUS_LABEL } from "../../types";
import { canFinalize, getFinalizedDamageRecords, getFinalizedPhotoRecords } from "../finalReview";

/**
 * STEP 10 — Excel/Word/PDF가 공유하는 "최종 출력 데이터 모델". 세 출력 형식 모두 이
 * 파일의 행 빌더 함수만 사용하고, 각자 별도의 변환 로직을 만들지 않는다(스펙 9번).
 * 출력 대상은 항상 STEP 9의 "최종 확정 데이터"(getFinalizedDamageRecords 등)를 기준으로
 * 한다 — AI 최초 추출 결과를 직접 출력하지 않는다.
 */

const CROSS_VALIDATION_LABEL: Record<string, string> = {
  matched: "일치",
  conflict: "불일치",
  missingInAdditional: "추가자료 미확인",
  candidate: "후보",
  unsupported: "검증 불가",
};

export interface FinalDataset {
  damages: DamageRecord[];
  photos: ExtractedPhoto[];
}

/** scope(전체/선택 손상)와 옵션(미연결 사진 포함 여부)에 따라 STEP9 최종 확정 데이터를 좁힌다. */
export function buildFinalDataset(records: DamageRecord[], photos: ExtractedPhoto[], options: ExportOptions): FinalDataset {
  let damages = getFinalizedDamageRecords(records);
  if (options.scope === "selected" && options.selectedDamageIds.length > 0) {
    const idSet = new Set(options.selectedDamageIds);
    damages = damages.filter((d) => idSet.has(d.id));
  }
  const finalizedPhotos = getFinalizedPhotoRecords(photos);
  return { damages, photos: finalizedPhotos };
}

export interface ExportValidation {
  ok: boolean;
  reasons: string[];
}

/**
 * 출력(다운로드) 버튼을 누르기 직전 실행하는 무결성 검사(스펙 16번). 문제가 있으면
 * 조용히 잘못된 파일을 만들지 않고 이유를 반환한다. STEP9의 canFinalize()를 그대로
 * 재사용하고, 출처/사진 참조 무결성만 추가로 확인한다.
 */
export function validateForExport(
  session: ReviewSession,
  records: DamageRecord[],
  photos: ExtractedPhoto[],
  candidateDamages: CandidateDamage[]
): ExportValidation {
  const reasons: string[] = [];

  if (session.finalReviewStatus === "in_progress") {
    reasons.push("최종 검수가 완료되지 않았습니다. 먼저 '검수 완료'를 진행하세요.");
  }

  const finalizeCheck = canFinalize(records, candidateDamages);
  reasons.push(...finalizeCheck.reasons);

  const activeDamages = getFinalizedDamageRecords(records);
  const missingSource = activeDamages.filter((r) => r.sourceReferences.length === 0 && r.sourcePages.length === 0);
  if (missingSource.length > 0) reasons.push(`출처 정보가 없는 손상 ${missingSource.length}건이 있습니다.`);

  const photoIds = new Set(photos.map((p) => p.id));
  const brokenPhotoLinks = activeDamages.filter((r) => (r.photoIds ?? []).some((id) => !photoIds.has(id)));
  if (brokenPhotoLinks.length > 0) reasons.push(`존재하지 않는 사진을 참조하는 손상 ${brokenPhotoLinks.length}건이 있습니다.`);

  const missingRequired = activeDamages.filter((r) => !r.id || !r.damageName);
  if (missingRequired.length > 0) reasons.push(`데이터 구조 오류(ID 또는 손상명 누락)가 있는 손상 ${missingRequired.length}건이 있습니다.`);

  return { ok: reasons.length === 0, reasons: Array.from(new Set(reasons)) };
}

// ---- 행 빌더 (Excel Sheet / Word 표 / PDF 표가 모두 이 함수들을 공유한다) ----

export interface DamageRow {
  no: string;
  section: string;
  damageName: string;
  part: string;
  subPart: string;
  location: string;
  repairMethod: string;
  quantityDisplay: string;
  photoCount: number;
  crossValidation: string;
  status: string;
}

export function buildDamageRows(damages: DamageRecord[]): DamageRow[] {
  return damages.map((d) => ({
    no: d.id,
    section: d.section,
    damageName: d.damageName,
    part: d.part,
    subPart: d.subPart,
    location: d.location,
    repairMethod: d.repairMethod,
    // 그룹 합계 물량은 각 행에 반복 입력하지 않는다 — quantityGroup에 이미 "그룹 합계 23.3m에 포함" 형태로 저장돼 있다.
    quantityDisplay: d.quantity ?? d.quantityGroup ?? "-",
    photoCount: d.photoIds?.length ?? 0,
    crossValidation: d.crossValidation ? (CROSS_VALIDATION_LABEL[d.crossValidation.result] ?? d.crossValidation.result) : "-",
    status: STATUS_LABEL[d.status] ?? d.status,
  }));
}

export interface PhotoRow {
  damageNo: string;
  photoNo: string;
  page: number;
  caption: string;
  fileName: string;
  linkStatus: string;
  confidence: string;
}

/** 손상별 연결 사진 + (옵션) 미연결 사진을 별도 블록으로 담는다. 동일 사진을 중복 저장하지 않는다. */
export function buildPhotoRows(damages: DamageRecord[], photos: ExtractedPhoto[], includeUnlinked: boolean): PhotoRow[] {
  const rows: PhotoRow[] = [];
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const linkedPhotoIds = new Set<string>();

  for (const d of damages) {
    for (const photoId of d.photoIds ?? []) {
      const p = photoById.get(photoId);
      if (!p) continue;
      linkedPhotoIds.add(p.id);
      rows.push({
        damageNo: d.id,
        photoNo: p.photoNo ?? p.id,
        page: p.page,
        caption: p.caption ?? "-",
        fileName: p.sourceFile,
        linkStatus: p.matchSource === "manual" ? "수동 연결" : "자동 연결",
        confidence: p.confidence != null ? `${Math.round(p.confidence * 100)}%` : "-",
      });
    }
  }

  if (includeUnlinked) {
    for (const p of photos) {
      if (linkedPhotoIds.has(p.id)) continue;
      rows.push({
        damageNo: "-",
        photoNo: p.photoNo ?? p.id,
        page: p.page,
        caption: p.caption ?? "-",
        fileName: p.sourceFile,
        linkStatus: "미연결",
        confidence: "-",
      });
    }
  }

  return rows;
}

export interface CrossValidationRow {
  damageNo: string;
  sourceFile: string;
  sourceType: string;
  item: string;
  mainValue: string;
  additionalValue: string;
  result: string;
  decision: string;
}

export function buildCrossValidationRows(damages: DamageRecord[]): CrossValidationRow[] {
  const rows: CrossValidationRow[] = [];
  for (const d of damages) {
    if (!d.crossValidation) continue;
    for (const e of d.crossValidation.evidence) {
      if (e.result === "conflict") continue; // 충돌은 아래 conflicts에서 상세히 다룬다(중복 방지)
      rows.push({
        damageNo: d.id,
        sourceFile: e.fileName,
        sourceType: e.sourceType,
        item: "확인",
        mainValue: "-",
        additionalValue: "-",
        result: e.result === "matched" ? "일치" : "미확인",
        decision: "-",
      });
    }
    for (const c of d.crossValidation.conflicts) {
      rows.push({
        damageNo: d.id,
        sourceFile: c.additional.fileName,
        sourceType: c.additional.sourceType,
        item: c.field,
        mainValue: c.mainReport.value,
        additionalValue: c.additional.value,
        result: "불일치",
        decision: c.resolved ? `${c.resolved.value} 확정 (${c.resolved.reason ?? "수동"})` : "미해결",
      });
    }
  }
  return rows;
}

export interface SourceRow {
  damageNo: string;
  field: string;
  sourceType: string;
  fileName: string;
  page: string;
  sheet: string;
  cell: string;
  paragraph: string;
  excerpt: string;
}

export function buildSourceRows(damages: DamageRecord[]): SourceRow[] {
  const rows: SourceRow[] = [];
  for (const d of damages) {
    for (const ref of d.sourceReferences) {
      rows.push({
        damageNo: d.id,
        field: "기본 보고서",
        sourceType: ref.type,
        fileName: "주 보고서",
        page: String(ref.page),
        sheet: "-",
        cell: "-",
        paragraph: "-",
        excerpt: ref.excerpt ?? "-",
      });
    }
    for (const e of d.crossValidation?.evidence ?? []) {
      rows.push({
        damageNo: d.id,
        field: "교차검증",
        sourceType: e.sourceType,
        fileName: e.fileName,
        page: e.sourceRef.page != null ? String(e.sourceRef.page) : "-",
        sheet: e.sourceRef.sheet ?? "-",
        cell: e.sourceRef.cell ?? "-",
        paragraph: e.sourceRef.paragraph != null ? String(e.sourceRef.paragraph) : "-",
        excerpt: e.sourceRef.quote ?? "-",
      });
    }
  }
  return rows;
}

export interface ReviewHistoryRow {
  damageNo: string;
  field: string;
  originalValue: string;
  finalValue: string;
  changeType: string;
  changedAt: string;
}

export function buildReviewHistoryRows(damages: DamageRecord[]): ReviewHistoryRow[] {
  const rows: ReviewHistoryRow[] = [];
  for (const d of damages) {
    for (const o of d.fieldOverrides ?? []) {
      rows.push({
        damageNo: d.id,
        field: o.field,
        originalValue: o.originalValue,
        finalValue: o.currentValue,
        changeType: "사용자 수정",
        changedAt: o.changedAt,
      });
    }
    for (const c of d.crossValidation?.conflicts ?? []) {
      if (!c.resolved) continue;
      rows.push({
        damageNo: d.id,
        field: c.field,
        originalValue: c.mainReport.value,
        finalValue: c.resolved.value,
        changeType: "충돌 해결",
        changedAt: c.resolved.decidedAt,
      });
    }
  }
  return rows.sort((a, b) => a.changedAt.localeCompare(b.changedAt));
}

/** 파일명에 쓸 수 없는 문자를 제거하고 "{프로젝트명}_최종손상목록_{날짜}.{ext}" 형태로 만든다. */
export function generateFileName(reportName: string, kind: string, ext: string, date: Date = new Date()): string {
  const safeProject = (reportName || "보고서").replace(/[\\/:*?"<>|]/g, "").trim() || "보고서";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${safeProject}_${kind}_${yyyy}${mm}${dd}.${ext}`;
}
