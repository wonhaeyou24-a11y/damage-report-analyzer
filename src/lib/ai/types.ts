import type { RawDamageGroup, VisionInference } from "../../types";

export type ProviderId = "claude" | "gemini";

export interface AiCallLogEntry {
  provider: string;
  model: string;
  operation: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  success: boolean;
  errorType?: string;
  tokenUsage?: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
}

/**
 * STEP 12-1 — AI Provider 최소 추상화. Provider는 AI 호출/응답만 담당하고, damageRecords 등
 * 기존 분석 파이프라인의 데이터 구조는 절대 직접 다루지 않는다(스펙 4번). 기존 파이프라인이
 * Provider가 돌려준 원시 결과(RawDamageGroup[] / VisionInference)를 기존 방식대로 변환한다.
 */
export interface AIProvider {
  id: ProviderId;
  label: string;
  analyzeDocument(reportText: string): Promise<RawDamageGroup[]>;
  analyzeImage(imageDataUrl: string, contextText: string): Promise<VisionInference>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
