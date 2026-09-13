import { extractPdfText } from "../pdf";
import { extractCandidatesFromText } from "./textCandidate";
import type { AdditionalEvidenceCandidate, AdditionalSourceType } from "../../types";

export async function parseAdditionalPdf(
  file: File,
  sourceType: AdditionalSourceType
): Promise<{ candidates: AdditionalEvidenceCandidate[]; contentSample: string }> {
  const pages = await extractPdfText(file);
  const candidates = pages.flatMap((p) => extractCandidatesFromText(p.text, { fileName: file.name, sourceType, page: p.page }));
  const contentSample = pages
    .map((p) => p.text)
    .join(" ")
    .slice(0, 3000);
  return { candidates, contentSample };
}
