import * as XLSX from "xlsx";
import { generateFileName } from "../lib/report/buildDataset";
import { aggregateByDifficulty, aggregateByFacilityType, aggregateByReportFormat, computeOverallSummary, type RunPair } from "./dashboard";
import { aggregateErrorsByCategory } from "./errorAnalysis";
import type { TestCase } from "./types";

/**
 * STEP 11 — 검증 결과 Excel 출력(스펙 45번). STEP10의 xlsx 라이브러리를 그대로 재사용한다.
 * Provider 비교/토큰·비용처럼 이 프로젝트가 실제로 제공하지 않는 정보는 빈 시트 대신
 * "미제공"이라고 명시한 행을 남긴다 — 있는 것처럼 꾸미지 않는다.
 */
export function buildValidationExcelBuffer(allTestCases: TestCase[], pairs: RunPair[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const runByTestCase = new Map(pairs.map((p) => [p.testCase.id, p.run]));

  // 1. Summary
  const summary = computeOverallSummary(pairs, allTestCases.length);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { 항목: "총 테스트", 값: summary.totalTestCases },
      { 항목: "완료", 값: summary.completed },
      { 항목: "GOOD", 값: summary.good },
      { 항목: "WARNING", 값: summary.warning },
      { 항목: "FAIL", 값: summary.fail },
      { 항목: "전체 Damage F1", 값: `${(summary.overallDamageF1 * 100).toFixed(1)}%` },
      { 항목: "위치 정확도", 값: `${(summary.overallLocationAccuracy * 100).toFixed(1)}%` },
      { 항목: "사진 추출 F1", 값: `${(summary.overallPhotoExtractionF1 * 100).toFixed(1)}%` },
      { 항목: "사진 연결 F1", 값: `${(summary.overallPhotoLinkF1 * 100).toFixed(1)}%` },
    ]),
    "Summary"
  );

  // 2. Test Cases
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      allTestCases.map((tc) => {
        const run = runByTestCase.get(tc.id);
        return {
          ID: tc.id,
          보고서명: tc.reportName,
          시설물: tc.facilityType,
          "회사/양식": tc.vendorType || tc.reportFormat,
          난이도: tc.difficulty,
          "Ground Truth": tc.groundTruth ? (tc.groundTruth.locked ? "확정" : "작성중") : "미작성",
          분석상태: tc.status,
          "종합 F1": run ? `${(run.metrics.overallF1 * 100).toFixed(1)}%` : "N/A",
          결과: run ? run.metrics.status : "N/A",
        };
      })
    ),
    "Test Cases"
  );

  // 3. Damage Metrics
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      pairs.map(({ testCase, run }) => ({
        ID: testCase.id,
        TP: run.metrics.damageDetection.tp,
        FP: run.metrics.damageDetection.fp,
        FN: run.metrics.damageDetection.fn,
        Precision: `${(run.metrics.damageDetection.precision * 100).toFixed(1)}%`,
        Recall: `${(run.metrics.damageDetection.recall * 100).toFixed(1)}%`,
        F1: `${(run.metrics.damageDetection.f1 * 100).toFixed(1)}%`,
      }))
    ),
    "Damage Metrics"
  );

  // 4. Field Metrics
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      pairs.flatMap(({ testCase, run }) =>
        run.metrics.fieldAccuracy.map((f) => ({ ID: testCase.id, 필드: f.field, 일치: f.matched, 전체: f.total, 정확도: f.total > 0 ? `${((f.matchRate) * 100).toFixed(1)}%` : "N/A" }))
      )
    ),
    "Field Metrics"
  );

  // 5. Photo Metrics
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      pairs.map(({ testCase, run }) => ({
        ID: testCase.id,
        "사진추출 Precision": `${(run.metrics.photoExtraction.precision * 100).toFixed(1)}%`,
        "사진추출 Recall": `${(run.metrics.photoExtraction.recall * 100).toFixed(1)}%`,
        "사진연결 Precision": `${(run.metrics.photoLink.precision * 100).toFixed(1)}%`,
        "사진연결 Recall": `${(run.metrics.photoLink.recall * 100).toFixed(1)}%`,
        "사진연결 F1": `${(run.metrics.photoLink.f1 * 100).toFixed(1)}%`,
      }))
    ),
    "Photo Metrics"
  );

  // 6. Cross Validation
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      pairs.map(({ testCase, run }) => ({
        ID: testCase.id,
        Matched: run.metrics.crossValidation.matched,
        Conflict: run.metrics.crossValidation.conflict,
        Candidate: run.metrics.crossValidation.candidate,
        정확도: run.metrics.crossValidation.accuracy != null ? `${(run.metrics.crossValidation.accuracy * 100).toFixed(1)}%` : "N/A (GT 기대값 미지정)",
      }))
    ),
    "Cross Validation"
  );

  // 7. Error Analysis
  const allErrors = pairs.flatMap((p) => p.run.errors);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      allErrors.map((e) => ({
        ID: e.testCaseId,
        단계: e.step,
        필드: e.field ?? "-",
        유형: e.category,
        "Ground Truth": e.groundTruthValue ?? "-",
        AI: e.aiValue ?? "-",
        "GT 출처": e.groundTruthSource ?? "-",
        "AI 출처": e.aiSource ?? "-",
      }))
    ),
    "Error Analysis"
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(aggregateErrorsByCategory(allErrors).map((a) => ({ 유형: a.category, 건수: a.count }))), "Error Summary");

  // 8. Provider Comparison / 9. Processing Time / 10. Token-Cost — 이 프로젝트는 단일 Provider(Claude)만
  // 사용하므로 비교 대상이 없다. 없는 데이터를 꾸며내지 않고 명시적으로 "N/A"로 남긴다.
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ 안내: "이 배포에서는 단일 AI Provider(Claude)만 사용하므로 Provider 간 비교 데이터가 없습니다." }]),
    "Provider Comparison"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(pairs.map(({ testCase, run }) => ({ ID: testCase.id, "처리시간(ms)": run.processingTimeMs ?? "미제공" }))),
    "Processing Time"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      pairs.map(({ testCase, run }) => ({
        ID: testCase.id,
        입력토큰: run.tokenUsage.inputTokens ?? "미제공",
        출력토큰: run.tokenUsage.outputTokens ?? "미제공",
        총토큰: run.tokenUsage.totalTokens ?? "미제공",
        추정비용: run.tokenUsage.estimatedCost,
      }))
    ),
    "Token-Cost"
  );

  // 11. Ground Truth Changes
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      allTestCases.flatMap((tc) => (tc.groundTruth?.revisions ?? []).map((r) => ({ ID: tc.id, 시각: r.at, 내용: r.note })))
    ),
    "Ground Truth Changes"
  );

  // 시설물/양식/난이도별 집계
  const addGroupSheet = (name: string, groups: ReturnType<typeof aggregateByFacilityType>) => {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(groups.map((g) => ({ 구분: g.key, 테스트수: g.testCount, F1: `${(g.avgF1 * 100).toFixed(1)}%`, 위치정확도: `${(g.avgLocationAccuracy * 100).toFixed(1)}%` }))),
      name
    );
  };
  addGroupSheet("시설물별", aggregateByFacilityType(pairs));
  addGroupSheet("양식별", aggregateByReportFormat(pairs));
  addGroupSheet("난이도별", aggregateByDifficulty(pairs));

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export function validationExcelFileName(date?: Date): string {
  return generateFileName("정확도검증", "결과", "xlsx", date);
}
