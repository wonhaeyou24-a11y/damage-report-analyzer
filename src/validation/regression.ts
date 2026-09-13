import type { ValidationRun } from "./types";

/**
 * STEP 11 — Run 간 비교(회귀 테스트, 스펙 30/54/55번). 특정 케이스의 F1이 큰 폭으로
 * 떨어지면 경고한다. 코드/프롬프트를 고칠 때 기존 결과가 나빠지지 않았는지 확인하는 용도.
 */
export interface RunComparison {
  testCaseId: string;
  prevRunId: string;
  nextRunId: string;
  prevF1: number;
  nextF1: number;
  delta: number;
  warning: boolean;
}

export function compareRuns(prev: ValidationRun, next: ValidationRun, dropThreshold = 0.1): RunComparison {
  const delta = next.metrics.overallF1 - prev.metrics.overallF1;
  return {
    testCaseId: next.testCaseId,
    prevRunId: prev.id,
    nextRunId: next.id,
    prevF1: prev.metrics.overallF1,
    nextF1: next.metrics.overallF1,
    delta,
    warning: delta <= -dropThreshold,
  };
}

/** 두 Run 집합(예: 이전 검증 전체 vs 이후 검증 전체)에서 같은 테스트 케이스끼리만 비교한다. */
export function compareRunSets(prevRuns: ValidationRun[], nextRuns: ValidationRun[], dropThreshold = 0.1): RunComparison[] {
  const latestPrevByCase = new Map<string, ValidationRun>();
  for (const r of prevRuns) {
    const existing = latestPrevByCase.get(r.testCaseId);
    if (!existing || r.runNumber > existing.runNumber) latestPrevByCase.set(r.testCaseId, r);
  }
  return nextRuns
    .filter((n) => latestPrevByCase.has(n.testCaseId))
    .map((n) => compareRuns(latestPrevByCase.get(n.testCaseId)!, n, dropThreshold));
}

export function overallF1Average(runs: ValidationRun[]): number {
  if (runs.length === 0) return 0;
  return runs.reduce((sum, r) => sum + r.metrics.overallF1, 0) / runs.length;
}
