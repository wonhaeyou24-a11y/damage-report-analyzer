import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ExtractedPage {
  page: number;
  text: string;
}

/** PDF에서 페이지별 텍스트를 추출한다 (본문/표 텍스트 레이어 기준). */
export async function extractPdfText(file: File): Promise<ExtractedPage[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: ExtractedPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str).join(" ");
    pages.push({ page: i, text });
  }
  return pages;
}

/** 페이지 번호가 표시된 합쳐진 텍스트 — AI 프롬프트에 그대로 넣기 위함. */
export function formatPagesForPrompt(pages: ExtractedPage[]): string {
  return pages.map((p) => `--- 페이지 ${p.page} ---\n${p.text}`).join("\n\n");
}
