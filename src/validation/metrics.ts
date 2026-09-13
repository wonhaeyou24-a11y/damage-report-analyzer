import type { DamageRecord, ExtractedPhoto } from "../types";
import { normalizeLocationText } from "../lib/photoAnalysis";
import { matchDamages, normalizeDamageName, type DamageMatchPair } from "./groundTruthMatch";
import { matchPhotos } from "./photoMatch";
import type {
  CrossValidationBreakdown,
  FieldAccuracy,
  GroundTruthDamage,
  GroundTruthPhoto,
  PrecisionRecallF1,
  ValidationMetrics,
  ValidationThresholds,
} from "./types";
import { DEFAULT_THRESHOLDS, classifyStatus } from "./types";

function normText(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, "");
}

export function precisionRecallF1(tp: number, fp: number, fn: number): PrecisionRecallF1 {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, precision, recall, f1 };
}

export function computeDamageDetectionMetrics(matched: DamageMatchPair[], missed: GroundTruthDamage[], extra: DamageRecord[]): PrecisionRecallF1 {
  return precisionRecallF1(matched.length, extra.length, missed.length);
}

const FIELD_COMPARATORS: Record<string, (gt: GroundTruthDamage, ai: DamageRecord) => boolean> = {
  damageName: (gt, ai) => normalizeDamageName(gt.damageName) === normalizeDamageName(ai.damageName),
  part: (gt, ai) => gt.part === ai.part,
  subPart: (gt, ai) => normText(gt.subPart) === normText(ai.subPart),
  location: (gt, ai) => (normalizeLocationText(gt.location) ?? normText(gt.location)) === (normalizeLocationText(ai.location) ?? normText(ai.location)),
  // 규모/물량: 그룹 합계만 있는 경우가 많으므로 quantity와 quantityGroup 중 실제 값이 있는 쪽을 비교한다.
  quantity: (gt, ai) => normText(gt.quantity ?? gt.quantityGroup) === normText(ai.quantity ?? ai.quantityGroup),
  repairMethod: (gt, ai) => normText(gt.repairMethod) === normText(ai.repairMethod),
};

const FIELD_ORDER = ["damageName", "part", "subPart", "location", "quantity", "repairMethod"];

/** 매칭된 손상 쌍에 대해서만 필드별 일치율을 계산한다 — 매칭 자체가 안 된 손상은 탐지 지표(P/R/F1)에서 이미 반영된다. */
export function computeFieldAccuracy(matched: DamageMatchPair[]): FieldAccuracy[] {
  return FIELD_ORDER.map((field) => {
    const comparator = FIELD_COMPARATORS[field];
    const total = matched.length;
    const matchedCount = matched.filter((pair) => comparator(pair.gt, pair.ai)).length;
    return { field, matched: matchedCount, total, matchRate: total > 0 ? matchedCount / total : 0 };
  });
}

export function computePhotoExtractionMetrics(groundTruthPhotos: GroundTruthPhoto[], aiPhotos: ExtractedPhoto[]): PrecisionRecallF1 {
  const { matched, missed, extra } = matchPhotos(groundTruthPhotos, aiPhotos);
  return precisionRecallF1(matched.length, extra.length, missed.length);
}

/**
 * 손상 ↔ 사진 연결 정확도. 매칭된 손상 쌍에 대해서만 "이 손상에 연결되어야 하는 사진번호
 * 집합"(GT)과 "실제로 연결된 사진번호 집합"(AI)을 비교한다.
 */
export function computePhotoLinkMetrics(
  matchedDamages: DamageMatchPair[],
  groundTruthPhotos: GroundTruthPhoto[],
  aiPhotos: ExtractedPhoto[]
): PrecisionRecallF1 {
  const aiPhotoById = new Map(aiPhotos.map((p) => [p.id, p]));
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const { gt, ai } of matchedDamages) {
    const expectedPhotoNos = new Set(
      groundTruthPhotos.filter((p) => p.linkedDamageIds.includes(gt.id)).map((p) => normText(p.photoNo)).concat(gt.photoNos.map(normText))
    );
    const actualPhotoNos = new Set((ai.photoIds ?? []).map((id) => normText(aiPhotoById.get(id)?.photoNo ?? id)));

    for (const expected of expectedPhotoNos) {
      if (actualPhotoNos.has(expected)) tp++;
      else fn++;
    }
    for (const actual of actualPhotoNos) {
      if (!expectedPhotoNos.has(actual)) fp++;
    }
  }

  return precisionRecallF1(tp, fp, fn);
}

/** GT가 기대 교차검증 결과를 제공한 손상이 하나도 없으면 accuracy는 null(N/A)로 남긴다 — 임의로 100%나 0%로 만들지 않는다. */
export function computeCrossValidationBreakdown(matched: DamageMatchPair[]): CrossValidationBreakdown {
  const breakdown: CrossValidationBreakdown = { matched: 0, conflict: 0, missingInAdditional: 0, candidate: 0, unsupported: 0, accuracy: null };
  let evaluated = 0;
  let correct = 0;

  for (const { gt, ai } of matched) {
    const result = ai.crossValidation?.result;
    if (result === "matched") breakdown.matched++;
    else if (result === "conflict") breakdown.conflict++;
    else if (result === "missingInAdditional") breakdown.missingInAdditional++;
    else if (result === "candidate") breakdown.candidate++;
    else if (result === "unsupported") breakdown.unsupported++;

    if (gt.expectedCrossValidation) {
      evaluated++;
      if (gt.expectedCrossValidation === result) correct++;
    }
  }

  breakdown.accuracy = evaluated > 0 ? correct / evaluated : null;
  return breakdown;
}

export function computeValidationMetrics(
  groundTruthDamages: GroundTruthDamage[],
  aiDamages: DamageRecord[],
  groundTruthPhotos: GroundTruthPhoto[],
  aiPhotos: ExtractedPhoto[],
  thresholds: ValidationThresholds = DEFAULT_THRESHOLDS
): ValidationMetrics {
  const { matched, missed, extra } = matchDamages(groundTruthDamages, aiDamages);
  const damageDetection = computeDamageDetectionMetrics(matched, missed, extra);
  const fieldAccuracy = computeFieldAccuracy(matched);
  const photoExtraction = computePhotoExtractionMetrics(groundTruthPhotos, aiPhotos);
  const photoLink = computePhotoLinkMetrics(matched, groundTruthPhotos, aiPhotos);
  const crossValidation = computeCrossValidationBreakdown(matched);
  const overallF1 = damageDetection.f1;

  return {
    damageDetection,
    fieldAccuracy,
    photoExtraction,
    photoLink,
    crossValidation,
    overallF1,
    status: classifyStatus(overallF1, thresholds),
  };
}
