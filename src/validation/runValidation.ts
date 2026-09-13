import type { DamageRecord, ExtractedPhoto } from "../types";
import { buildErrorEntries } from "./errorAnalysis";
import { matchDamages } from "./groundTruthMatch";
import { computeValidationMetrics } from "./metrics";
import { matchPhotos } from "./photoMatch";
import type { TestCase, TokenUsage, ValidationRun, ValidationStatus, ValidationThresholds } from "./types";

/**
 * STEP 11 — 검증 실행(run) 오케스트레이터. 실제 STEP1~10 분석 파이프라인을 호출하지
 * 않는다 — 이미 실행된 AI 결과(aiDamages/aiPhotos)를 입력으로 받아 Ground Truth와
 * 비교만 한다. 이렇게 분리해야 "검증 로직이 실제 분석 로직을 우회"하는 일이 없다
 * (분석은 항상 기존 STEP1~10 파이프라인 그대로 실행된 결과를 그대로 사용한다).
 */

let runIdCounter = 0;
function nextRunId(): string {
  runIdCounter += 1;
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `VR-${ymd}-${String(runIdCounter).padStart(3, "0")}`;
}

export interface BuildValidationRunInput {
  testCase: TestCase;
  aiDamages: DamageRecord[];
  aiPhotos: ExtractedPhoto[];
  engineVersion: string;
  promptVersion: string;
  provider: string;
  model: string;
  processingTimeMs: number | null;
  tokenUsage?: TokenUsage;
  stepStatuses?: Record<string, ValidationStatus>;
}

const DEFAULT_TOKEN_USAGE: TokenUsage = { inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: "미제공" };

/** Ground Truth가 없는 테스트 케이스는 검증할 수 없다 — AI 결과를 정답으로 삼지 않는다. */
export function buildValidationRun(input: BuildValidationRunInput, thresholds?: ValidationThresholds): ValidationRun {
  if (!input.testCase.groundTruth) {
    throw new Error(`${input.testCase.id}: Ground Truth가 작성되지 않아 검증할 수 없습니다.`);
  }
  const gt = input.testCase.groundTruth;

  const { matched, missed, extra } = matchDamages(gt.damages, input.aiDamages);
  const photoResult = matchPhotos(gt.photos, input.aiPhotos);
  const metrics = computeValidationMetrics(gt.damages, input.aiDamages, gt.photos, input.aiPhotos, thresholds);
  const errors = buildErrorEntries(input.testCase.id, matched, missed, extra, photoResult);

  return {
    id: nextRunId(),
    testCaseId: input.testCase.id,
    runNumber: input.testCase.runs.length + 1,
    engineVersion: input.engineVersion,
    promptVersion: input.promptVersion,
    provider: input.provider,
    model: input.model,
    timestamp: new Date().toISOString(),
    processingTimeMs: input.processingTimeMs,
    stepStatuses: input.stepStatuses ?? {},
    metrics,
    errors,
    tokenUsage: input.tokenUsage ?? DEFAULT_TOKEN_USAGE,
  };
}

export interface FullValidationOutcome {
  testCaseId: string;
  run?: ValidationRun;
  error?: string;
}

export interface ValidationExecutorResult {
  aiDamages: DamageRecord[];
  aiPhotos: ExtractedPhoto[];
  processingTimeMs: number | null;
  tokenUsage?: TokenUsage;
  stepStatuses?: Record<string, ValidationStatus>;
}

export interface RunMeta {
  engineVersion: string;
  promptVersion: string;
  provider: string;
  model: string;
}

/**
 * 테스트 케이스 전체를 순차 실행한다. 하나가 실패해도(Ground Truth 없음, 분석 실패 등)
 * 나머지 테스트는 계속 진행한다(스펙 32번) — 개별 실행은 executor(실제 STEP1~10
 * 파이프라인 호출)를 주입받아 이 파일 자체는 네트워크/파일 I/O에 의존하지 않는다.
 */
export async function runFullValidation(
  testCases: TestCase[],
  executor: (testCase: TestCase) => Promise<ValidationExecutorResult>,
  meta: RunMeta,
  thresholds?: ValidationThresholds,
  onProgress?: (done: number, total: number, testCaseId: string) => void
): Promise<FullValidationOutcome[]> {
  const outcomes: FullValidationOutcome[] = [];
  let done = 0;
  for (const testCase of testCases) {
    try {
      if (!testCase.groundTruth) {
        outcomes.push({ testCaseId: testCase.id, error: "Ground Truth가 작성되지 않았습니다." });
        continue;
      }
      const result = await executor(testCase);
      const run = buildValidationRun({ testCase, ...result, ...meta }, thresholds);
      outcomes.push({ testCaseId: testCase.id, run });
    } catch (err: any) {
      outcomes.push({ testCaseId: testCase.id, error: err.message ?? String(err) });
    } finally {
      done += 1;
      onProgress?.(done, testCases.length, testCase.id);
    }
  }
  return outcomes;
}
