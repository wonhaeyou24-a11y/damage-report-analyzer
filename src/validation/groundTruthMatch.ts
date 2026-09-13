import type { DamageRecord } from "../types";
import { normalizeLocationText } from "../lib/photoAnalysis";
import type { GroundTruthDamage } from "./types";

/**
 * STEP 11 — Ground Truth 손상과 AI 결과 손상을 매칭한다. 배열 index로 비교하지 않고
 * 구간+손상명(동의어 정규화)+부위+세부부위+위치(정규화)로 매칭한다. 위치가 다르면
 * 손상명이 같아도 별도 손상으로 취급한다(스펙 15/16번).
 */

const DAMAGE_NAME_SYNONYM_GROUPS: string[][] = [
  ["균열", "크랙", "crack"],
  ["박리", "박락"],
  ["누수", "침출수"],
  ["파손", "손상"],
  ["세굴", "세굴현상"],
];

function normText(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, "");
}

export function normalizeDamageName(name: string): string {
  const cleaned = normText(name).toLowerCase();
  const group = DAMAGE_NAME_SYNONYM_GROUPS.find((g) => g.some((syn) => syn.toLowerCase() === cleaned));
  return group ? group[0] : cleaned;
}

/**
 * 매칭 키에는 일부러 part(부위)를 넣지 않는다 — 부위 분류는 정확도를 측정해야 할
 * 대상(스펙 18.D)이지, "같은 손상인지" 판단하는 식별 기준이 아니다. part까지 키에
 * 넣으면 AI가 부위만 잘못 분류한 경우를 "완전히 다른 손상"(놓침+오탐)으로 잘못
 * 집계하게 되어, 정작 잡아야 할 PART_CLASSIFICATION_ERROR를 놓치게 된다.
 */
function damageKey(d: { section: string; damageName: string; subPart: string; location: string }): string {
  return [normText(d.section), normalizeDamageName(d.damageName), normText(d.subPart), normalizeLocationText(d.location) ?? normText(d.location)].join("||");
}

export interface DamageMatchPair {
  gt: GroundTruthDamage;
  ai: DamageRecord;
}

export interface DamageMatchResult {
  matched: DamageMatchPair[];
  missed: GroundTruthDamage[]; // Ground Truth에는 있지만 AI가 놓친 손상 (FN)
  extra: DamageRecord[]; // AI가 만들었지만 Ground Truth에 없는 손상 (FP)
}

/** 1:1 매칭만 허용한다 — 하나의 AI 손상이 여러 GT 손상에 중복으로 매칭되지 않는다. */
export function matchDamages(groundTruth: GroundTruthDamage[], aiDamages: DamageRecord[]): DamageMatchResult {
  const aiByKey = new Map<string, DamageRecord[]>();
  for (const ai of aiDamages) {
    const key = damageKey(ai);
    aiByKey.set(key, [...(aiByKey.get(key) ?? []), ai]);
  }

  const matched: DamageMatchPair[] = [];
  const missed: GroundTruthDamage[] = [];
  const usedAiIds = new Set<string>();

  for (const gt of groundTruth) {
    const key = damageKey(gt);
    const candidates = (aiByKey.get(key) ?? []).filter((ai) => !usedAiIds.has(ai.id));
    if (candidates.length > 0) {
      usedAiIds.add(candidates[0].id);
      matched.push({ gt, ai: candidates[0] });
    } else {
      missed.push(gt);
    }
  }

  const extra = aiDamages.filter((ai) => !usedAiIds.has(ai.id));
  return { matched, missed, extra };
}
