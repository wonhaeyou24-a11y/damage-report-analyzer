import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAllReports, deleteReport, loadAllReports, saveReport, type AnalyzedReport } from "./reportStorage";
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
    expect(loaded[0]).toEqual(r);
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
