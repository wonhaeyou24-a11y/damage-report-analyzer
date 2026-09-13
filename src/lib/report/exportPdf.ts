import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { CandidateDamage, DamageRecord, ExportOptions, ExtractedPhoto, ReviewSession } from "../../types";
import { buildCrossValidationRows, buildDamageRows, buildFinalDataset, buildReviewHistoryRows, generateFileName } from "./buildDataset";

/**
 * STEP 10 — PDF 생성. Word와 동일한 buildDataset 행 빌더를 그대로 재사용해 같은 데이터
 * 모델을 공유한다(스펙 9번 — 변환 로직을 중복해서 만들지 않는다). 내용 구성은 Word 결과와
 * 동일하게 표지 → 개요 → 손상요약표 → 교차검증 → 검수결과 순서를 따른다.
 */
export function buildPdfArrayBuffer(
  session: ReviewSession,
  records: DamageRecord[],
  photos: ExtractedPhoto[],
  candidateDamages: CandidateDamage[],
  options: ExportOptions
): ArrayBuffer {
  const { damages, photos: finalPhotos } = buildFinalDataset(records, photos, options);
  const doc = new jsPDF();
  let y = 18;

  doc.setFontSize(18);
  doc.text("보고서 분석 결과", 14, y);
  y += 10;
  doc.setFontSize(11);
  doc.text(`프로젝트명: ${session.reportName || "-"}`, 14, y);
  y += 6;
  doc.text(`시설물명: ${session.facilityName || "-"} (${session.facilityType || "-"})`, 14, y);
  y += 6;
  doc.text(`분석일: ${new Date().toLocaleDateString()}`, 14, y);
  y += 6;
  doc.text(`검수 완료일: ${session.finalizedAt ? new Date(session.finalizedAt).toLocaleDateString() : "-"}`, 14, y);
  y += 6;
  doc.text(`손상 건수: ${damages.length}건 · 사진 건수: ${finalPhotos.length}건`, 14, y);
  y += 10;

  if (options.includeDamageList) {
    const rows = buildDamageRows(damages);
    doc.setFontSize(13);
    doc.text("2. 손상 요약", 14, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [["No", "구간", "손상명", "부위", "세부부위", "위치", "보수방안", "규모/물량", "상태"]],
      body: rows.map((r) => [r.no, r.section, r.damageName, r.part, r.subPart, r.location, r.repairMethod, r.quantityDisplay, r.status]),
      styles: { fontSize: 8 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  if (options.includeCrossValidation) {
    const cvRows = buildCrossValidationRows(damages);
    if (y > 260) {
      doc.addPage();
      y = 18;
    }
    doc.setFontSize(13);
    doc.text("4. 교차검증 결과", 14, y);
    y += 4;
    if (cvRows.length === 0) {
      doc.setFontSize(10);
      doc.text("추가자료 교차검증을 수행하지 않음", 14, y);
      y += 10;
    } else {
      autoTable(doc, {
        startY: y,
        head: [["손상 No", "검증자료", "항목", "주 보고서 값", "추가자료 값", "결과", "사용자 결정"]],
        body: cvRows.map((r) => [r.damageNo, r.sourceFile, r.item, r.mainValue, r.additionalValue, r.result, r.decision]),
        styles: { fontSize: 8 },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }
  }

  if (y > 260) {
    doc.addPage();
    y = 18;
  }
  doc.setFontSize(13);
  doc.text("5. 검수 결과", 14, y);
  y += 6;
  doc.setFontSize(10);
  doc.text(`최종 검수 완료 여부: ${session.finalReviewStatus === "finalized" ? "완료" : "미완료"} (버전 ${session.reviewVersion})`, 14, y);
  y += 6;
  if (options.includeReviewHistory) {
    const historyRows = buildReviewHistoryRows(damages);
    doc.text(`수정된 항목: ${historyRows.length}건`, 14, y);
    y += 6;
  }
  const decidedCandidates = candidateDamages.filter((c) => c.decision);
  doc.text(
    `후보 처리 결과: 제외 ${decidedCandidates.filter((c) => c.decision === "excluded").length}건 · 보류 ${decidedCandidates.filter((c) => c.decision === "deferred").length}건`,
    14,
    y
  );

  return doc.output("arraybuffer") as ArrayBuffer;
}

export function pdfFileName(session: ReviewSession, date?: Date): string {
  return generateFileName(session.reportName, "최종보고서", "pdf", date);
}
