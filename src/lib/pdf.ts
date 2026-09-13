import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ExtractedPage {
  page: number;
  text: string;
}

/** PDF에서 페이지별 텍스트를 추출한다 (본문/표 텍스트 레이어 기준). onProgress로 실제 진행
 * 페이지 수를 알려줄 수 있다(가짜 퍼센트가 아니라 실제로 처리한 페이지 수만 보고한다). */
export async function extractPdfText(file: File, onProgress?: (page: number, total: number) => void): Promise<ExtractedPage[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: ExtractedPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str).join(" ");
    pages.push({ page: i, text });
    onProgress?.(i, pdf.numPages);
  }
  return pages;
}

/** 페이지 번호가 표시된 합쳐진 텍스트 — AI 프롬프트에 그대로 넣기 위함. */
export function formatPagesForPrompt(pages: ExtractedPage[]): string {
  return pages.map((p) => `--- 페이지 ${p.page} ---\n${p.text}`).join("\n\n");
}
