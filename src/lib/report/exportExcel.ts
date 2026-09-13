import * as XLSX from "xlsx";
import type { DamageRecord, ExportOptions, ExtractedPhoto, ReviewSession } from "../../types";
import { buildCrossValidationRows, buildDamageRows, buildFinalDataset, buildPhotoRows, buildReviewHistoryRows, buildSourceRows, generateFileName } from "./buildDataset";

/**
 * STEP 10 — Excel(.xlsx) 생성. Sheet1 손상목록 / Sheet2 손상사진 / Sheet3 교차검증 /
 * Sheet4 출처 / Sheet5 검수이력. 각 시트는 옵션으로 켜고 끌 수 있다.
 * 반환값은 ArrayBuffer이므로(브라우저 다운로드 트리거는 downloadFile.ts에서 별도 처리)
 * Node 환경(vitest)에서도 실제 워크북 생성 로직을 그대로 테스트할 수 있다.
 */
export function buildExcelWorkbookBuffer(records: DamageRecord[], photos: ExtractedPhoto[], options: ExportOptions): ArrayBuffer {
  const { damages, photos: finalPhotos } = buildFinalDataset(records, photos, options);
  const wb = XLSX.utils.book_new();

  if (options.includeDamageList) {
    const rows = buildDamageRows(damages).map((r) => ({
      No: r.no,
      구간: r.section,
      손상명: r.damageName,
      부위: r.part,
      세부부위: r.subPart,
      위치: r.location,
      보수방안: r.repairMethod,
      "규모/물량": r.quantityDisplay,
      사진수: r.photoCount,
      교차검증: r.crossValidation,
      상태: r.status,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "손상목록");
  }

  if (options.includePhotos) {
    const rows = buildPhotoRows(damages, finalPhotos, options.includeUnlinkedPhotos).map((r) => ({
      "손상 No": r.damageNo,
      사진번호: r.photoNo,
      페이지: r.page,
      캡션: r.caption,
      파일명: r.fileName,
      연결상태: r.linkStatus,
      confidence: r.confidence,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "손상사진");
  }

  if (options.includeCrossValidation) {
    const rows = buildCrossValidationRows(damages).map((r) => ({
      "손상 No": r.damageNo,
      검증자료: r.sourceFile,
      자료유형: r.sourceType,
      검증항목: r.item,
      "주 보고서 값": r.mainValue,
      "추가자료 값": r.additionalValue,
      결과: r.result,
      사용자결정: r.decision,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "교차검증");
  }

  if (options.includeSources) {
    const rows = buildSourceRows(damages).map((r) => ({
      "손상 No": r.damageNo,
      필드: r.field,
      출처유형: r.sourceType,
      파일명: r.fileName,
      페이지: r.page,
      Sheet: r.sheet,
      Cell: r.cell,
      Paragraph: r.paragraph,
      "원문/근거": r.excerpt,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "출처");
  }

  if (options.includeReviewHistory) {
    const rows = buildReviewHistoryRows(damages).map((r) => ({
      "손상 No": r.damageNo,
      변경항목: r.field,
      "원래 값": r.originalValue,
      "최종 값": r.finalValue,
      변경유형: r.changeType,
      변경시각: r.changedAt,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "검수이력");
  }

  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 안내: "선택된 출력 항목이 없습니다." }]), "안내");
  }

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export function excelFileName(session: ReviewSession, date?: Date): string {
  return generateFileName(session.reportName, "최종손상목록", "xlsx", date);
}
