import type { DamageRecord, RawDamageGroup, RawLocationEntry, StandardPart } from "../types";
import { STANDARD_PARTS } from "../types";

const UNIT_PATTERN = /(km|m|㎡|㎥)\s*$/;
const HAS_UNIT_PATTERN = /[a-zA-Z㎡㎥]/;
const LEADING_LABEL_PATTERN = /^([가-힣][가-힣0-9\s]*?)\s+([0-9].*)$/;

/**
 * "165, 187, 188m" 같은 콤마 목록을 개별 위치로 분리한다.
 * "176~206m" 같은 범위는 하나의 위치로 유지한다 (임의로 쪼개지 않음).
 */
export function parseLocationList(str: string, subPart: string): RawLocationEntry[] {
  const trimmed = str.trim();
  if (!trimmed) return [];
  const unitMatch = trimmed.match(UNIT_PATTERN);
  const unit = unitMatch ? unitMatch[1] : "";
  const body = unit ? trimmed.slice(0, trimmed.length - unit.length) : trimmed;
  return body
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const value = HAS_UNIT_PATTERN.test(p) ? p : unit ? `${p}${unit}` : p;
      return { subPart, location: value, quantity: null };
    });
}

/**
 * 여러 줄에 걸쳐 세부부위가 바뀌는 블록을 파싱한다. 예:
 *   "165, 187, 188, 190, 217, 261, 267, 275m\n도수로 208m\n산마루측구 211, 323m"
 * 줄 앞에 세부부위 라벨이 없으면 이전(또는 기본) 세부부위를 유지한다.
 */
export function parseLocationBlock(text: string, defaultSubPart: string): RawLocationEntry[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  let currentSubPart = defaultSubPart;
  const entries: RawLocationEntry[] = [];
  for (const line of lines) {
    const match = line.match(LEADING_LABEL_PATTERN);
    let rest = line;
    if (match) {
      currentSubPart = match[1].trim();
      rest = match[2];
    }
    entries.push(...parseLocationList(rest, currentSubPart));
  }
  return entries;
}

/** AI가 반환한 부위 문자열을 표준 분류값으로 정규화한다. 매칭 실패 시 "기타". */
export function standardizePart(rawPart: string): { part: StandardPart; matched: boolean } {
  const cleaned = (rawPart || "").trim();
  const hit = STANDARD_PARTS.find((p) => p === cleaned);
  if (hit) return { part: hit, matched: true };
  return { part: "기타", matched: false };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

let fallbackCounter = 0;
function nextFallbackId(): string {
  fallbackCounter += 1;
  return `TMP-${fallbackCounter}`;
}

/**
 * 손상 그룹(RawDamageGroup)을 개별 손상 레코드(DamageRecord[])로 분해한다.
 * - 위치가 1개면 접미사 없이 groupNo 그대로 id로 사용.
 * - 위치가 2개 이상이면 groupNo-01, groupNo-02 ... 형태로 분리.
 * - 개별 위치에 물량이 없으면 quantity=null, quantityGroup에 그룹 총 물량을 담는다.
 */
export function expandGroupToRecords(group: RawDamageGroup): DamageRecord[] {
  const { part, matched } = standardizePart(group.part);
  const locations = group.locations.length > 0 ? group.locations : [];
  const single = locations.length === 1;

  const groupQuantityLabel = group.quantityGroupTotal
    ? `그룹 합계 ${group.quantityGroupTotal}에 포함`
    : locations.length > 1
      ? "그룹 합계에 포함"
      : null;

  return locations.map((loc, idx) => {
    const id = single ? group.groupNo || nextFallbackId() : `${group.groupNo}-${pad2(idx + 1)}`;
    const hasIndividualQuantity = !!loc.quantity;
    const notes: string[] = [];
    if (!matched && group.part) {
      notes.push(`원문 부위값 "${group.part}"을(를) 표준 분류로 확정하지 못해 "기타"로 지정함`);
    }
    return {
      id,
      groupNo: group.groupNo,
      groupIndex: idx + 1,
      section: group.section,
      damageName: group.damageName,
      part,
      subPart: loc.subPart || "-",
      location: loc.location,
      repairMethod: group.repairMethod,
      quantity: hasIndividualQuantity ? loc.quantity : null,
      quantityGroup: hasIndividualQuantity ? null : groupQuantityLabel,
      photos: [],
      status: matched ? "review" : "review",
      sourcePages: group.sourcePages,
      sourceReferences: group.sourceReferences,
      notes: notes.length ? notes.join("; ") : undefined,
    };
  });
}

export function expandAllGroups(groups: RawDamageGroup[]): DamageRecord[] {
  fallbackCounter = 0;
  return groups.flatMap(expandGroupToRecords);
}
