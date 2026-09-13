import { describe, expect, it } from "vitest";
import { buildValidationRun, runFullValidation } from "./runValidation";
import { createEmptyGroundTruth } from "./types";
import type { TestCase } from "./types";
import type { DamageRecord } from "../types";

function ai(overrides: Partial<DamageRecord>): DamageRecord {
  return {
    id: "③-01",
    groupNo: "③",
    groupIndex: 1,
    section: "1구간",
    damageName: "균열",
    part: "배수시설",
    subPart: "소단측구",
    location: "165m",
    repairMethod: "주입보수",
    quantity: null,
    quantityGroup: "23.3m",
    photos: [],
    status: "confirmed",
    sourcePages: [80],
    sourceReferences: [{ page: 80, type: "table" }],
    ...overrides,
  };
}

function testCase(overrides: Partial<TestCase>): TestCase {
  return {
    id: "T001",
    reportFileName: "report.pdf",
    reportName: "테스트 보고서",
    facilityType: "비탈면",
    reportFormat: "표 중심",
    vendorType: "양식 A",
    difficulty: "LOW",
    additionalFiles: [],
    groundTruth: null,
    runs: [],
    status: "not_run",
    ...overrides,
  };
}

const meta = { engineVersion: "1.0.0", promptVersion: "v1", provider: "anthropic", model: "claude-sonnet-5" };

describe("buildValidationRun", () => {
  it("refuses to validate a test case without Ground Truth (AI output is never treated as the answer key)", () => {
    const tc = testCase({ groundTruth: null });
    expect(() => buildValidationRun({ testCase: tc, aiDamages: [], aiPhotos: [], processingTimeMs: 100, ...meta })).toThrow(/Ground Truth/);
  });

  it("produces a run with a VR-prefixed id and correct run numbering across repeated runs", () => {
    const gt = { ...createEmptyGroundTruth(), damages: [], photos: [] };
    const tc = testCase({ groundTruth: gt, runs: ["VR-x"] });
    const run = buildValidationRun({ testCase: tc, aiDamages: [], aiPhotos: [], processingTimeMs: 50, ...meta });
    expect(run.id).toMatch(/^VR-\d{8}-\d{3}$/);
    expect(run.runNumber).toBe(2); // 이전 실행 1회 + 이번 실행
  });

  it("records '미제공' for token usage when the caller does not supply it, instead of fabricating a cost", () => {
    const gt = { ...createEmptyGroundTruth() };
    const tc = testCase({ groundTruth: gt });
    const run = buildValidationRun({ testCase: tc, aiDamages: [], aiPhotos: [], processingTimeMs: 10, ...meta });
    expect(run.tokenUsage.estimatedCost).toBe("미제공");
    expect(run.tokenUsage.totalTokens).toBeNull();
  });
});

describe("runFullValidation — one failing case does not stop the rest (spec section 32)", () => {
  it("continues past a test case with no Ground Truth and still runs the others", async () => {
    const withGt = testCase({ id: "T001", groundTruth: createEmptyGroundTruth() });
    const withoutGt = testCase({ id: "T002", groundTruth: null });
    const outcomes = await runFullValidation(
      [withGt, withoutGt],
      async () => ({ aiDamages: [ai({})], aiPhotos: [], processingTimeMs: 20 }),
      meta
    );
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].run).toBeTruthy();
    expect(outcomes[1].error).toContain("Ground Truth");
  });

  it("continues past an executor that throws (e.g. a real analysis failure) for one case", async () => {
    const t1 = testCase({ id: "T001", groundTruth: createEmptyGroundTruth() });
    const t2 = testCase({ id: "T002", groundTruth: createEmptyGroundTruth() });
    const outcomes = await runFullValidation(
      [t1, t2],
      async (tc) => {
        if (tc.id === "T001") throw new Error("PDF 파싱 실패");
        return { aiDamages: [], aiPhotos: [], processingTimeMs: 5 };
      },
      meta
    );
    expect(outcomes[0].error).toBe("PDF 파싱 실패");
    expect(outcomes[1].run).toBeTruthy();
  });

  it("reports progress once per test case, in order, even when one fails (for a UI progress indicator)", async () => {
    const t1 = testCase({ id: "T001", groundTruth: createEmptyGroundTruth() });
    const t2 = testCase({ id: "T002", groundTruth: null });
    const t3 = testCase({ id: "T003", groundTruth: createEmptyGroundTruth() });
    const progress: { done: number; total: number; id: string }[] = [];
    await runFullValidation(
      [t1, t2, t3],
      async () => ({ aiDamages: [], aiPhotos: [], processingTimeMs: 1 }),
      meta,
      undefined,
      (done, total, testCaseId) => progress.push({ done, total, id: testCaseId })
    );
    expect(progress).toEqual([
      { done: 1, total: 3, id: "T001" },
      { done: 2, total: 3, id: "T002" },
      { done: 3, total: 3, id: "T003" },
    ]);
  });
});
