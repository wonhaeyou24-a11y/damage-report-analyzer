import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { scanFileForHardcoding, scanFiles } from "./hardcodeScan";

describe("scanFileForHardcoding", () => {
  it("flags a hardcoded page-number check (spec section 52 example)", () => {
    const findings = scanFileForHardcoding("src/lib/fake.ts", 'if (page === 80) { doThing(); }');
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toContain("페이지");
  });

  it("flags a hardcoded report/company name check", () => {
    const findings = scanFileForHardcoding("src/lib/fake.ts", 'if (reportName === "특정회사보고서") { skip(); }');
    expect(findings.length).toBeGreaterThan(0);
  });

  it("flags a hardcoded damage-name literal comparison", () => {
    const findings = scanFileForHardcoding("src/lib/fake.ts", 'if (damageName === "소단측구 균열") { return true; }');
    expect(findings.length).toBeGreaterThan(0);
  });

  it("does not flag ordinary variable-to-variable comparisons used throughout the real pipeline", () => {
    const findings = scanFileForHardcoding("src/lib/fake.ts", "if (a.damageName === b.damageName) { merge(); }");
    expect(findings).toHaveLength(0);
  });

  it("skips test files and documented sample-data fixtures entirely", () => {
    expect(scanFileForHardcoding("src/lib/foo.test.ts", 'if (page === 80) {}')).toHaveLength(0);
    expect(scanFileForHardcoding("src/lib/sampleData.ts", 'if (page === 80) {}')).toHaveLength(0);
  });
});

function collectSourceFiles(dir: string): { path: string; content: string }[] {
  const results: { path: string; content: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      results.push({ path: full.replace(/\\/g, "/"), content: readFileSync(full, "utf-8") });
    }
  }
  return results;
}

describe("real pipeline scan — src/lib must not contain report-specific hardcoding (spec section 52)", () => {
  it("finds zero suspicious hardcoding in the actual analysis pipeline", () => {
    const files = collectSourceFiles(join(process.cwd(), "src", "lib"));
    const findings = scanFiles(files);
    if (findings.length > 0) {
      // 실패 시 무엇이 걸렸는지 바로 보이도록 상세를 출력한다 — 조용히 숨기지 않는다(스펙 9번).
      console.error("Hardcoding findings:", JSON.stringify(findings, null, 2));
    }
    expect(findings).toEqual([]);
  });
});
