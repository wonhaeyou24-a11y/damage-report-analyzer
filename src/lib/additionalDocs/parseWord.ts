import mammoth from "mammoth";
import { extractCandidatesFromTableRows } from "./tableCandidate";
import { extractCandidatesFromText } from "./textCandidate";
import type { AdditionalEvidenceCandidate, AdditionalSourceType } from "../../types";

/** .docx만 지원한다 — 구형 .doc(97-2003) 바이너리는 브라우저에서 직접 파싱할 수 없다. */
export async function parseAdditionalWord(
  file: File,
  sourceType: AdditionalSourceType
): Promise<{ candidates: AdditionalEvidenceCandidate[]; contentSample: string }> {
  const buffer = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buffer });
  const doc = new DOMParser().parseFromString(html, "text/html");

  const candidates: AdditionalEvidenceCandidate[] = [];
  const tables = Array.from(doc.querySelectorAll("table"));
  tables.forEach((table, tableIndex) => {
    const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
      Array.from(tr.querySelectorAll("th,td")).map((td) => td.textContent?.trim() ?? "")
    );
    candidates.push(...extractCandidatesFromTableRows(rows, { fileName: file.name, sourceType, table: tableIndex + 1 }));
  });

  // 표 안 텍스트를 본문에서 중복 스캔하지 않도록 표를 제거한 뒤 나머지 문단을 분석한다.
  tables.forEach((t) => t.remove());
  const bodyText = doc.body?.textContent ?? "";
  candidates.push(...extractCandidatesFromText(bodyText, { fileName: file.name, sourceType }));

  const contentSample = html.replace(/<[^>]+>/g, " ").slice(0, 3000);
  return { candidates, contentSample };
}
