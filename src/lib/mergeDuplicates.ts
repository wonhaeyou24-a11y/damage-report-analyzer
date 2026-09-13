import type { ConflictEntry, ConflictValue, DamagePhoto, DamageRecord, SourceReference } from "../types";

/**
 * STEP 5 — 중복 통합 + 다중 페이지 정보 통합 + 불일치 검출.
 *
 * STEP 4가 만든 개별 손상 레코드(DamageRecord[])를 입력으로 받아:
 *  1) 동일 손상(구간+손상명+부위+세부부위+위치가 전부 같음)이 여러 출처에서 중복 추출된 경우
 *     하나로 통합하고, 서로 다른 페이지의 정보를 결합한다 (보수방안/수량/사진 등).
 *  2) 위치만 다르지만 서로 다른 출처(겹치지 않는 페이지)에서 나온 항목은 "같은 손상을
 *     다르게 보고한 것"일 가능성이 있으므로 임의로 하나를 선택하지 않고 불일치로 표시한다.
 *  3) 하나의 원본 출처에서 함께 나열된 서로 다른 위치(예: 소단측구 165,187,188...m)는
 *     페이지 집합이 동일하므로 절대 합치지 않고 개별 손상으로 유지한다.
 *
 * 특정 보고서/업체 양식에 종속되지 않도록 필드 값과 출처 페이지 집합만으로 판단한다.
 */

function normalizeText(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, "");
}

function strongKey(r: DamageRecord): string {
  return [normalizeText(r.section), normalizeText(r.damageName), r.part, normalizeText(r.subPart), normalizeText(r.location)].join(
    "||"
  );
}

function weakKeyIgnoringLocation(r: DamageRecord): string {
  return [normalizeText(r.section), normalizeText(r.damageName), r.part, normalizeText(r.subPart), normalizeText(r.groupNo)].join(
    "||"
  );
}

