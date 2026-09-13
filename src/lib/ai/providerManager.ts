import { createClaudeProvider } from "./claudeProvider";
import { createGeminiProvider } from "./geminiProvider";
import { getActiveProviderId, getClaudeApiKey, getGeminiApiKey, getGeminiModel } from "./settings";
import type { AIProvider, ProviderId } from "./types";

export interface AiProviderStatus {
  providerId: ProviderId;
  ready: boolean;
  reason?: string;
}

/**
 * STEP 12-1 — AI 분석 실행 전 연결 상태 검사(스펙 18번). 준비되지 않았으면 AI 호출을
 * 시작하지 않고 이유를 돌려준다 — 호출부는 이 이유를 그대로 사용자에게 보여준다.
 */
export function getAiProviderStatus(): AiProviderStatus {
  const providerId = getActiveProviderId();
  if (providerId === "gemini") {
    if (!getGeminiApiKey()) return { providerId, ready: false, reason: "Gemini API Key가 필요합니다. AI 설정에서 입력해주세요." };
    if (!getGeminiModel()) return { providerId, ready: false, reason: "Gemini Model을 선택해주세요." };
    return { providerId, ready: true };
  }
  if (!getClaudeApiKey()) return { providerId, ready: false, reason: "Claude API 키를 입력하세요." };
  return { providerId, ready: true };
}

export function getActiveProvider(): AIProvider {
  const providerId = getActiveProviderId();
  if (providerId === "gemini") {
    return createGeminiProvider(getGeminiApiKey(), getGeminiModel());
  }
  return createClaudeProvider(getClaudeApiKey());
}
