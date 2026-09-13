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

describe("STEP 8 확장 — 기존 손상 보완(enrichment)", () => {
  it("TEST-ENRICH-02: 기존 규모 없음(개별/그룹 합계 모두 null) + 추가자료 규모 존재 -> quantity enrichment", () => {
    const d = damage({ quantity: null, quantityGroup: null });
    const document = doc({ candidates: [candidate({ quantity: "2.3m" })] });
    const { damages } = runCrossValidation([d], [document]);
    expect(damages[0].quantity).toBe("2.3m");
    const cv = damages[0].crossValidation!;
    expect(cv.enrichments?.some((e) => e.field === "quantity" && e.value === "2.3m")).toBe(true);
    expect(cv.fieldValidation?.quantity).toBe("enriched");
  });

  it("TEST-ENRICH-03: 기존 보수방안 없음 + 추가자료 보수방안 존재 -> repairMethod enrichment", () => {
    const d = damage({ repairMethod: "" });
    const document = doc({ candidates: [candidate({ repairMethod: "실런트 주입" })] });
    const { damages } = runCrossValidation([d], [document]);
    expect(damages[0].repairMethod).toBe("실런트 주입");
    const cv = damages[0].crossValidation!;
    expect(cv.enrichments?.some((e) => e.field === "repairMethod" && e.value === "실런트 주입")).toBe(true);
    expect(cv.fieldValidation?.repairMethod).toBe("enriched");
  });

  it("TEST-ENRICH-04: 기존 세부부위 없음 + 추가자료 세부부위 존재(위치 일치가 근거) -> subPart enrichment", () => {
    const d = damage({ subPart: "-" });
    const document = doc({ candidates: [candidate({ subPart: "소단측구", location: "165m" })] });
    const { damages } = runCrossValidation([d], [document]);
    expect(damages[0].subPart).toBe("소단측구");
    const cv = damages[0].crossValidation!;
    expect(cv.enrichments?.some((e) => e.field === "subPart" && e.value === "소단측구")).toBe(true);
    expect(cv.fieldValidation?.subPart).toBe("enriched");
  });

  it("TEST-ENRICH-05: 기존 위치와 추가자료 위치 동일 -> location confirmation (필드 값은 그대로)", () => {
    const d = damage({ location: "165m" });
    const document = doc({ candidates: [candidate({ location: "165m" })] });
    const { damages } = runCrossValidation([d], [document]);
    expect(damages[0].location).toBe("165m");
    expect(damages[0].crossValidation?.fieldValidation?.location).toBe("matched");
  });

  it("TEST-ENRICH-06: 기존 위치 165m + 추가자료 위치 170m -> location conflict, 자동 변경 없음", () => {
    const d = damage({ location: "165m" });
    const document = doc({ candidates: [candidate({ location: "170m" })] });
    const { damages } = runCrossValidation([d], [document]);
    const cv = damages[0].crossValidation!;
    expect(cv.conflicts.some((c) => c.field === "location")).toBe(true);
    expect(cv.fieldValidation?.location).toBe("conflict");
    expect(damages[0].location).toBe("165m");
  });

  it("TEST-ENRICH-07: 기존 규모 2.0m + 추가자료 규모 2.3m -> quantity conflict, 자동 변경 없음", () => {
    const d = damage({ quantity: "2.0m", quantityGroup: null });
    const document = doc({ candidates: [candidate({ quantity: "2.3m" })] });
    const { damages } = runCrossValidation([d], [document]);
    const cv = damages[0].crossValidation!;
    expect(cv.conflicts.some((c) => c.field === "quantity")).toBe(true);
    expect(damages[0].quantity).toBe("2.0m");
  });

  it("TEST-ENRICH-08: 보수방안이 다르면 repairMethod conflict만 발생하고 location 등 다른 필드는 영향받지 않음", () => {
    const d = damage({ repairMethod: "주의관찰" });
    const document = doc({ candidates: [candidate({ repairMethod: "실런트 주입" })] });
    const { damages } = runCrossValidation([d], [document]);
    const cv = damages[0].crossValidation!;
    expect(cv.conflicts.every((c) => c.field === "repairMethod")).toBe(true);
    expect(cv.fieldValidation?.location).toBe("matched"); // 위치는 여전히 일치로 확인됨
  });

  it("TEST-ENRICH-11: 서로 다른 추가자료 2종(외관조사망도 + 수량표)이 동일 손상을 확인하면 independent evidence 2개", () => {
    const d = damage({});
    const map = doc({ id: "AD001", fileName: "외관조사망도.pdf", sourceType: "외관조사망도", candidates: [candidate({})] });
    const qty = doc({ id: "AD002", fileName: "수량표.xlsx", sourceType: "수량표", candidates: [candidate({})] });
    const { damages } = runCrossValidation([d], [map, qty]);
    expect(damages[0].crossValidation?.evidenceCount).toBe(2);
  });

  it("TEST-ENRICH-12: 같은 파일 안에서 동일 내용이 여러 후보(페이지/행)로 반복돼도 evidence는 1개로 계산", () => {
    const d = damage({});
    const document = doc({
      candidates: [
        candidate({ sourceRef: { fileName: "보수보강표.xlsx", sourceType: "보수보강표", sheet: "1구간", cell: "D15" } }),
        candidate({ sourceRef: { fileName: "보수보강표.xlsx", sourceType: "보수보강표", sheet: "1구간", cell: "D28" } }), // 같은 내용, 다른 행
      ],
    });
    const { damages } = runCrossValidation([d], [document]);
    expect(damages[0].crossValidation?.evidenceCount).toBe(1);
  });

  it("TEST-ENRICH-13: 사용자가 fieldOverrides로 이미 손댄 필드는 값이 비어 있어도 enrichment가 채우지 않음", () => {
    const d = damage({
      repairMethod: "",
      fieldOverrides: [{ field: "repairMethod", originalValue: "", currentValue: "", manualOverride: true, changedAt: new Date().toISOString() }],
    });
    const document = doc({ candidates: [candidate({ repairMethod: "실런트 주입" })] });
    const { damages } = runCrossValidation([d], [document]);
    expect(damages[0].repairMethod).toBe(""); // 추가자료 값으로 채워지지 않음
    expect(damages[0].crossValidation?.enrichments?.some((e) => e.field === "repairMethod")).toBe(false);
  });

  it("TEST-ENRICH-16: enrichments/fieldValidation이 없는 레거시 crossValidation도 재실행 시 정상 동작", () => {
    const legacyCv = {
      enabled: true,
      result: "matched" as const,
      confidence: 0.75,
      evidenceCount: 1,
      evidence: [],
      conflicts: [],
      reviewRequired: false,
      // enrichments/fieldValidation 필드가 아예 없는 예전 저장 데이터를 흉내낸다.
    };
    const d = damage({ crossValidation: legacyCv });
    const document = doc({ candidates: [candidate({})] });
    expect(() => runCrossValidation([d], [document])).not.toThrow();
    const { damages } = runCrossValidation([d], [document]);
    expect(damages[0].crossValidation?.enrichments).toEqual([]);
  });

  it("TEST-ENRICH-17: 근거가 될 문서가 추가될수록(또는 필드가 보완될수록) 신뢰도가 올라간다", () => {
    const d1 = damage({ quantity: null, quantityGroup: null });
    const noEnrich = runCrossValidation([d1], [doc({ candidates: [candidate({ quantity: null })] })]);
    const d2 = damage({ quantity: null, quantityGroup: null });
    const withEnrich = runCrossValidation([d2], [doc({ candidates: [candidate({ quantity: "2.3m" })] })]);
    expect(withEnrich.damages[0].crossValidation!.confidence).toBeGreaterThan(noEnrich.damages[0].crossValidation!.confidence);
  });

  it("TEST-ENRICH-18: 미해결 충돌이 있으면 근거 문서가 여러 개라도 신뢰도가 임의로 올라가지 않는다", () => {
    const d = damage({ location: "165m" });
    const docs = [
      doc({ id: "AD001", fileName: "a.pdf", candidates: [candidate({ location: "170m" })] }),
      doc({ id: "AD002", fileName: "b.xlsx", candidates: [candidate({ location: "170m" })] }),
      doc({ id: "AD003", fileName: "c.docx", candidates: [candidate({ location: "170m" })] }),
    ];
    const { damages } = runCrossValidation([d], docs);
    expect(damages[0].crossValidation?.confidence).toBe(0.4);
  });

  it("TEST-ENRICH-19: 그룹 합계 물량이 추가자료에서도 확인되면 groupQuantityConfirmed=true이지만 개별 quantity는 복제되지 않는다", () => {
    const d = damage({ quantity: null, quantityGroup: "23.3m" });
    const document = doc({ candidates: [candidate({ quantity: "23.3m" })] });
    const { damages } = runCrossValidation([d], [document]);
    expect(damages[0].quantity).toBeNull();
    expect(damages[0].crossValidation?.groupQuantityConfirmed).toBe(true);
    expect(damages[0].crossValidation?.fieldValidation?.quantity).toBe("matched");
  });

  it("TEST-ENRICH-21: STEP8 교차검증이 STEP7에서 연결된 사진 정보를 건드리지 않는다", () => {
    const d = damage({
      photos: [{ dataUrl: "data:img", boundingBox: null } as any],
      photoIds: ["P001"],
      photoMatchStatus: "confirmed",
    });
    const document = doc({ candidates: [candidate({})] });
    const { damages } = runCrossValidation([d], [document]);
    expect(damages[0].photoIds).toEqual(["P001"]);
    expect(damages[0].photoMatchStatus).toBe("confirmed");
    expect(damages[0].photos).toHaveLength(1);
  });
});
