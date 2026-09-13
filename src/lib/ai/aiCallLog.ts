import type { AiCallLogEntry } from "./types";

/**
 * STEP 12-1 — AI 호출 공통 로그(스펙 16번). 세션 메모리에만 유지한다(새로고침 시 초기화).
 * API Key는 절대 기록하지 않는다. tokenUsage/비용은 실제 API가 제공한 경우에만 기록하고,
 * 값이 없으면 임의로 계산하지 않는다(호출부에서 null/미제공으로 넘김).
 */
const log: AiCallLogEntry[] = [];
const MAX_ENTRIES = 500;

export function recordAiCall(entry: AiCallLogEntry): void {
  log.push(entry);
  if (log.length > MAX_ENTRIES) log.shift();
}

export function getAiCallLog(): AiCallLogEntry[] {
  return [...log];
}

export function clearAiCallLog(): void {
  log.length = 0;
}
