import { describe, expect, it } from "vitest";
import { approveCandidateDamage, resolveCrossValidationConflict, runCrossValidation } from "./crossValidate";
import type { AdditionalDocument, AdditionalEvidenceCandidate, DamageRecord } from "../types";

function damage(overrides: Partial<DamageRecord>): DamageRecord {
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
    status: "review",
    sourcePages: [80],
    sourceReferences: [{ page: 80, type: "table" }],
    ...overrides,
  };
}

function candidate(overrides: Partial<AdditionalEvidenceCandidate>): AdditionalEvidenceCandidate {
  return {
    section: "1구간",
    damageName: "균열",
    part: "배수시설",
    subPart: "소단측구",
    location: "165m",
    repairMethod: "주입보수",
    quantity: null,
    photoNo: null,
    sourceRef: { fileName: "보수보강표.xlsx", sourceType: "보수보강표", sheet: "1구간", cell: "D15" },
    ...overrides,
  };
}

function doc(overrides: Partial<AdditionalDocument>): AdditionalDocument {
  return {
    id: "AD001",
    fileName: "보수보강표.xlsx",
    fileType: "xlsx",
    sourceType: "보수보강표",
    sourceTypeConfidence: 0.9,
    status: "ok",
    candidates: [],
    duplicateOfIds: [],
    ...overrides,
  };
}

describe("runCrossValidation — STEP 8", () => {
  it("TEST1: no additional documents -> nothing forced, damage stays untouched by cross validation logic", () => {
    const d = damage({});
    const { damages, candidateDamages } = runCrossValidation([d], []);
    // 문서가 없으면 각 damage의 crossValidation은 "확인 대상 없음" 계열로 안전하게 처리된다.
    expect(damages[0].crossValidation?.result).toBe("unsupported");
    expect(candidateDamages).toHaveLength(0);
  });

  it("TEST6: matching evidence in an additional document -> matched", () => {
    const d = damage({});
    const document = doc({ candidates: [candidate({})] });
    const { damages } = runCrossValidation([d], [document]);
    expect(damages[0].crossValidation?.result).toBe("matched");
    expect(damages[0].crossValidation?.evidenceCount).toBe(1);
    expect(damages[0].crossValidation?.evidence[0].sourceType).toBe("보수보강표");
  });

  it("TEST7: location 211m (main) vs 208m (additional) -> conflict, not auto-corrected", () => {
    const d = damage({ subPart: "산마루측구", location: "211m" });
    const document = doc({
      fileName: "외관조사망도.pdf",
      sourceType: "외관조사망도",
      candidates: [candidate({ subPart: "산마루측구", location: "208m", sourceRef: { fileName: "외관조사망도.pdf", sourceType: "외관조사망도", page: 15 } })],
    });
    const { damages } = runCrossValidation([d], [document]);
    const cv = damages[0].crossValidation!;
    expect(cv.result).toBe("conflict");
    expect(cv.reviewRequired).toBe(true);
    const conflict = cv.conflicts.find((c) => c.field === "location")!;
    expect(conflict.mainReport.value).toBe("211m");
    expect(conflict.additional.value).toBe("208m");
    // 자동으로 어느 쪽 값도 덮어쓰지 않는다.
    expect(damages[0].location).toBe("211m");
  });

  it("TEST8: a damage found only in additional data becomes a review candidate, not auto-added", () => {
    const d = damage({ location: "165m", subPart: "소단측구" });
    const document = doc({
      fileName: "외관조사망도.pdf",
      sourceType: "외관조사망도",
      candidates: [
        candidate({ subPart: "산마루측구", location: "300m", sourceRef: { fileName: "외관조사망도.pdf", sourceType: "외관조사망도", page: 15 } }),
      ],
    });
    const { damages, candidateDamages } = runCrossValidation([d], [document]);
    expect(damages).toHaveLength(1); // 기존 damage 목록에 즉시 추가되지 않음
    expect(candidateDamages).toHaveLength(1);
    expect(candidateDamages[0].location).toBe("300m");
    expect(candidateDamages[0].status).toBe("review");
  });

  it("TEST9: a damage with no supporting additional evidence is not treated as 'does not exist'", () => {
    const d = damage({ location: "999m", subPart: "옹벽" });
    const document = doc({ candidates: [candidate({})] }); // 전혀 무관한 근거만 있는 문서
    const { damages } = runCrossValidation([d], [document]);
    expect(damages[0].crossValidation?.result).toBe("missingInAdditional");
    expect(damages[0].status).toBe("review"); // damage 자체는 그대로 유지, 삭제되지 않음
  });

  it("TEST10: repair method differs -> repairMethod conflict, not escalated to a location conflict", () => {
    const d = damage({ repairMethod: "주입보수" });
    const document = doc({ candidates: [candidate({ repairMethod: "실런트 주입" })] });
    const { damages } = runCrossValidation([d], [document]);
    const cv = damages[0].crossValidation!;
    expect(cv.conflicts.some((c) => c.field === "repairMethod")).toBe(true);
  });

  it("TEST11: a shared group quantity is not treated as an individual-location duplicate", () => {
    const d = damage({ quantity: null, quantityGroup: "23.3m" });
    const document = doc({ candidates: [candidate({ quantity: "23.3m" })] });
    const { damages } = runCrossValidation([d], [document]);
    // quantityMatch 근거가 반영되되, damage의 quantity 필드 자체가 임의로 채워지지 않는다.
    expect(damages[0].quantity).toBeNull();
    expect(damages[0].crossValidation?.evidence[0]?.reasons.join(",")).toContain("수량");
  });

  it("TEST12: one document fails to parse, the rest still validate normally", () => {
    const d = damage({});
    const goodDoc = doc({ id: "AD001", candidates: [candidate({})] });
    const failedDoc = doc({ id: "AD002", fileName: "손상.docx", fileType: "docx", status: "failed", error: "파싱 실패", candidates: [] });
    const { damages } = runCrossValidation([d], [goodDoc, failedDoc]);
    expect(damages[0].crossValidation?.result).toBe("matched");
  });

  it("TEST5 (multi-format smoke): pdf+excel+word-shaped documents all contribute evidence", () => {
    const d = damage({});
    const pdfDoc = doc({ id: "AD001", fileName: "외관조사망도.pdf", fileType: "pdf", sourceType: "외관조사망도", candidates: [candidate({ sourceRef: { fileName: "외관조사망도.pdf", sourceType: "외관조사망도", page: 15 } })] });
    const excelDoc = doc({ id: "AD002", fileName: "보수보강표.xlsx", fileType: "xlsx", sourceType: "보수보강표", candidates: [candidate({})] });
    const wordDoc = doc({ id: "AD003", fileName: "검토자료.docx", fileType: "docx", sourceType: "기타", candidates: [candidate({ sourceRef: { fileName: "검토자료.docx", sourceType: "기타", paragraph: 4 } })] });
    const { damages } = runCrossValidation([d], [pdfDoc, excelDoc, wordDoc]);
    expect(damages[0].crossValidation?.evidenceCount).toBe(3);
  });
});

