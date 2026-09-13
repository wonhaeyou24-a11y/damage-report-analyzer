import * as XLSX from "xlsx";
import { extractCandidatesFromTableRows } from "./tableCandidate";
import type { AdditionalEvidenceCandidate, AdditionalSourceType } from "../../types";

export async function parseAdditionalExcel(
  file: File,
  sourceType: AdditionalSourceType
): Promise<{ candidates: AdditionalEvidenceCandidate[]; contentSample: string }> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const candidates: AdditionalEvidenceCandidate[] = [];
  let contentSample = "";

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const rows = rawRows.map((r) => r.map((c) => String(c ?? "")));
    candidates.push(...extractCandidatesFromTableRows(rows, { fileName: file.name, sourceType, sheet: sheetName }));
    contentSample += `${sheetName} ${rows.flat().join(" ")} `;
  }

  return { candidates, contentSample: contentSample.slice(0, 3000) };
}
