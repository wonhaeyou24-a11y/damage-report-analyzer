import { extractDamageGroupsWithClaude, MODEL } from "../claude";
import { analyzePhotoWithVision } from "../visionAnalysis";
import { recordAiCall } from "./aiCallLog";
import type { AIProvider } from "./types";

/**
 * STEP 12-1 — ClaudeProvider. 기존 STEP1~10의 claude.ts/visionAnalysis.ts 함수를 그대로
 * 호출하는 얇은 어댑터일 뿐이다 — 기존 로직/프롬프트/파싱을 재작성하지 않는다(스펙 14, 31번).
 * Claude 쪽은 토큰 사용량을 아직 노출하지 않으므로(기존 함수 반환값에 없음) tokenUsage는
 * 기록하지 않는다 — 있지도 않은 값을 만들어내지 않는다(스펙 16번).
 */
export function createClaudeProvider(apiKey: string): AIProvider {
  return {
    id: "claude",
    label: "Claude",

    async analyzeDocument(reportText) {
      const startedAt = Date.now();
      try {
        const result = await extractDamageGroupsWithClaude(apiKey, reportText);
        recordAiCall({ provider: "claude", model: MODEL, operation: "damageExtraction", startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt, success: true });
        return result;
      } catch (err) {
        recordAiCall({
          provider: "claude",
          model: MODEL,
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

    async analyzeImage(imageDataUrl, contextText) {
      const startedAt = Date.now();
      try {
        const result = await analyzePhotoWithVision(apiKey, imageDataUrl, contextText);
        recordAiCall({ provider: "claude", model: MODEL, operation: "photoVision", startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt, success: true });
        return result;
      } catch (err) {
        recordAiCall({
          provider: "claude",
          model: MODEL,
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

    async testConnection() {
      try {
        await extractDamageGroupsWithClaude(apiKey, "이것은 연결 테스트용 문서입니다. 손상 내용 없음.");
        return { ok: true, message: `Claude 연결 성공 (Model: ${MODEL})` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Claude 연결 실패" };
      }
    },
  };
}
