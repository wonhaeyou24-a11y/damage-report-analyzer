import type { DamageMatchPair } from "./groundTruthMatch";
import { normalizeDamageName } from "./groundTruthMatch";
import { normalizeLocationText } from "../lib/photoAnalysis";
import type { PhotoMatchResult } from "./photoMatch";
import type { ErrorCategory, ErrorEntry, GroundTruthDamage } from "./types";

function normText(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, "");
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `ERR-${String(idCounter).padStart(4, "0")}`;
}

function sourceLabel(refs: { page: number }[] | undefined): string | null {
  if (!refs || refs.length === 0) return null;
  return refs.map((r) => `p.${r.page}`).join(", ");
}

const FIELD_CATEGORY: Record<string, ErrorCategory> = {
  damageName: "DAMAGE_NAME_ERROR",
  part: "PART_CLASSIFICATION_ERROR",
  subPart: "SUBPART_ERROR",
  location: "LOCATION_ERROR",
  quantity: "QUANTITY_ERROR",
  repairMethod: "REPAIR_METHOD_ERROR",
};

function fieldsDiffer(gt: GroundTruthDamage, ai: DamageMatchPair["ai"], field: string): boolean {
  switch (field) {
    case "damageName":
      return normalizeDamageName(gt.damageName) !== normalizeDamageName(ai.damageName);
    case "part":
      return gt.part !== ai.part;
    case "subPart":
      return normText(gt.subPart) !== normText(ai.subPart);
    case "location":
      return (normalizeLocationText(gt.location) ?? normText(gt.location)) !== (normalizeLocationText(ai.location) ?? normText(ai.location));
    case "quantity":
      return normText(gt.quantity ?? gt.quantityGroup) !== normText(ai.quantity ?? ai.quantityGroup);
    case "repairMethod":
      return normText(gt.repairMethod) !== normText(ai.repairMethod);
    default:
      return false;
  }
}

function fieldValue(gt: GroundTruthDamage, ai: DamageMatchPair["ai"], field: string, side: "gt" | "ai"): string | null {
  const record = side === "gt" ? gt : ai;
  switch (field) {
    case "damageName":
      return record.damageName;
    case "part":
      return record.part;
    case "subPart":
      return record.subPart;
    case "location":
      return record.location;
    case "quantity":
      return side === "gt" ? (gt.quantity ?? gt.quantityGroup) : (ai.quantity ?? ai.quantityGroup);
    case "repairMethod":
      return record.repairMethod;
    default:
      return null;
  }
}

/**
 * STEP 11 — 매칭 결과(손상 탐지 + 필드 비교 + 사진 매칭)로부터 오류 항목을 만든다.
 * 실패를 숨기지 않고 전부 기록한다(스펙 6/9번). 사람이 임의로 PASS 처리하지 않는다.
 */
export function buildErrorEntries(
  testCaseId: string,
  matched: DamageMatchPair[],
  missed: GroundTruthDamage[],
  extra: DamageMatchPair["ai"][],
  photoResult: PhotoMatchResult
): ErrorEntry[] {
  const entries: ErrorEntry[] = [];

  for (const { gt, ai } of matched) {
    for (const field of Object.keys(FIELD_CATEGORY)) {
      if (!fieldsDiffer(gt, ai, field)) continue;
      entries.push({
        id: nextId(),
        testCaseId,
        step: field === "location" ? "STEP 4" : field === "quantity" ? "STEP 5" : "STEP 4",
        field,
        category: FIELD_CATEGORY[field],
        groundTruthValue: fieldValue(gt, ai, field, "gt"),
        aiValue: fieldValue(gt, ai, field, "ai"),
        groundTruthSource: sourceLabel(gt.sourceRefs),
        aiSource: sourceLabel(ai.sourceReferences),
        damageId: gt.id,
      });
    }
  }

  for (const gt of missed) {
    entries.push({
      id: nextId(),
      testCaseId,
      step: "STEP 4",
      field: null,
      category: "EXTRACTION_ERROR",
      groundTruthValue: `${gt.damageName} / ${gt.subPart} / ${gt.location}`,
      aiValue: null,
      groundTruthSource: sourceLabel(gt.sourceRefs),
      aiSource: null,
      damageId: gt.id,
    });
  }

  for (const ai of extra) {
    entries.push({
      id: nextId(),
      testCaseId,
      step: "STEP 4",
      field: null,
      category: "EXTRACTION_ERROR",
      groundTruthValue: null,
      aiValue: `${ai.damageName} / ${ai.subPart} / ${ai.location}`,
      groundTruthSource: null,
      aiSource: sourceLabel(ai.sourceReferences),
      damageId: ai.id,
    });
  }

  for (const gt of photoResult.missed) {
    entries.push({
      id: nextId(),
      testCaseId,
      step: "STEP 6",
      field: "photo",
      category: "PHOTO_EXTRACTION_ERROR",
      groundTruthValue: `${gt.photoNo ?? "-"} (p.${gt.page})`,
      aiValue: null,
      groundTruthSource: `p.${gt.page}`,
      aiSource: null,
    });
  }
  for (const ai of photoResult.extra) {
    entries.push({
      id: nextId(),
      testCaseId,
      step: "STEP 6",
      field: "photo",
      category: "PHOTO_EXTRACTION_ERROR",
      groundTruthValue: null,
      aiValue: `${ai.photoNo ?? ai.id} (p.${ai.page})`,
      groundTruthSource: null,
      aiSource: `p.${ai.page}`,
    });
  }

  return entries;
}

export function resetErrorIdCounter(): void {
  idCounter = 0;
}

export interface ErrorAggregate {
  category: ErrorCategory;
  count: number;
}

export function aggregateErrorsByCategory(errors: ErrorEntry[]): ErrorAggregate[] {
  const counts = new Map<ErrorCategory, number>();
  for (const e of errors) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}
