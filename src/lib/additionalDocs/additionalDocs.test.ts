import { describe, expect, it } from "vitest";
import { classifySourceType } from "./classify";
import { candidateFromChunk, extractCandidatesFromText } from "./textCandidate";
import { extractCandidatesFromTableRows } from "./tableCandidate";

describe("classifySourceType", () => {
  it("classifies by filename keyword with high confidence when content agrees", () => {
    const r = classifySourceType("전차 외관조사망도.pdf", "외관조사망도 범례 손상 표시");
    expect(r.sourceType).toBe("외관조사망도");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("classifies 보수보강현황.xlsx as 보수보강표", () => {
    expect(classifySourceType("보수보강현황.xlsx", "").sourceType).toBe("보수보강표");
  });

  it("falls back to 기타 with low confidence when nothing matches, without erroring", () => {
    const r = classifySourceType("검토자료.docx", "일반적인 검토 의견");
    expect(r.sourceType).toBe("기타");
    expect(r.confidence).toBeLessThan(0.5);
  });
});

describe("candidateFromChunk / extractCandidatesFromText", () => {
  const base = { fileName: "외관조사망도.pdf", sourceType: "외관조사망도" as const, page: 15 };

  it("builds a candidate only when at least one real signal is present", () => {
    expect(candidateFromChunk("전경사진", null, base)).toBeNull();
    const c = candidateFromChunk("소단측구 균열 165m", "165m", base);
    expect(c?.damageName).toBe("균열");
    expect(c?.subPart).toBe("소단측구");
    expect(c?.location).toBe("165m");
  });

  it("splits a page of text into multiple candidates anchored on each location", () => {
    const text = "소단측구 균열 165m 그리고 도수로 균열 208m 발견";
    const candidates = extractCandidatesFromText(text, base);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.some((c) => c.location === "165m")).toBe(true);
    expect(candidates.some((c) => c.location === "208m")).toBe(true);
  });

  it("does not fabricate a candidate from text with no damage-related signal", () => {
    expect(extractCandidatesFromText("표지 페이지입니다", base)).toHaveLength(0);
  });
});

describe("extractCandidatesFromTableRows", () => {
  const base = { fileName: "보수보강표.xlsx", sourceType: "보수보강표" as const, sheet: "1구간" };

  it("recognizes a header row and maps columns by keyword", () => {
    const rows = [
      ["구간", "부위", "세부부위", "손상명", "위치", "보수공법"],
      ["1구간", "배수시설", "소단측구", "균열", "165m", "주입보수"],
    ];
    const candidates = extractCandidatesFromTableRows(rows, base);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ section: "1구간", part: "배수시설", subPart: "소단측구", damageName: "균열", location: "165m", repairMethod: "주입보수" });
  });

  it("falls back to per-row keyword scanning when no header is recognized", () => {
    const rows = [["소단측구 균열 165m 확인"], ["표지"]];
    const candidates = extractCandidatesFromTableRows(rows, base);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].location).toBe("165m");
  });

  it("returns nothing for an empty sheet without throwing", () => {
    expect(extractCandidatesFromTableRows([], base)).toEqual([]);
  });
});
