import type { ExtractedPhoto } from "../types";
import type { GroundTruthPhoto } from "./types";

function normText(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, "");
}

export interface PhotoMatchPair {
  gt: GroundTruthPhoto;
  ai: ExtractedPhoto;
}

export interface PhotoMatchResult {
  matched: PhotoMatchPair[];
  missed: GroundTruthPhoto[];
  extra: ExtractedPhoto[];
}

/**
 * STEP 11 — Ground Truth 사진과 AI가 추출한 사진을 매칭한다. 사진번호가 둘 다 있으면
 * 사진번호로, 없으면 페이지 번호로 매칭한다(사진번호가 없는 보고서도 정상 테스트 대상이므로).
 */
export function matchPhotos(groundTruth: GroundTruthPhoto[], aiPhotos: ExtractedPhoto[]): PhotoMatchResult {
  const usedAiIds = new Set<string>();
  const matched: PhotoMatchPair[] = [];
  const missed: GroundTruthPhoto[] = [];

  for (const gt of groundTruth) {
    const candidate = aiPhotos.find((ai) => {
      if (usedAiIds.has(ai.id)) return false;
      if (gt.photoNo && ai.photoNo) return normText(gt.photoNo) === normText(ai.photoNo);
      if (!gt.photoNo && !ai.photoNo) return gt.page === ai.page;
      return false;
    });
    if (candidate) {
      usedAiIds.add(candidate.id);
      matched.push({ gt, ai: candidate });
    } else {
      missed.push(gt);
    }
  }

  const extra = aiPhotos.filter((ai) => !usedAiIds.has(ai.id));
  return { matched, missed, extra };
}
