import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAllReports, deleteReport, loadAllReports, migrateReport, saveReport, type AnalyzedReport } from "./reportStorage";
import { createReviewSession } from "../types";

function report(overrides: Partial<AnalyzedReport>): AnalyzedReport {
  return {
    id: "R001",
    sourceName: "test.pdf",
    createdAt: new Date().toISOString(),
    records: [],
    photos: [],
    documents: [],
    candidateDamages: [],
    session: createReviewSession(),
    exportHistory: [],
    analysisRuns: [],
    qualityEvents: [],
    ...overrides,
  };
}

describe("reportStorage (IndexedDB persistence)", () => {
  beforeEach(async () => {
    await clearAllReports();
  });

  it("returns an empty list when nothing has been saved yet", async () => {
    expect(await loadAllReports()).toEqual([]);
  });

  it("saves and loads a report back with its full data intact", async () => {
    const r = report({ id: "R001", sourceName: "언양~울산선.pdf", records: [{ id: "①-01" } as any] });
    await saveReport(r);
    const loaded = await loadAllReports();
    expect(loaded).toHaveLength(1);
    // analysisRuns/qualityEvents가 있으므로 migrateReport는 이 데이터를 legacy로 취급하지 않는다.
    expect(loaded[0]).toEqual({ ...r, legacy: false });
  });

  it("put overwrites the same id instead of duplicating it", async () => {
    await saveReport(report({ id: "R001", sourceName: "v1" }));
    await saveReport(report({ id: "R001", sourceName: "v2" }));
    const loaded = await loadAllReports();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].sourceName).toBe("v2");
  });

  it("stores multiple distinct reports independently", async () => {
    await saveReport(report({ id: "R001" }));
    await saveReport(report({ id: "R002" }));
    const loaded = await loadAllReports();
    expect(loaded.map((r) => r.id).sort()).toEqual(["R001", "R002"]);
  });

  it("deleteReport removes only the targeted report", async () => {
    await saveReport(report({ id: "R001" }));
    await saveReport(report({ id: "R002" }));
    await deleteReport("R001");
    const loaded = await loadAllReports();
    expect(loaded.map((r) => r.id)).toEqual(["R002"]);
  });

  it("clearAllReports empties the store", async () => {
    await saveReport(report({ id: "R001" }));
    await saveReport(report({ id: "R002" }));
    await clearAllReports();
    expect(await loadAllReports()).toEqual([]);
  });
});

describe("migrateReport — TEST 14 (기존 Legacy 데이터, 스펙 25번)", () => {
  it("STEP11(품질추적) 이전에 저장된 보고서는 analysisRuns/qualityEvents가 채워지고 legacy:true로 표시된다", () => {
    const old = { id: "R-OLD", sourceName: "old.pdf", createdAt: "2026-01-01T00:00:00.000Z", records: [], photos: [], documents: [], candidateDamages: [], session: createReviewSession(), exportHistory: [] };
    const migrated = migrateReport(old);
    expect(migrated.analysisRuns).toEqual([]);
    expect(migrated.qualityEvents).toEqual([]);
    expect(migrated.legacy).toBe(true);
  });

  it("이미 analysisRuns/qualityEvents가 있는 보고서는 legacy로 과거 데이터를 함부로 판정하지 않는다", () => {
    const modern: AnalyzedReport = report({ analysisRuns: [], qualityEvents: [] });
    expect(migrateReport(modern).legacy).toBe(false);
  });
});
