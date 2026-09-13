import type { RawDamageGroup, VisionInference } from "../../types";
import { buildExtractionPrompt, buildVisionPrompt } from "../aiPrompt";
import { recordAiCall } from "./aiCallLog";
import { generateGeminiText, generateGeminiVision } from "./geminiClient";
import type { AIProvider } from "./types";

/**
 * STEP 12-1 — GeminiProvider. 프롬프트 구성과 응답 JSON 파싱은 기존 claude.ts와 동일한
 * 방식을 그대로 따른다(출력 데이터 구조를 STEP1~10 기존 파이프라인에 맞추기 위함, 스펙 2번).
 * 실제 Gemini 네트워크 호출은 하지 않고 반드시 /api/gemini 백엔드를 통해서만 호출한다.
 */
export function createGeminiProvider(apiKey: string, model: string): AIProvider {
  return {
    id: "gemini",
    label: "Gemini",

    async analyzeDocument(reportText: string): Promise<RawDamageGroup[]> {
      const startedAt = Date.now();
      try {
        const { text, usage } = await generateGeminiText(apiKey, model, buildExtractionPrompt(reportText));
        recordAiCall({
          provider: "gemini",
          model,
          operation: "damageExtraction",
          startedAt,
          completedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          success: true,
          tokenUsage: usage,
        });
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          throw new Error("AI 응답에서 JSON 배열을 찾지 못했습니다. 원문: " + text.slice(0, 500));
        }
        return JSON.parse(jsonMatch[0]) as RawDamageGroup[];
      } catch (err) {
        recordAiCall({
          provider: "gemini",
          model,
          operation: "damageExtraction",
          startedAt,
          completedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          success: false,
          errorType: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },

    async analyzeImage(imageDataUrl: string, contextText: string): Promise<VisionInference> {
      const startedAt = Date.now();
      const [, mediaType, base64] = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/) ?? [];
      if (!base64) throw new Error("이미지 데이터 URL 형식이 올바르지 않습니다.");
      try {
        const { text, usage } = await generateGeminiVision(apiKey, model, buildVisionPrompt(contextText), base64, mediaType);
        recordAiCall({
          provider: "gemini",
          model,
          operation: "photoVision",
          startedAt,
          completedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          success: true,
          tokenUsage: usage,
        });
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Vision 응답에서 JSON을 찾지 못했습니다.");
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          damageType: parsed.damageType ?? undefined,
          facility: parsed.facility ?? undefined,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
        };
      } catch (err) {
        recordAiCall({
          provider: "gemini",
          model,
          operation: "photoVision",
          startedAt,
          completedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          success: false,
          errorType: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },

    async testConnection(): Promise<{ ok: boolean; message: string }> {
      const startedAt = Date.now();
      try {
        // 실제 API를 호출해서만 성공 여부를 판단한다(스펙 12번) — 문자열 형식 검사만으로 성공 처리하지 않는다.
        await generateGeminiText(apiKey, model, "연결 테스트입니다. 'OK'라고만 답하십시오.");
        recordAiCall({
          provider: "gemini",
          model,
          operation: "testConnection",
          startedAt,
          completedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          success: true,
        });
        return { ok: true, message: `Gemini 연결 성공 (Model: ${model})` };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Gemini 연결 실패";
        recordAiCall({
          provider: "gemini",
          model,
          operation: "testConnection",
          startedAt,
          completedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          success: false,
          errorType: message,
        });
        return { ok: false, message };
      }
    },
  };
}
