import { Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { CandidateDamage, DamageRecord, ExportOptions, ExtractedPhoto, ReviewSession } from "../../types";
import { buildCrossValidationRows, buildDamageRows, buildFinalDataset, buildReviewHistoryRows, generateFileName } from "./buildDataset";

/** data URL(base64)을 docx ImageRun이 받을 수 있는 바이트 배열로 바꾼다. Buffer 없이 atob만 사용해 브라우저/Node 양쪽에서 동작한다. */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function cell(text: string): TableCell {
  return new TableCell({ children: [new Paragraph(text)], width: { size: 2000, type: WidthType.DXA } });
}

function headerRow(headers: string[]): TableRow {
  return new TableRow({ children: headers.map((h) => cell(h)) });
}

function dataRow(values: string[]): TableRow {
  return new TableRow({ children: values.map((v) => cell(v)) });
}

/**
 * STEP 10 — Word(.docx) 보고서 생성. 표지 → 1.분석개요 → 2.손상요약 → 3.손상상세(사진 포함) →
 * 4.교차검증 결과 → 5.검수 결과 순으로 구성한다. 특정 회사 양식을 강제하지 않는 범용 구조다.
 * Excel과 동일한 buildDataset 행 빌더를 재사용해 데이터 변환 로직을 중복하지 않는다.
 */
export async function buildWordDocumentBuffer(
  session: ReviewSession,
  records: DamageRecord[],
  photos: ExtractedPhoto[],
  candidateDamages: CandidateDamage[],
  options: ExportOptions
): Promise<ArrayBuffer> {
  const { damages, photos: finalPhotos } = buildFinalDataset(records, photos, options);
  const photoById = new Map(finalPhotos.map((p) => [p.id, p]));
  const children: (Paragraph | Table)[] = [];

  // 표지
  children.push(
    new Paragraph({ text: "보고서 분석 결과", heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `프로젝트명: ${session.reportName || "-"}` }),
    new Paragraph({ text: `시설물명: ${session.facilityName || "-"}` }),
    new Paragraph({ text: `시설물 유형: ${session.facilityType || "-"}` }),
    new Paragraph({ text: `분석일: ${new Date().toLocaleDateString()}` }),
    new Paragraph({ text: `검수 완료일: ${session.finalizedAt ? new Date(session.finalizedAt).toLocaleDateString() : "-"}` })
  );

  // 1. 분석 개요
  children.push(
    new Paragraph({ text: "1. 분석 개요", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: `시설물: ${session.facilityName || "-"} (${session.facilityType || "-"})` }),
    new Paragraph({ text: `손상 건수: ${damages.length}건` }),
    new Paragraph({ text: `사진 건수: ${finalPhotos.length}건` })
  );

  // 2. 손상 요약
  if (options.includeDamageList) {
    const rows = buildDamageRows(damages);
    children.push(new Paragraph({ text: "2. 손상 요약", heading: HeadingLevel.HEADING_1 }));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          headerRow(["No", "구간", "손상명", "부위", "세부부위", "위치", "보수방안", "규모/물량", "상태"]),
          ...rows.map((r) => dataRow([r.no, r.section, r.damageName, r.part, r.subPart, r.location, r.repairMethod, r.quantityDisplay, r.status])),
        ],
      })
    );
  }

  // 3. 손상 상세 (+ 4. 손상 사진을 손상별로 함께 배치 — 손상과 사진을 분리하면 대조가 불편하므로 통합)
  children.push(new Paragraph({ text: "3. 손상 상세", heading: HeadingLevel.HEADING_1 }));
  for (const d of damages) {
    children.push(new Paragraph({ text: `${d.id} — ${d.damageName}`, heading: HeadingLevel.HEADING_2 }));
    children.push(
      new Paragraph({
        text: `${d.section} / ${d.part} / ${d.subPart} / ${d.location} / ${d.quantity ?? d.quantityGroup ?? "규모 정보 없음"} / ${d.repairMethod}`,
      })
    );
    children.push(new Paragraph({ text: `출처: ${d.sourceReferences.map((r) => `p.${r.page}`).join(", ") || "미상"}` }));

    if (options.includePhotos) {
      const linkedPhotos = (d.photoIds ?? []).map((id) => photoById.get(id)).filter((p): p is ExtractedPhoto => !!p);
      if (linkedPhotos.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: "사진 없음", italics: true })] }));
      } else {
        for (const p of linkedPhotos) {
          try {
            children.push(
              new Paragraph({
                children: [new ImageRun({ data: dataUrlToBytes(p.image.dataUrl), transformation: { width: 200, height: 150 }, type: "png" })],
              })
            );
          } catch {
            // 이미지 디코딩 실패는 보고서 생성 전체를 막지 않고, 캡션만 남긴다.
          }
          children.push(new Paragraph({ text: `사진번호: ${p.photoNo ?? p.id} · 페이지: ${p.page} · 캡션: ${p.caption ?? "-"}` }));
        }
      }
    }
  }

  // 4. 교차검증 결과
  children.push(new Paragraph({ text: "4. 교차검증 결과", heading: HeadingLevel.HEADING_1 }));
  if (options.includeCrossValidation) {
    const cvRows = buildCrossValidationRows(damages);
    if (cvRows.length === 0) {
      children.push(new Paragraph({ text: "추가자료 교차검증을 수행하지 않음" }));
    } else {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            headerRow(["손상 No", "검증자료", "항목", "주 보고서 값", "추가자료 값", "결과", "사용자 결정"]),
            ...cvRows.map((r) => dataRow([r.damageNo, r.sourceFile, r.item, r.mainValue, r.additionalValue, r.result, r.decision])),
          ],
        })
      );
    }
  } else {
    children.push(new Paragraph({ text: "추가자료 교차검증을 수행하지 않음" }));
  }

  // 5. 검수 결과
  children.push(new Paragraph({ text: "5. 검수 결과", heading: HeadingLevel.HEADING_1 }));
  children.push(
    new Paragraph({
      text: `최종 검수 완료 여부: ${session.finalReviewStatus === "finalized" ? "완료" : "미완료"} (버전 ${session.reviewVersion})`,
    })
  );
  if (options.includeReviewHistory) {
    const historyRows = buildReviewHistoryRows(damages);
    children.push(new Paragraph({ text: `수정된 항목: ${historyRows.length}건` }));
    if (historyRows.length > 0) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            headerRow(["손상 No", "변경항목", "원래 값", "최종 값", "변경 유형"]),
            ...historyRows.map((r) => dataRow([r.damageNo, r.field, r.originalValue, r.finalValue, r.changeType])),
          ],
        })
      );
    }
  }
  const decidedCandidates = candidateDamages.filter((c) => c.decision);
  children.push(
    new Paragraph({
      text: `후보 처리 결과: 승인 ${damages.filter((d) => d.notes?.includes("추가자료")).length}건 · 제외 ${decidedCandidates.filter((c) => c.decision === "excluded").length}건 · 보류 ${decidedCandidates.filter((c) => c.decision === "deferred").length}건`,
    })
  );

  const doc = new Document({ sections: [{ children }] });
  // Node의 Buffer에 의존하는 toBuffer() 대신, 브라우저/Node 양쪽에서 동작하는 toArrayBuffer()를 쓴다
  // (Packer.toBuffer()는 브라우저에서 "nodebuffer is not supported by this platform" 오류가 난다).
  return Packer.toArrayBuffer(doc);
}

export function wordFileName(session: ReviewSession, date?: Date): string {
  return generateFileName(session.reportName, "최종보고서", "docx", date);
}
