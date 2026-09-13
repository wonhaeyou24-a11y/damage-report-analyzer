import type { ExportFormat, ExportHistoryEntry, ReviewSession } from "../../types";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `EXP-${String(idCounter).padStart(3, "0")}`;
}

export function buildHistoryEntry(
  type: ExportFormat,
  session: ReviewSession,
  selectedDamageIds: string[],
  fileName: string,
  status: "success" | "failed",
  error?: string
): ExportHistoryEntry {
  return {
    id: nextId(),
    type,
    createdAt: new Date().toISOString(),
    reviewVersion: session.reviewVersion,
    selectedDamageIds,
    fileName,
    status,
    error,
  };
}

export function appendHistory(history: ExportHistoryEntry[], entry: ExportHistoryEntry): ExportHistoryEntry[] {
  return [...history, entry];
}
