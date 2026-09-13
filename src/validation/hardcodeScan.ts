/**
 * STEP 11 — 실제 분석 로직(src/lib/**)에 특정 보고서/회사/페이지 번호가 하드코딩되어
 * 있지 않은지 정적으로 검사한다(스펙 52번). 테스트 fixture(샘플 데이터)는 예외로 둔다 —
 * 운영 분석 로직과 테스트 fixture를 구분한다.
 */

export interface HardcodeFinding {
  file: string;
  line: number;
  snippet: string;
  reason: string;
}

// 특정 보고서의 데이터가 아니라 이 시스템 자체가 부여하는 내부 상태/기본값 문자열이다
// (예: STEP5가 위치 불일치를 표시할 때 쓰는 "검토필요"). 이런 값과의 비교는 하드코딩이 아니다.
const INTERNAL_SENTINEL_LITERALS = ["검토필요", "그룹 합계에 포함", "기타", "-", ""];

const SUSPICIOUS_PATTERNS: { re: RegExp; reason: string; literalGroup: number }[] = [
  { re: /\b(page|pageNum|pageNo|pageIndex)\s*===?\s*\d+/i, reason: "특정 페이지 번호를 코드에서 직접 비교", literalGroup: 0 },
  { re: /\b(reportName|facilityName|companyName|vendorName|vendorType)\s*===?\s*["']([^"']+)["']/, reason: "특정 보고서/회사/시설명을 하드코딩 비교", literalGroup: 2 },
  { re: /\b(damageName|subPart|location|section)\s*===?\s*["']([^"']{2,})["']/, reason: "특정 손상명/위치/구간 값을 리터럴로 직접 비교", literalGroup: 2 },
];

/** 운영 분석 로직이 아닌 테스트 fixture/샘플 데이터 파일은 검사 대상에서 제외한다. */
export function isExcludedFromHardcodeScan(filePath: string): boolean {
  return filePath.endsWith(".test.ts") || filePath.endsWith("sampleData.ts") || filePath.endsWith("photoSampleData.ts") || filePath.includes("/validation/");
}

export function scanFileForHardcoding(filePath: string, content: string): HardcodeFinding[] {
  if (isExcludedFromHardcodeScan(filePath)) return [];
  const findings: HardcodeFinding[] = [];
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    for (const { re, reason, literalGroup } of SUSPICIOUS_PATTERNS) {
      const match = line.match(re);
      if (!match) continue;
      const literal = literalGroup > 0 ? match[literalGroup] : null;
      if (literal != null && INTERNAL_SENTINEL_LITERALS.includes(literal)) continue;
      findings.push({ file: filePath, line: idx + 1, snippet: line.trim(), reason });
    }
  });
  return findings;
}

export function scanFiles(files: { path: string; content: string }[]): HardcodeFinding[] {
  return files.flatMap((f) => scanFileForHardcoding(f.path, f.content));
}
