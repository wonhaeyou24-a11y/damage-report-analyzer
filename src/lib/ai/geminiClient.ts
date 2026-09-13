/**
 * STEP 12-1 — 프론트엔드에서 Gemini를 부를 때 절대 Gemini API를 직접 호출하지 않고
 * 반드시 우리 백엔드(/api/gemini)를 거친다. 이 파일은 그 relay 호출 하나만 담당한다.
 * Gemini API Key는 이 함수의 인자로만 전달되며, 여기서 Google로 직접 나가지 않는다.
 */

export interface GeminiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

interface GenerateTextResult {
  text: string;
  usage: GeminiUsage;
}

async function postToBackend<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Gemini 요청이 실패했습니다. (${res.status})`);
  }
  return data as T;
}

export function listGeminiModels(apiKey: string): Promise<string[]> {
  return postToBackend<{ models: string[] }>({ action: "listModels", apiKey }).then((r) => r.models);
}

export function generateGeminiText(apiKey: string, model: string, prompt: string): Promise<GenerateTextResult> {
  return postToBackend<GenerateTextResult>({ action: "generateText", apiKey, model, prompt });
}

export function generateGeminiVision(
  apiKey: string,
  model: string,
  prompt: string,
  imageBase64: string,
  mediaType: string
): Promise<GenerateTextResult> {
  return postToBackend<GenerateTextResult>({ action: "generateVision", apiKey, model, prompt, imageBase64, mediaType });
}
