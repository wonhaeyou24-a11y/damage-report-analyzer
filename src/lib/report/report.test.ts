import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  buildCrossValidationRows,
  buildDamageRows,
  buildFinalDataset,
  buildPhotoRows,
  buildReviewHistoryRows,
  buildSourceRows,
  generateFileName,
  validateForExport,
} from "./buildDataset";
import { buildExcelWorkbookBuffer } from "./exportExcel";
import { buildWordDocumentBuffer } from "./exportWord";
import { buildPdfArrayBuffer } from "./exportPdf";
import { buildHistoryEntry } from "./exportHistory";
import type { CandidateDamage, DamageRecord, ExportOptions, ExtractedPhoto, ReviewSession } from "../../types";
import { createDefaultExportOptions, createReviewSession } from "../../types";

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
    quantityGroup: "그룹 합계 23.3m에 포함",
    photos: [],
    status: "confirmed",
    sourcePages: [80],
    sourceReferences: [{ page: 80, type: "table", excerpt: "소단측구 균열 165m" }],
    photoIds: [],
    ...overrides,
  };
}

function photo(overrides: Partial<ExtractedPhoto>): ExtractedPhoto {
  return {
    id: "P001",
    sourceFile: "report.pdf",
    page: 120,
    photoNo: "③-01",
    caption: "소단측구 균열 165m",
    section: "1구간",
    part: "배수시설",
    subPart: "소단측구",
    location: "165m",
    damageName: "균열",
    image: {
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      width: 1,
      height: 1,
    },
    damageRelated: true,
    nearbyText: "③-01 소단측구 균열 165m",
    ocrText: null,
    ocrConfidence: null,
    visionInference: null,
    sourceRef: { page: 120 },
    duplicateCandidate: false,
    duplicateOfIds: [],
    matchCandidates: [],
    linkedDamageIds: [],
    status: "confirmed",
    extractionStatus: "ok",
    matchStatus: "confirmed",
    confidence: 0.96,
    matchSource: "auto",
    ...overrides,
  };
}

function finalizedSession(): ReviewSession {
  return { ...createReviewSession(), reportName: "테스트 비탈면 보고서", finalReviewStatus: "finalized", finalizedAt: new Date().toISOString(), reviewVersion: 1 };
}

describe("TEST9/TEST15/TEST7/TEST8: row builders reuse the STEP9 final dataset correctly", () => {
  it("TEST9: group quantity is shown once via quantityGroup label, not duplicated per row", () => {
    const locs = ["165m", "187m", "188m"].map((loc) => damage({ location: loc, id: `③-${loc}` }));
    const rows = buildDamageRows(locs);
    for (const r of rows) {
      expect(r.quantityDisplay).toBe("그룹 합계 23.3m에 포함");
    }
  });

  it("TEST15: individually-split locations stay separate rows", () => {
    const locs = ["165m", "187m", "188m", "190m", "217m", "261m", "267m", "275m"];
    const rows = buildDamageRows(locs.map((loc, i) => damage({ id: `③-${i + 1}`, location: loc })));
    expect(rows).toHaveLength(8);
  });

  it("TEST7/TEST10: linked photo appears in the photo rows with damage No, unlinked appears separately", () => {
    const d = damage({ photoIds: ["P001"] });
    const linkedPhoto = photo({ id: "P001" });
    const unlinkedPhoto = photo({ id: "P002", matchStatus: "unmatched", linkedDamageIds: [] });
    const rows = buildPhotoRows([d], [linkedPhoto, unlinkedPhoto], true);
    expect(rows.find((r) => r.photoNo === "③-01" && r.damageNo === "③-01")).toBeTruthy();
    expect(rows.find((r) => r.damageNo === "-")).toBeTruthy();
  });

  it("TEST11: a damage with no linked photo shows zero photo rows for it", () => {
    const d = damage({ photoIds: [] });
    const rows = buildPhotoRows([d], [], true);
    expect(rows).toHaveLength(0);
  });

  it("TEST12: excluding unlinked photos via option removes them from the export", () => {
    const d = damage({ photoIds: [] });
    const unlinkedPhoto = photo({ id: "P002", matchStatus: "unmatched" });
    expect(buildPhotoRows([d], [unlinkedPhoto], true)).toHaveLength(1);
    expect(buildPhotoRows([d], [unlinkedPhoto], false)).toHaveLength(0);
  });

  it("TEST13: one photo linked to two damages appears once per damage but is not duplicated in storage", () => {
    const d1 = damage({ id: "③-01", photoIds: ["P001"] });
    const d2 = damage({ id: "③-02", photoIds: ["P001"] });
    const p = photo({ id: "P001" });
    const rows = buildPhotoRows([d1, d2], [p], false);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.photoNo === "③-01")).toBe(true); // 같은 원본 사진(photoNo) 참조, 중복 저장 아님
  });
});

