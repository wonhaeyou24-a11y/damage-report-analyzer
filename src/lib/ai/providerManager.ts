import { MODEL as CLAUDE_MODEL } from "../claude";
import { createClaudeProvider } from "./claudeProvider";
import { createGeminiProvider } from "./geminiProvider";
import { getActiveProviderId, getClaudeApiKey, getGeminiApiKey, getGeminiModel } from "./settings";
import type { AIProvider, ProviderId } from "./types";

export interface AiProviderStatus {
  providerId: ProviderId;
  ready: boolean;
  reason?: string;
}

/** 이 코드가 만드는 추출 로직/프롬프트의 버전 — STEP11(구) 검증과 STEP11(신) 업무기반 품질추적이
 * 같은 값을 쓰도록 한곳에 둔다. 프롬프트나 파이프라인 로직을 의미있게 바꿀 때 사람이 올린다
 * (자동으로 바뀌지 않는다 — 스펙 14/16번). */
export const ENGINE_VERSION = "1.0.0";
export const PROMPT_VERSION = "v1";

/** 현재 활성 Provider/Model을 한 곳에서 얻는다(ValidationApp/App이 각자 중복 구현하지 않도록). */
export function getCurrentProviderModel(): { provider: ProviderId; model: string } {
  const providerId = getActiveProviderId();
  return { provider: providerId, model: providerId === "gemini" ? getGeminiModel() : CLAUDE_MODEL };
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
