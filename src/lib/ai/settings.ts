import type { ProviderId } from "./types";

/**
 * STEP 12-1 — AI 설정 저장.
 *
 * - Claude API Key: 기존(STEP1) 방식 그대로 localStorage 재사용(변경하지 않음, 하위호환).
 * - 현재 선택된 Provider / Gemini Model: 민감정보 아님 → localStorage.
 * - Gemini API Key: 이 프로젝트에는 아직 사용자 인증·서버 Secret 저장소가 없다(스펙 10번
 *   "서버 저장 구조가 없다면 개발환경에서 안전하게 쓸 수 있는 최소 구조를 구현"). 그래서
 *   localStorage의 "영구 평문 저장"을 기본값으로 만들지 않기 위해 sessionStorage를 사용한다
 *   — 탭을 닫으면 사라지므로 영구 저장이 아니다. STEP 12-2에서 서버 Secret 저장소가
 *   생기면 이 함수의 내부 구현만 교체하면 된다(호출부는 변경 불필요).
 */

export const CLAUDE_API_KEY_STORAGE = "damage-analyzer-api-key";

const PROVIDER_STORAGE = "damage-analyzer-ai-provider";
const GEMINI_API_KEY_STORAGE = "damage-analyzer-gemini-api-key";
const GEMINI_MODEL_STORAGE = "damage-analyzer-gemini-model";

/** 실제 API에서 목록을 조회하지 못했을 때만 쓰는 최소 후보 목록(스펙 11번: 임의 모델명 생성 금지,
 * listGeminiModels()가 성공하면 이 목록 대신 실제 조회 결과를 사용한다). */
export const FALLBACK_GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"];

export function getActiveProviderId(): ProviderId {
  return (localStorage.getItem(PROVIDER_STORAGE) as ProviderId | null) ?? "claude";
}

export function setActiveProviderId(id: ProviderId): void {
  localStorage.setItem(PROVIDER_STORAGE, id);
}

export function getClaudeApiKey(): string {
  return localStorage.getItem(CLAUDE_API_KEY_STORAGE) ?? "";
}

export function getGeminiApiKey(): string {
  try {
    return sessionStorage.getItem(GEMINI_API_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setGeminiApiKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(GEMINI_API_KEY_STORAGE, key);
    else sessionStorage.removeItem(GEMINI_API_KEY_STORAGE);
  } catch {
    // sessionStorage 접근 불가 환경(예: 프라이빗 모드 일부) — 조용히 무시, 매 세션 재입력 필요
  }
}

export function clearGeminiApiKey(): void {
  setGeminiApiKey("");
}

export function getGeminiModel(): string {
  return localStorage.getItem(GEMINI_MODEL_STORAGE) ?? "";
}

export function setGeminiModel(model: string): void {
  localStorage.setItem(GEMINI_MODEL_STORAGE, model);
}
