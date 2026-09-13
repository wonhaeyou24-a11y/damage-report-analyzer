import type { AdditionalEvidenceCandidate, AdditionalSourceRef, StandardPart } from "../../types";
import { standardizePart } from "../normalize";
import { candidateFromChunk } from "./textCandidate";

const HEADER_MAP: Record<string, string> = {
  구간: "section",
  부위: "part",
  세부부위: "subPart",
  손상명: "damageName",
  손상내용: "damageName",
  손상종류: "damageName",
  위치: "location",
  보수공법: "repairMethod",
  보수방안: "repairMethod",
  보강방안: "repairMethod",
  "규모/물량": "quantity",
  수량: "quantity",
  규모: "quantity",
  물량: "quantity",
  사진번호: "photoNo",
};

// 긴 키워드부터 검사한다 — 그렇지 않으면 "세부부위"가 "부위"에 먼저 매칭되어 버린다.
const HEADER_KEYS_BY_LENGTH_DESC = Object.keys(HEADER_MAP).sort((a, b) => b.length - a.length);

function detectHeaderRow(rows: string[][]): { rowIndex: number; columnMap: Record<number, string> } | null {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i];
    const columnMap: Record<number, string> = {};
    let hits = 0;
    row.forEach((cell, colIdx) => {
      const cleaned = cell.replace(/\s+/g, "");
      const key = HEADER_KEYS_BY_LENGTH_DESC.find((h) => cleaned.includes(h));
      if (key) {
        columnMap[colIdx] = HEADER_MAP[key];
        hits++;
      }
    });
    if (hits >= 2) return { rowIndex: i, columnMap };
  }
  return null;
}

/**
 * STEP 8 — Excel 시트 / Word 표를 표 구조(행/열)를 유지한 채로 손상 후보로 변환한다.
 * 헤더를 인식하지 못하면(업체마다 표 형식이 다를 수 있음) 각 행을 텍스트로 보고
 * 최소한의 키워드 기반 후보라도 생성한다 — 파일 자체는 항상 분석 대상으로 남긴다.
 */
export function extractCandidatesFromTableRows(
  rows: string[][],
  base: Omit<AdditionalSourceRef, "quote" | "row" | "column" | "cell">
): AdditionalEvidenceCandidate[] {
  if (rows.length === 0) return [];
  const header = detectHeaderRow(rows);

  if (!header) {
    return rows.flatMap((row, rowIdx) => {
      const text = row.join(" ").trim();
      if (!text) return [];
      const c = candidateFromChunk(text, null, { ...base, row: rowIdx + 1 });
      return c ? [c] : [];
    });
  }

  const candidates: AdditionalEvidenceCandidate[] = [];
  for (let r = header.rowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => !c.trim())) continue;
    const fields: Record<string, string> = {};
    Object.entries(header.columnMap).forEach(([colIdx, field]) => {
      const v = row[Number(colIdx)];
      if (v && v.trim()) fields[field] = v.trim();
    });
    if (Object.keys(fields).length === 0) continue;

    const part: StandardPart | null = fields.part ? standardizePart(fields.part).part : null;
    candidates.push({
      section: fields.section ?? null,
      damageName: fields.damageName ?? null,
      part,
      subPart: fields.subPart ?? null,
      location: fields.location ?? null,
      repairMethod: fields.repairMethod ?? null,
      quantity: fields.quantity ?? null,
      photoNo: fields.photoNo ?? null,
      sourceRef: { ...base, row: r + 1, quote: row.join(" | ").slice(0, 200) },
    });
  }
  return candidates;
}