describe("TEST8: user-decided conflict value is what gets exported, with the full history kept", () => {
  it("exports the resolved value while cross-validation rows retain both original values", () => {
    const d = damage({
      subPart: "산마루측구",
      location: "211m",
      crossValidation: {
        enabled: true,
        result: "matched",
        confidence: 0.9,
        evidenceCount: 0,
        evidence: [],
        conflicts: [
          {
            field: "location",
            mainReport: { value: "211m", source: "본문", page: 81 },
            additional: { value: "208m", source: "외관조사망도.pdf", fileName: "외관조사망도.pdf", sourceType: "외관조사망도", page: 15 },
            resolved: { value: "211m", source: "manual", reason: "현장 확인", decidedAt: new Date().toISOString() },
          },
        ],
        reviewRequired: false,
      },
    });
    const rows = buildDamageRows([d]);
    expect(rows[0].location).toBe("211m"); // 최종 출력 값은 사용자 결정값
    const cvRows = buildCrossValidationRows([d]);
    const conflictRow = cvRows.find((r) => r.item === "location")!;
    expect(conflictRow.mainValue).toBe("211m");
    expect(conflictRow.additionalValue).toBe("208m");
    expect(conflictRow.decision).toContain("211m");
  });
});

describe("TEST14: selected-damage-only export scope", () => {
  it("buildFinalDataset narrows to the selected damage ids only", () => {
    const records = [damage({ id: "a" }), damage({ id: "b" }), damage({ id: "c" })];
    const options: ExportOptions = { ...createDefaultExportOptions(), scope: "selected", selectedDamageIds: ["a", "c"] };
    const { damages } = buildFinalDataset(records, [], options);
    expect(damages.map((d) => d.id).sort()).toEqual(["a", "c"]);
  });
});

describe("TEST15 (STEP8 not run): cross validation section renders as 'not performed', not an error", () => {
  it("a damage with no crossValidation produces zero cross-validation rows", () => {
    const d = damage({ crossValidation: undefined });
    expect(buildCrossValidationRows([d])).toHaveLength(0);
  });
});

describe("TEST4/TEST5/TEST6: export is blocked before finalization / with unresolved conflicts or candidates", () => {
  it("TEST4: blocks while review is still in_progress", () => {
    const session = createReviewSession();
    const result = validateForExport(session, [damage({ status: "confirmed" })], [], []);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("검수"))).toBe(true);
  });

  it("TEST5: blocks on an unresolved STEP5/STEP8 conflict even if the session is finalized", () => {
    const session = finalizedSession();
    const result = validateForExport(session, [damage({ status: "conflict" })], [], []);
    expect(result.ok).toBe(false);
  });

  it("TEST6: blocks on an undecided candidate damage", () => {
    const session = finalizedSession();
    const candidate = { id: "CAND-001" } as CandidateDamage;
    const result = validateForExport(session, [damage({ status: "confirmed" })], [], [candidate]);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("후보"))).toBe(true);
  });

  it("passes once everything is resolved and finalized", () => {
    const session = finalizedSession();
    const result = validateForExport(session, [damage({ status: "confirmed" })], [], []);
    expect(result.ok).toBe(true);
  });

  it("flags broken photo references as a data-structure error rather than crashing", () => {
    const session = finalizedSession();
    const d = damage({ status: "confirmed", photoIds: ["P999"] });
    const result = validateForExport(session, [d], [], []);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("존재하지 않는 사진"))).toBe(true);
  });
});

describe("TEST17: original data is never mutated by report generation", () => {
  it("buildDamageRows and buildExcelWorkbookBuffer do not mutate the input records/photos", () => {
    const records = [damage({})];
    const photos = [photo({})];
    const snapshot = JSON.stringify(records);
    const photoSnapshot = JSON.stringify(photos);
    buildDamageRows(records);
    buildExcelWorkbookBuffer(records, photos, createDefaultExportOptions());
    expect(JSON.stringify(records)).toBe(snapshot);
    expect(JSON.stringify(photos)).toBe(photoSnapshot);
  });
});

describe("filename generation strips illegal characters", () => {
  it("produces a clean, dated filename", () => {
    const name = generateFileName('비탈면/옹벽:보고서"*?', "최종손상목록", "xlsx", new Date(2026, 8, 13));
    expect(name).toBe("비탈면옹벽보고서_최종손상목록_20260913.xlsx");
  });
});

