import { createWorker } from "tesseract.js";

/**
 * 크롭된 사진 이미지에 OCR을 수행한다. 실패해도 전체 분석이 중단되지 않도록
 * 호출부에서 try/catch로 감싸고, 여기서는 원본 텍스트와 신뢰도만 그대로 반환한다
 * (OCR 결과를 원본 사실로 확정하지 않고 별도 필드로 분리해서 다루는 것은 호출부 책임).
 */
export interface OcrResult {
  text: string;
  confidence: number; // 0~1
}

let workerPromise: ReturnType<typeof createWorker> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker(["kor", "eng"]);
  }
  return workerPromise;
}

export async function runOcr(imageDataUrl: string): Promise<OcrResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageDataUrl);
  return { text: data.text.trim(), confidence: (data.confidence ?? 0) / 100 };
}

export async function terminateOcrWorker(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}
