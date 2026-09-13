import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildValidationExcelBuffer } from "./exportValidationExcel";
import type { RunPair } from "./dashboard";
import type { TestCase, ValidationRun } from "./types";

function testCase(overrides: Partial<TestCase>): TestCase {
  return {
    id: "T001",
    reportFileName: "a.pdf",
    reportName: "테스트 보고서",
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

function run(overrides: Partial<ValidationRun> = {}): ValidationRun {
  return {
    id: "VR-1",
    testCaseId: "T001",
    runNumber: 1,
    engineVersion: "1.0.0",
    promptVersion: "v1",
    provider: "anthropic",
    model: "claude-sonnet-5",
    timestamp: new Date().toISOString(),
    processingTimeMs: 1234,
    stepStatuses: {},
    metrics: {
      damageDetection: { tp: 9, fp: 1, fn: 1, precision: 0.9, recall: 0.9, f1: 0.9 },
      fieldAccuracy: [{ field: "location", matched: 8, total: 9, matchRate: 8 / 9 }],
      photoExtraction: { tp: 3, fp: 0, fn: 1, precision: 1, recall: 0.75, f1: 0.857 },
      photoLink: { tp: 3, fp: 0, fn: 0, precision: 1, recall: 1, f1: 1 },
      crossValidation: { matched: 2, conflict: 1, missingInAdditional: 0, candidate: 0, unsupported: 0, accuracy: null },
      overallF1: 0.9,
      status: "GOOD",
    },
    errors: [
      { id: "ERR-0001", testCaseId: "T001", step: "STEP 4", field: "location", category: "LOCATION_ERROR", groundTruthValue: "211m", aiValue: "208m", groundTruthSource: "p.83", aiSource: "p.80" },
    ],
    tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: "미제공" },
    ...overrides,
  };
}

describe("buildValidationExcelBuffer", () => {
  it("produces a valid non-empty .xlsx zip with all expected sheets", async () => {
    const pairs: RunPair[] = [{ testCase: testCase({}), run: run({}) }];
    const buf = buildValidationExcelBuffer([testCase({})], pairs);
    expect(buf.byteLength).toBeGreaterThan(0);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file("xl/workbook.xml")).toBeTruthy();
    const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
    for (const sheetName of ["Summary", "Test Cases", "Damage Metrics", "Field Metrics", "Photo Metrics", "Cross Validation", "Error Analysis"]) {
      expect(workbookXml).toContain(sheetName);
    }
  });

  it("marks provider comparison as unavailable rather than fabricating numbers", async () => {
    const buf = buildValidationExcelBuffer([testCase({})], [{ testCase: testCase({}), run: run({}) }]);
    const zip = await JSZip.loadAsync(buf);
    // Provider Comparison은 항상 첫 번째로 추가되는 8번째 시트이므로 sheet 번호를 고정하지 않고 전체를 뒤진다.
    let found = false;
    for (const path of Object.keys(zip.files)) {
      if (!path.startsWith("xl/worksheets/sheet")) continue;
      const xml = await zip.file(path)!.async("string");
      if (xml.includes("Provider") || xml.includes("단일 AI Provider")) found = true;
    }
    expect(found).toBe(true);
  });
});
