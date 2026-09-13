import { describe, expect, it } from "vitest";
import { compareRunSets, compareRuns, overallF1Average } from "./regression";
import type { ValidationRun } from "./types";

function run(overrides: Partial<ValidationRun>): ValidationRun {
  return {
    id: "VR-1",
    testCaseId: "T001",
    runNumber: 1,
    engineVersion: "1.0.0",
    promptVersion: "v1",
    provider: "anthropic",
    model: "claude-sonnet-5",
    timestamp: new Date().toISOString(),
    processingTimeMs: 100,
    stepStatuses: {},
    metrics: {
      damageDetection: { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0.9 },
      fieldAccuracy: [],
      photoExtraction: { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 },
      photoLink: { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 },
      crossValidation: { matched: 0, conflict: 0, missingInAdditional: 0, candidate: 0, unsupported: 0, accuracy: null },
      overallF1: 0.9,
      status: "GOOD",
    },
    errors: [],
    tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: "미제공" },
    ...overrides,
  };
}

describe("compareRuns", () => {
  it("flags a large drop as a warning (spec section 30 — 95% -> 72% should warn)", () => {
    const prev = run({ id: "VR-1", metrics: { ...run({}).metrics, overallF1: 0.95 } });
    const next = run({ id: "VR-2", metrics: { ...run({}).metrics, overallF1: 0.72 } });
    const cmp = compareRuns(prev, next);
    expect(cmp.warning).toBe(true);
    expect(cmp.delta).toBeCloseTo(-0.23, 4);
  });

  it("does not warn on improvement", () => {
    const prev = run({ metrics: { ...run({}).metrics, overallF1: 0.91 } });
    const next = run({ metrics: { ...run({}).metrics, overallF1: 0.94 } });
    expect(compareRuns(prev, next).warning).toBe(false);
  });
});

describe("compareRunSets", () => {
  it("only compares matching test case ids and uses the latest previous run per case", () => {
    const prevRuns = [run({ testCaseId: "T001", runNumber: 1, metrics: { ...run({}).metrics, overallF1: 0.8 } }), run({ testCaseId: "T001", runNumber: 2, metrics: { ...run({}).metrics, overallF1: 0.85 } })];
    const nextRuns = [run({ testCaseId: "T001", runNumber: 3, metrics: { ...run({}).metrics, overallF1: 0.9 } })];
    const comparisons = compareRunSets(prevRuns, nextRuns);
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].prevF1).toBe(0.85); // 가장 최근 이전 실행과 비교
  });
});

describe("overallF1Average", () => {
  it("averages across runs and returns 0 for an empty set instead of NaN", () => {
    expect(overallF1Average([])).toBe(0);
    expect(overallF1Average([run({ metrics: { ...run({}).metrics, overallF1: 0.8 } }), run({ metrics: { ...run({}).metrics, overallF1: 1.0 } })])).toBeCloseTo(0.9, 4);
  });
});