function uniqueSourceReferences(refs: SourceReference[]): SourceReference[] {
  const seen = new Set<string>();
  const result: SourceReference[] = [];
  for (const ref of refs) {
    const key = `${ref.page}||${ref.type}||${ref.excerpt ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(ref);
    }
  }
  return result;
}

function uniquePhotos(photos: DamagePhoto[]): DamagePhoto[] {
  const seen = new Set<string>();
  const result: DamagePhoto[] = [];
  for (const p of photos) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      result.push(p);
    }
  }
  return result;
}

function unionSourcePages(records: DamageRecord[]): number[] {
  return Array.from(new Set(records.flatMap((r) => r.sourcePages))).sort((a, b) => a - b);
}

/** 값이 없는 쪽은 무시하고, 서로 다른 값이 실제로 존재할 때만 불일치로 판단한다. */
function combineField(
  records: DamageRecord[],
  field: "repairMethod" | "quantity" | "groupNo",
  getPage: (r: DamageRecord) => number | null
): { value: string; conflict?: ConflictEntry } {
  const distinct = new Map<string, ConflictValue>();
  for (const r of records) {
    const raw = (r as any)[field] as string | null;
    if (!raw || !raw.trim()) continue;
    const norm = normalizeText(raw);
    if (!distinct.has(norm)) distinct.set(norm, { value: raw.trim(), page: getPage(r) });
  }
  const values = Array.from(distinct.values());
  if (values.length === 0) return { value: "" };
  if (values.length === 1) return { value: values[0].value };
  return {
    value: field === "groupNo" ? values[0].value : "검토필요",
    conflict: { field, values },
  };
}

function mergeGroup(records: DamageRecord[], locationConflict?: ConflictValue[]): DamageRecord {
  if (records.length === 1 && !locationConflict) {
    return { ...records[0], mergeInfo: { merged: false, sourceRecordIds: [] } };
  }

  const sorted = [...records].sort((a, b) => a.groupIndex - b.groupIndex);
  const base = sorted[0];
  const others = sorted.slice(1);
  const firstPageOf = (r: DamageRecord) => r.sourcePages[0] ?? null;

  const repair = combineField(sorted, "repairMethod", firstPageOf);
  const groupNoField = combineField(sorted, "groupNo", firstPageOf);
  const quantityGroups = combineField(
    sorted.map((r) => ({ ...r, repairMethod: r.quantityGroup ?? "" }) as DamageRecord),
    "repairMethod",
    firstPageOf
  );
  const individualQuantities = combineField(
    sorted.map((r) => ({ ...r, repairMethod: r.quantity ?? "" }) as DamageRecord),
    "repairMethod",
    firstPageOf
  );

  const conflicts: ConflictEntry[] = [];
  if (repair.conflict) conflicts.push(repair.conflict);
  if (groupNoField.conflict) conflicts.push({ ...groupNoField.conflict, field: "groupNo" });
  if (quantityGroups.conflict || individualQuantities.conflict) {
    const values = [...(quantityGroups.conflict?.values ?? []), ...(individualQuantities.conflict?.values ?? [])];
    if (values.length > 0) conflicts.push({ field: "quantity", values });
  }
  if (locationConflict) {
    conflicts.push({ field: "location", values: locationConflict });
  }

  const notesParts = sorted.map((r) => r.notes).filter((n): n is string => !!n);

  return {
    ...base,
    groupNo: groupNoField.value || base.groupNo,
    location: locationConflict ? "검토필요" : base.location,
    repairMethod: repair.value || base.repairMethod,
    quantityGroup: individualQuantities.value ? null : quantityGroups.value || base.quantityGroup,
    quantity: individualQuantities.value || base.quantity,
    photos: uniquePhotos(sorted.flatMap((r) => r.photos)),
    sourcePages: unionSourcePages(sorted),
    sourceReferences: uniqueSourceReferences(sorted.flatMap((r) => r.sourceReferences)),
    status: conflicts.length > 0 ? "conflict" : sorted.some((r) => r.status === "confirmed") ? "confirmed" : "review",
    notes: notesParts.length ? Array.from(new Set(notesParts)).join("; ") : base.notes,
    mergeInfo: { merged: true, sourceRecordIds: others.map((r) => r.id) },
    conflicts,
  };
}

/**
 * 완전히 겹치지 않는 출처 페이지에서 나온, 위치만 다른 항목들을 하나의 손상으로 보고
 * 위치 불일치로 표시할지 판단한다. 같은 출처(페이지 집합이 하나라도 겹침)에서 나온
 * 항목은 "원문에 함께 나열된 서로 다른 위치"이므로 절대 합치지 않는다.
 */
function pagesFullyDisjoint(groups: DamageRecord[][]): boolean {
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = new Set(groups[i].flatMap((r) => r.sourcePages));
      const b = new Set(groups[j].flatMap((r) => r.sourcePages));
      for (const p of a) if (b.has(p)) return false;
    }
  }
  return true;
}

export function mergeDuplicates(records: DamageRecord[]): DamageRecord[] {
  // 1단계: 동일 손상(위치까지 완전히 동일)을 강한 키로 통합 — 다중 페이지 정보 결합.
  const strongGroups = new Map<string, DamageRecord[]>();
  for (const r of records) {
    const key = strongKey(r);
    const arr = strongGroups.get(key) ?? [];
    arr.push(r);
    strongGroups.set(key, arr);
  }
  const afterStrongMerge = Array.from(strongGroups.values()).map((group) => mergeGroup(group));

  // 2단계: 위치만 다르지만 서로 다른(겹치지 않는) 출처에서 나온 항목은 불일치 후보로 재검토.
  const weakGroups = new Map<string, DamageRecord[]>();
  for (const r of afterStrongMerge) {
    const key = weakKeyIgnoringLocation(r);
    const arr = weakGroups.get(key) ?? [];
    arr.push(r);
    weakGroups.set(key, arr);
  }

  const result: DamageRecord[] = [];
  for (const group of weakGroups.values()) {
    const distinctLocations = new Set(group.map((r) => normalizeText(r.location)));
    if (group.length > 1 && distinctLocations.size > 1 && pagesFullyDisjoint(group.map((r) => [r]))) {
      const locationValues: ConflictValue[] = group.map((r) => ({ value: r.location, page: r.sourcePages[0] ?? null }));
      result.push(mergeGroup(group, locationValues));
    } else {
      result.push(...group);
    }
  }

  return result;
}