describe("TEST1: Excel export of finalized data", () => {
  it("produces a valid, non-empty .xlsx zip container with the expected sheets", async () => {
    const records = [damage({ photoIds: ["P001"] })];
    const photos = [photo({})];
    const buf = buildExcelWorkbookBuffer(records, photos, createDefaultExportOptions());
    expect(buf.byteLength).toBeGreaterThan(0);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file("xl/workbook.xml")).toBeTruthy();
    const sheetXmls = Object.keys(zip.files).filter((f) => f.startsWith("xl/worksheets/"));
    expect(sheetXmls.length).toBeGreaterThanOrEqual(5); // 손상목록/손상사진/교차검증/출처/검수이력
  });
});

describe("TEST2: Word export of finalized data", () => {
  it("produces a valid, non-empty .docx zip container", async () => {
    const records = [damage({ photoIds: ["P001"] })];
    const photos = [photo({})];
    const buf = await buildWordDocumentBuffer(finalizedSession(), records, photos, [], createDefaultExportOptions());
    expect(buf.byteLength).toBeGreaterThan(0);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file("word/document.xml")).toBeTruthy();
  });

  it("shows '추가자료 교차검증을 수행하지 않음' when STEP8 was skipped (TEST15/TEST28 wording)", async () => {
    const records = [damage({ crossValidation: undefined })];
    const buf = await buildWordDocumentBuffer(finalizedSession(), records, [], [], createDefaultExportOptions());
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("교차검증을 수행하지 않음");
  });
});

describe("TEST3: PDF export of finalized data", () => {
  it("produces a valid PDF byte stream", () => {
    const records = [damage({})];
    const buf = buildPdfArrayBuffer(finalizedSession(), records, [], [], createDefaultExportOptions());
    const bytes = new Uint8Array(buf);
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});

describe("TEST19 (regression smoke): source rows carry both main-report and cross-validation refs", () => {
  it("buildSourceRows keeps sourceRef fields intact", () => {
    const d = damage({
      crossValidation: {
        enabled: true,
        result: "matched",
        confidence: 0.9,
        evidenceCount: 1,
        evidence: [
          {
            sourceType: "보수보강표",
            fileName: "보수보강표.xlsx",
            result: "matched",
            sourceRef: { fileName: "보수보강표.xlsx", sourceType: "보수보강표", sheet: "1구간", cell: "D15" },
            reasons: [],
          },
        ],
        conflicts: [],
        reviewRequired: false,
      },
    });
    const rows = buildSourceRows([d]);
    expect(rows.some((r) => r.sheet === "1구간" && r.cell === "D15")).toBe(true);
    expect(rows.some((r) => r.field === "기본 보고서" && r.page === "80")).toBe(true);
  });
});

describe("history entries", () => {
  it("TEST18: builds a traceable export history record", () => {
    const entry = buildHistoryEntry("excel", finalizedSession(), ["③-01"], "test.xlsx", "success");
    expect(entry.type).toBe("excel");
    expect(entry.status).toBe("success");
    expect(entry.fileName).toBe("test.xlsx");
  });

  it("TEST16: a failed export is recorded without throwing", () => {
    const entry = buildHistoryEntry("pdf", finalizedSession(), [], "test.pdf", "failed", "이미지 디코딩 오류");
    expect(entry.status).toBe("failed");
    expect(entry.error).toContain("이미지");
  });
});

describe("buildReviewHistoryRows", () => {
  it("combines manual field edits and resolved conflicts chronologically", () => {
    const d = damage({
      fieldOverrides: [{ field: "location", originalValue: "208m", currentValue: "211m", manualOverride: true, changedAt: "2026-09-13T01:00:00.000Z" }],
      crossValidation: {
        enabled: true,
        result: "matched",
        confidence: 0.9,
        evidenceCount: 0,
        evidence: [],
        conflicts: [
          {
            field: "repairMethod",
            mainReport: { value: "주입보수", source: "본문" },
            additional: { value: "실런트 주입", source: "보수보강표.xlsx", fileName: "보수보강표.xlsx", sourceType: "보수보강표" },
            resolved: { value: "주입보수", source: "manual", decidedAt: "2026-09-13T02:00:00.000Z" },
          },
        ],
        reviewRequired: false,
      },
    });
    const rows = buildReviewHistoryRows([d]);
    expect(rows).toHaveLength(2);
    expect(rows[0].changeType).toBe("사용자 수정");
    expect(rows[1].changeType).toBe("충돌 해결");
  });
});
