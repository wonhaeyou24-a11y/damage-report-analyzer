import type { DamagePhotoMatchStatus, DamageRecord, ExtractedPhoto, PhotoMatchCandidate } from "../types";
import { MAX_MATCH_SCORE, computeMatchScore, hasHardConflict } from "./photoAnalysis";

/**
 * STEP 7 — 손상(STEP5) ↔ 사진(STEP6) 자동 연결.
 *
 * 원칙:
 *  - 점수만으로 무조건 확정하지 않는다. 위치/세부부위가 서로 다르면(hasHardConflict) 점수와
 *    무관하게 confirmed로 올리지 않는다.
 *  - 사용자가 수동으로 결정한 사진(manualOverride)은 재분석 시 절대 덮어쓰지 않는다.
 *  - 사진 1장이 여러 손상과, 손상 1건이 여러 사진과 연결되는 것을 모두 허용한다(임계값을
 *    넘는 모든 후보를 연결하며, 상위 1건으로 강제로 좁히지 않는다).
 *  - damage.photoIds/photoMatchStatus는 photos[].linkedDamageIds로부터 파생시켜 단일 진실
 *    공급원을 유지한다(수동 연결도 자동으로 damage 쪽에 반영됨).
 */

export interface MatchThresholds {
  confirm: number; // 이 값 이상 + 충돌 없음 → confirmed
  review: number; // 이 값 이상(또는 충돌 있음) → review
}

export const DEFAULT_THRESHOLDS: MatchThresholds = { confirm: 0.9, review: 0.7 };

interface ScoredCandidate extends PhotoMatchCandidate {
  confidence: number;
}

function scoreAgainstDamage(photo: ExtractedPhoto, damage: DamageRecord): ScoredCandidate {
  const { score, reasons } = computeMatchScore(photo, damage);
  return {
    damageId: damage.id,
    score,
    reasons,
    conflict: hasHardConflict(photo, damage),
    confidence: score / MAX_MATCH_SCORE,
  };
}

interface SinglePhotoMatchResult {
  candidates: PhotoMatchCandidate[];
  linkedDamageIds: string[];
  matchStatus: "confirmed" | "review" | "unmatched";
  confidence: number | null;
  matchReasons: string[];
}

function matchOnePhoto(photo: ExtractedPhoto, damages: DamageRecord[], thresholds: MatchThresholds): SinglePhotoMatchResult {
  const scored = damages
    .map((d) => scoreAgainstDamage(photo, d))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const confirmed = scored.filter((c) => c.confidence >= thresholds.confirm && !c.conflict);
  const reviewTier = scored.filter((c) => c.confidence >= thresholds.review || c.conflict);

  const matchStatus: SinglePhotoMatchResult["matchStatus"] = confirmed.length > 0 ? "confirmed" : reviewTier.length > 0 ? "review" : "unmatched";

  const matchReasons = confirmed.length > 0 ? Array.from(new Set(confirmed.flatMap((c) => c.reasons))) : [];

  return {
    candidates: scored.map(({ damageId, score, reasons, conflict }) => ({ damageId, score, reasons, conflict })),
    linkedDamageIds: confirmed.map((c) => c.damageId),
    matchStatus,
    confidence: scored[0]?.confidence ?? null,
    matchReasons,
  };
}

/**
 * damage.photoIds/photoMatchStatus를 photos[]로부터 파생시킨다. 사용자가 "사진 없음"으로
 * 직접 지정한 손상(photoMatchOverride)은 실제 연결된 사진이 없는 한 그 지정을 우선한다.
 */
export function deriveDamagePhotoLinks(damages: DamageRecord[], photos: ExtractedPhoto[]): DamageRecord[] {
  const linkedPhotosByDamage = new Map<string, string[]>();
  const candidateDamageIds = new Set<string>();
  const conflictDamageIds = new Set<string>();

  for (const p of photos) {
    for (const damageId of p.linkedDamageIds) {
      linkedPhotosByDamage.set(damageId, [...(linkedPhotosByDamage.get(damageId) ?? []), p.id]);
    }
    for (const c of p.matchCandidates) {
      // 잡음 수준의 매우 약한 근거(예: 부위만 우연히 같음)만으로는 "검토 필요" 취급하지 않는다.
      const meaningful = c.conflict || c.score / MAX_MATCH_SCORE >= DEFAULT_THRESHOLDS.review;
      if (meaningful) {
        candidateDamageIds.add(c.damageId);
        if (c.conflict) conflictDamageIds.add(c.damageId);
      }
    }
  }

  return damages.map((d) => {
    const photoIds = linkedPhotosByDamage.get(d.id) ?? [];
    let photoMatchStatus: DamagePhotoMatchStatus;
    if (photoIds.length > 0) {
      photoMatchStatus = "confirmed";
    } else if (d.photoMatchOverride === "noPhoto") {
      photoMatchStatus = "noPhoto";
    } else if (conflictDamageIds.has(d.id)) {
      photoMatchStatus = "conflict";
    } else if (candidateDamageIds.has(d.id)) {
      photoMatchStatus = "review";
    } else {
      photoMatchStatus = "noPhoto";
    }
    return { ...d, photoIds, photoMatchStatus };
  });
}

/**
 * 전체 재분석 진입점. manualOverride가 설정된 사진은 건드리지 않고,
 * 나머지 사진만 새로 채점해 confirmed/review/unmatched를 갱신한다.
 */
export function matchPhotosToDamages(
  damages: DamageRecord[],
  photos: ExtractedPhoto[],
  thresholds: MatchThresholds = DEFAULT_THRESHOLDS
): { damages: DamageRecord[]; photos: ExtractedPhoto[] } {
  const newPhotos = photos.map((photo) => {
    if (photo.manualOverride) return photo;
    const result = matchOnePhoto(photo, damages, thresholds);
    return {
      ...photo,
      matchCandidates: result.candidates,
      linkedDamageIds: result.linkedDamageIds,
      matchStatus: result.matchStatus,
      confidence: result.confidence,
      matchReasons: result.matchReasons,
      matchSource: "auto" as const,
      status: result.matchStatus === "confirmed" ? ("confirmed" as const) : photo.status === "failed" ? photo.status : ("review" as const),
    };
  });

  return { damages: deriveDamagePhotoLinks(damages, newPhotos), photos: newPhotos };
}

// ---- 수동 조작 (사용자 결정은 자동 재분석보다 항상 우선한다) ----

export function manuallyLinkPhoto(photos: ExtractedPhoto[], photoId: string, damageId: string): ExtractedPhoto[] {
  return photos.map((p) =>
    p.id === photoId
      ? {
          ...p,
          linkedDamageIds: Array.from(new Set([...p.linkedDamageIds, damageId])),
          matchStatus: "confirmed",
          matchSource: "manual",
          manualOverride: true,
          status: "confirmed",
        }
      : p
  );
}

export function manuallyUnlinkPhoto(photos: ExtractedPhoto[], photoId: string, damageId: string): ExtractedPhoto[] {
  return photos.map((p) => {
    if (p.id !== photoId) return p;
    const linkedDamageIds = p.linkedDamageIds.filter((id) => id !== damageId);
    return {
      ...p,
      linkedDamageIds,
      matchSource: "manual",
      manualOverride: true,
      matchStatus: linkedDamageIds.length > 0 ? "confirmed" : "unmatched",
    };
  });
}

export function setDamageNoPhoto(damages: DamageRecord[], damageId: string, value: boolean): DamageRecord[] {
  return damages.map((d) => (d.id === damageId ? { ...d, photoMatchOverride: value ? ("noPhoto" as const) : undefined } : d));
}
