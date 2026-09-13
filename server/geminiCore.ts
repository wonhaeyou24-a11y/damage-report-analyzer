/**
 * STEP 12-1 — Gemini API 백엔드 relay 핵심 로직.
 *
 * 이 파일은 Vercel Serverless Function(api/gemini.ts)과 로컬 개발 서버(vite.config.ts의
 * dev 미들웨어)에서 공통으로 사용한다. 프론트엔드는 절대 Gemini API를 직접 호출하지
 * 않고, 반드시 이 relay를 거친다 — Gemini API Key가 브라우저 네트워크 탭에 노출되지
 * 않도록 하기 위함이다(스펙 7번).
 *
 * 이 파일은 손상분석 도메인 로직(프롬프트, JSON 파싱 등)을 전혀 모른다 — 그건 프론트엔드
 * GeminiProvider(src/lib/ai/geminiProvider.ts)가 담당한다. 여기서는 순수하게
 * "텍스트/이미지를 Gemini에 전달하고 텍스트 응답을 돌려주는" 역할만 한다(스펙 4번,
 * Provider가 damageRecords 등을 직접 다루지 않는다는 원칙과 동일하게, 이 relay도
 * 특정 보고서/업체 로직을 갖지 않는다 — 스펙 21번 범용성 보존).
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export type GeminiRequestBody =
  | { action: "listModels"; apiKey?: string }
  | { action: "generateText"; apiKey?: string; model: string; prompt: string }
  | { action: "generateVision"; apiKey?: string; model: string; prompt: string; imageBase64: string; mediaType: string };

export interface HandlerResult {
  status: number;
  body: unknown;
}

function resolveApiKey(bodyKey: string | undefined): string {
  const trimmed = bodyKey?.trim();
  if (trimmed) return trimmed;
  return process.env.GEMINI_API_KEY?.trim() ?? "";
}

/** Gemini/네트워크 오류를 사용자가 이해할 수 있는 한국어 메시지로 변환한다(스펙 13번). API Key
 * 원문은 절대 포함하지 않는다. Gemini가 자기 서비스에 대해 돌려준 오류 메시지(예: "모델이
 * 과부하 상태입니다")는 API Key를 포함하지 않는 안전한 진단 정보이므로, 있으면 괄호로 덧붙여
 * 사용자가 원인을 바로 알 수 있게 한다(스펙 13번 "이해하기 쉬운 메시지"와 실사용 진단성을 절충). */
function mapErrorMessage(status: number, detail?: string): string {
  const base =
    status === 400
      ? "Gemini API Key 또는 요청 형식이 올바르지 않습니다."
      : status === 401 || status === 403
        ? "Gemini 인증에 실패했습니다. API Key를 확인해주세요."
        : status === 404
          ? "선택한 Gemini 모델을 사용할 수 없습니다."
          : status === 429
            ? "Gemini API 사용 한도에 도달했습니다."
            : status >= 500
              ? "AI 서버(Gemini) 처리 중 오류가 발생했습니다."
              : `Gemini 요청이 실패했습니다. (${status})`;
  return detail ? `${base} (Gemini 응답: ${detail})` : base;
}

/** Gemini 오류 응답 바디에서 API Key를 노출하지 않는 진단 메시지만 뽑아낸다. */
function extractGeminiErrorDetail(rawText: string): string | undefined {
  try {
    const parsed = JSON.parse(rawText) as { error?: { message?: string; status?: string } };
    const message = parsed.error?.message;
    return typeof message === "string" ? message.slice(0, 300) : undefined;
  } catch {
    return rawText ? rawText.slice(0, 300) : undefined;
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface GeminiGenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

interface GeminiModelsResponse {
  models?: { name: string; supportedGenerationMethods?: string[] }[];
}

export async function handleGeminiRequest(input: GeminiRequestBody): Promise<HandlerResult> {
  const apiKey = resolveApiKey(input.apiKey);
  if (!apiKey) {
    return { status: 400, body: { error: "Gemini API Key가 필요합니다." } };
  }

  try {
    if (input.action === "listModels") {
      const res = await fetch(`${GEMINI_API_BASE}/models?key=${encodeURIComponent(apiKey)}`);
      if (!res.ok) {
        const rawText = await safeReadText(res);
        const detail = extractGeminiErrorDetail(rawText);
        console.error(`[gemini] listModels 실패 (status ${res.status}):`, detail ?? "(본문 없음)");
        return { status: res.status, body: { error: mapErrorMessage(res.status, detail) } };
      }
      const data = (await res.json()) as GeminiModelsResponse;
      const models = (data.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""));
      return { status: 200, body: { models } };
    }

    if (input.action === "generateText" || input.action === "generateVision") {
      if (!input.model) {
        return { status: 400, body: { error: "Gemini Model을 선택해주세요." } };
      }
      const parts: GeminiPart[] = [];
      if (input.action === "generateVision") {
        parts.push({ inline_data: { mime_type: input.mediaType, data: input.imageBase64 } });
      }
      parts.push({ text: input.prompt });

      const res = await fetch(
        `${GEMINI_API_BASE}/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ parts }] }),
        }
      );
      if (!res.ok) {
        const rawText = await safeReadText(res);
        const detail = extractGeminiErrorDetail(rawText);
        console.error(`[gemini] ${input.action} 실패 (status ${res.status}, model ${input.model}):`, detail ?? "(본문 없음)");
        return { status: res.status, body: { error: mapErrorMessage(res.status, detail) } };
      }
      const data = (await res.json()) as GeminiGenerateResponse;
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const usageMeta = data.usageMetadata;
      const usage: GeminiUsage = usageMeta
        ? {
            inputTokens: usageMeta.promptTokenCount ?? null,
            outputTokens: usageMeta.candidatesTokenCount ?? null,
            totalTokens: usageMeta.totalTokenCount ?? null,
          }
        : { inputTokens: null, outputTokens: null, totalTokens: null };
      return { status: 200, body: { text, usage } };
    }

    return { status: 400, body: { error: "지원하지 않는 작업입니다." } };
  } catch (err) {
    // API Key는 절대 로그에 남기지 않는다(스펙 16, 24번) — err 메시지에도 apiKey 변수를 포함하지 않는다.
    console.error("[gemini] 요청 처리 실패:", err instanceof Error ? err.message : String(err));
    return { status: 502, body: { error: "Gemini 서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요." } };
  }
}
