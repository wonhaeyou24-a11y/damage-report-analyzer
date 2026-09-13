import { describe, expect, it } from "vitest";
import { aggregateByDifficulty, aggregateByFacilityType, checkUniversalityCriteria, computeOverallSummary } from "./dashboard";
import type { RunPair } from "./dashboard";
import type { TestCase, ValidationRun } from "./types";

function testCase(overrides: Partial<TestCase>): TestCase {
  return {
    id: "T001",
    reportFileName: "a.pdf",
    reportName: "보고서",
    facilityType: "비탈면",
    reportFormat: "표 중심",
    vendorType: "양식 A",
    difficulty: "LOW",
    additionalFiles: [],
    groundTruth: { damages: [], photos: [], locked: true, revisions: [] },
    runs: ["VR-1"],
    status: "completed",
    ...overrides,
  };
}

function run(overallF1: number, overrides: Partial<ValidationRun> = {}): ValidationRun {
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
      damageDetection: { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: overallF1 },
      fieldAccuracy: [{ field: "location", matched: 8, total: 10, matchRate: 0.8 }],
      photoExtraction: { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0.9 },
      photoLink: { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0.85 },
      crossValidation: { matched: 0, conflict: 0, missingInAdditional: 0, candidate: 0, unsupported: 0, accuracy: null },
      overallF1,
      status: overallF1 >= 0.9 ? "GOOD" : overallF1 >= 0.75 ? "WARNING" : "FAIL",
    },
    errors: [],
    tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: "미제공" },
    ...overrides,
  };
}

describe("aggregateByFacilityType", () => {
  it("groups by facility type and averages F1/location within each group", () => {
    const pairs: RunPair[] = [
      { testCase: testCase({ id: "T001", facilityType: "비탈면" }), run: run(0.94) },
      { testCase: testCase({ id: "T002", facilityType: "비탈면" }), run: run(0.9) },
      { testCase: testCase({ id: "T003", facilityType: "옹벽" }), run: run(0.8) },
    ];
    const groups = aggregateByFacilityType(pairs);
    const slope = groups.find((g) => g.key === "비탈면")!;
    expect(slope.testCount).toBe(2);
    expect(slope.avgF1).toBeCloseTo(0.92, 4);
    const wall = groups.find((g) => g.key === "옹벽")!;
    expect(wall.testCount).toBe(1);
  });
});

describe("aggregateByDifficulty", () => {
  it("keeps LOW/MEDIUM/HIGH separate", () => {
    const pairs: RunPair[] = [
      { testCase: testCase({ id: "T001", difficulty: "LOW" }), run: run(0.97) },
      { testCase: testCase({ id: "T002", difficulty: "HIGH" }), run: run(0.7) },
    ];
    const groups = aggregateByDifficulty(pairs);
    expect(groups.find((g) => g.key === "LOW")?.avgF1).toBeCloseTo(0.97, 4);
    expect(groups.find((g) => g.key === "HIGH")?.avgF1).toBeCloseTo(0.7, 4);
  });
});

describe("computeOverallSummary", () => {
  it("counts GOOD/WARNING/FAIL buckets correctly", () => {
    const pairs: RunPair[] = [
      { testCase: testCase({ id: "T001" }), run: run(0.95) }, // GOOD
      { testCase: testCase({ id: "T002" }), run: run(0.8) }, // WARNING
      { testCase: testCase({ id: "T003" }), run: run(0.5) }, // FAIL
    ];
    const summary = computeOverallSummary(pairs, 5); // 5개 등록되었지만 3개만 완료
    expect(summary.totalTestCases).toBe(5);
    expect(summary.completed).toBe(3);
    expect(summary.good).toBe(1);
    expect(summary.warning).toBe(1);
    expect(summary.fail).toBe(1);
  });
});

describe("checkUniversalityCriteria — never claims absolute universality", () => {
  it("fails the criteria with fewer than 10 completed cases and reports why", () => {
    const pairs: RunPair[] = [{ testCase: testCase({}), run: run(0.9) }];
    const check = checkUniversalityCriteria(pairs, [testCase({})]);
    expect(check.ok).toBe(false);
    expect(check.label).not.toContain("검증 완료");
    expect(check.reasons.some((r) => r.includes("10건"))).toBe(true);
  });

  it("uses the qualified phrase 'current test data' rather than an absolute universality claim when it does pass", () => {
    const pairs: RunPair[] = Array.from({ length: 10 }, (_, i) =>
      ({ testCase: testCase({ id: `T${i}`, facilityType: i % 2 === 0 ? "비탈면" : "옹벽", vendorType: i % 3 === 0 ? "양식 A" : "양식 B" }), run: run(0.9) })
    );
    const check = checkUniversalityCriteria(pairs, pairs.map((p) => p.testCase));
    expect(check.ok).toBe(true);
    expect(check.label).toBe("현재 테스트 데이터 기준 범용성 검증 완료");
  });
});
