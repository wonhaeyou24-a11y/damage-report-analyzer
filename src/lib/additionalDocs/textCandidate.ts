import type { AdditionalEvidenceCandidate, AdditionalSourceRef } from "../../types";
import {
  parseDamageNameFromText,
  parseLocationFromText,
  parsePhotoNo,
  parseRepairMethodFromText,
  parseSectionFromText,
  parseSubPartFromText,
} from "../photoAnalysis";

const LOCATION_PATTERN_G = /\d+(?:\.\d+)?(?:~\d+(?:\.\d+)?)?\s?(?:m|km|㎡|㎥)/g;

/**
 * 텍스트 한 덩어리(문단, 표의 한 행 등)에서 손상 후보 하나를 만든다.
 * 손상명/위치/세부부위/사진번호 중 아무 근거도 없으면 후보를 만들지 않는다(임의 생성 금지).
 */
export function candidateFromChunk(
  chunk: string,
  location: string | null,
  base: Omit<AdditionalSourceRef, "quote">
): AdditionalEvidenceCandidate | null {
  const damageName = parseDamageNameFromText(chunk);
  const subPartInfo = parseSubPartFromText(chunk);
  const section = parseSectionFromText(chunk);
  const repairMethod = parseRepairMethodFromText(chunk);
  const photoNo = parsePhotoNo(chunk);
  const resolvedLocation = location ?? parseLocationFromText(chunk);

  if (!damageName && !resolvedLocation && !subPartInfo && !photoNo) return null;

  return {
    section,
    damageName,
    part: subPartInfo?.part ?? null,
    subPart: subPartInfo?.subPart ?? null,
    location: resolvedLocation,
    repairMethod,
    quantity: null, // 자유서술 텍스트에서 개별 수량을 임의로 추정하지 않는다. 표 구조 파서에서만 채운다.
    photoNo,
    sourceRef: { ...base, quote: chunk.trim().slice(0, 200) },
  };
}

/**
 * 위치 표기를 앵커로 삼아 긴 본문 텍스트를 여러 손상 후보로 나눈다. 위치가 전혀
 * 없으면 손상명만으로 후보 하나를 시도한다 (예: 종합결론처럼 위치 없이 서술하는 자료).
 */
export function extractCandidatesFromText(text: string, base: Omit<AdditionalSourceRef, "quote">): AdditionalEvidenceCandidate[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const matches = Array.from(trimmed.matchAll(LOCATION_PATTERN_G));
  if (matches.length === 0) {
    const c = candidateFromChunk(trimmed, null, base);
    return c ? [c] : [];
  }

  const candidates: AdditionalEvidenceCandidate[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const prevEnd = i === 0 ? 0 : matches[i - 1].index! + matches[i - 1][0].length;
    const windowStart = Math.max(prevEnd, match.index! - 60);
    const chunk = trimmed.slice(windowStart, match.index! + match[0].length + 30);
    const location = match[0].replace(/\s+/g, "");
    const c = candidateFromChunk(chunk, location, base);
    if (c) candidates.push(c);
  }
  return candidates;
}
