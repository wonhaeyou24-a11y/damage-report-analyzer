import type { AdditionalDocument, AdditionalEvidenceCandidate, AdditionalFileType } from "../../types";
import { classifySourceType } from "./classify";
import { parseAdditionalExcel } from "./parseExcel";
import { parseAdditionalPdf } from "./parsePdf";
import { parseAdditionalWord } from "./parseWord";

function detectFileType(fileName: string): AdditionalFileType | null {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "pdf") return "pdf";
  if (ext === "xlsx") return "xlsx";
  if (ext === "xls") return "xls";
  if (ext === "docx") return "docx";
  if (ext === "doc") return "doc";
  return null;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `AD${String(idCounter).padStart(3, "0")}`;
}

/**
 * STEP 8 — 여러 형식의 추가자료 파일을 병렬이 아닌 순차로 분석한다. 파일 하나가
 * 실패해도 나머지 파일 분석은 계속되도록 각 파일을 개별 try/catch로 감싼다.
 */
export async function loadAdditionalDocuments(files: File[]): Promise<AdditionalDocument[]> {
  idCounter = 0;
  const results: AdditionalDocument[] = [];

  for (const file of files) {
    const fileType = detectFileType(file.name);
    if (!fileType) {
      results.push({
        id: nextId(),
        fileName: file.name,
        fileType: "pdf",
        sourceType: "기타",
        sourceTypeConfidence: 0,
        status: "failed",
        error: "지원하지 않는 파일 형식입니다 (PDF/xlsx/xls/docx/doc만 지원).",
        candidates: [],
        duplicateOfIds: [],
      });
      continue;
    }

    try {
      const provisional = classifySourceType(file.name, "");
      let parsed: { candidates: AdditionalEvidenceCandidate[]; contentSample: string };

      if (fileType === "pdf") parsed = await parseAdditionalPdf(file, provisional.sourceType);
      else if (fileType === "xlsx" || fileType === "xls") parsed = await parseAdditionalExcel(file, provisional.sourceType);
      else if (fileType === "docx") parsed = await parseAdditionalWord(file, provisional.sourceType);
      else throw new Error(".doc(97-2003) 형식은 브라우저에서 직접 분석할 수 없습니다. .docx로 변환 후 다시 첨부해 주세요.");

      const final = classifySourceType(file.name, parsed.contentSample);
      const candidates = parsed.candidates.map((c) => ({ ...c, sourceRef: { ...c.sourceRef, sourceType: final.sourceType } }));

      results.push({
        id: nextId(),
        fileName: file.name,
        fileType,
        sourceType: final.sourceType,
        sourceTypeConfidence: final.confidence,
        status: "ok",
        candidates,
        duplicateOfIds: [],
      });
    } catch (err: any) {
      results.push({
        id: nextId(),
        fileName: file.name,
        fileType,
        sourceType: "기타",
        sourceTypeConfidence: 0,
        status: "failed",
        error: err.message ?? String(err),
        candidates: [],
        duplicateOfIds: [],
      });
    }
  }

  applyDuplicateDocDetection(results);
  return results;
}

/**
 * 매우 단순한 근사 중복 탐지: 같은 자료 종류이면서 손상명+위치 후보 집합이 크게
 * 겹치면 "동일 원자료의 사본일 가능성"으로 표시한다. 파일을 임의로 삭제하지 않는다.
 */
function applyDuplicateDocDetection(docs: AdditionalDocument[]) {
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i];
      const b = docs[j];
      if (a.status !== "ok" || b.status !== "ok" || a.sourceType !== b.sourceType) continue;
      if (a.candidates.length === 0 || b.candidates.length === 0) continue;
      const keyOf = (c: AdditionalEvidenceCandidate) => `${c.damageName ?? ""}|${c.location ?? ""}`;
      const setA = new Set(a.candidates.map(keyOf));
      const setB = new Set(b.candidates.map(keyOf));
      const intersection = [...setA].filter((k) => setB.has(k)).length;
      const overlapRatio = intersection / Math.min(setA.size, setB.size);
      if (overlapRatio >= 0.8) {
        a.duplicateOfIds.push(b.id);
        b.duplicateOfIds.push(a.id);
      }
    }
  }
}