describe("resolveCrossValidationConflict / approveCandidateDamage — 수동 결정", () => {
  it("TEST13: a manually resolved conflict survives re-running cross validation", () => {
    const d = damage({ subPart: "산마루측구", location: "211m" });
    const document = doc({
      fileName: "외관조사망도.pdf",
      sourceType: "외관조사망도",
      candidates: [candidate({ subPart: "산마루측구", location: "208m", sourceRef: { fileName: "외관조사망도.pdf", sourceType: "외관조사망도", page: 15 } })],
    });
    let { damages } = runCrossValidation([d], [document]);
    expect(damages[0].crossValidation?.reviewRequired).toBe(true);

    // 사용자가 "기본 보고서 값(211m)이 맞다"고 직접 확인하고 불일치를 해소한 경우.
    damages = resolveCrossValidationConflict(damages, "③-01", "location", "211m", "현장 확인 결과 본문이 맞음");
    expect(damages[0].location).toBe("211m");
    expect(damages[0].crossValidation?.reviewRequired).toBe(false);

    // 추가자료(208m)는 그대로이므로 재실행하면 불일치 자체는 다시 감지되지만,
    // 사용자의 해결 결정(resolved)은 보존되어 다시 검토 대상으로 올라오지 않는다.
    const rerun = runCrossValidation(damages, [document]);
    const conflict = rerun.damages[0].crossValidation?.conflicts.find((c) => c.field === "location");
    expect(conflict?.resolved?.value).toBe("211m");
    expect(rerun.damages[0].crossValidation?.reviewRequired).toBe(false);
  });

  it("approving a candidate damage adds it to damages without deleting the candidate list entry twice", () => {
    const d = damage({ location: "165m", subPart: "소단측구" });
    const document = doc({ candidates: [candidate({ subPart: "산마루측구", location: "300m" })] });
    const { damages, candidateDamages } = runCrossValidation([d], [document]);
    const approved = approveCandidateDamage(damages, candidateDamages, candidateDamages[0].id);
    expect(approved.damages).toHaveLength(2);
    expect(approved.candidateDamages).toHaveLength(0);
    expect(approved.damages[1].location).toBe("300m");
    expect(approved.damages[1].status).toBe("review");
  });
});
