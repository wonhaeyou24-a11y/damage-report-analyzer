import type { DamageRecord, PhotoMatchCandidate, StandardPart } from "../types";

/**
 * STEP 6 — 사진 후보(캡션/사진번호/OCR 텍스트 등)를 순수 함수로 분석한다.
 * 특정 업체의 사진대지 양식을 전제하지 않고, 일반적으로 나타나는 표기 패턴만 인식한다.
 * 여기서 파싱한 값 중 문서에서 실제로 확인되지 않은 것은 null로 남긴다 (임의 생성 금지).
 */

const PHOTO_NO_PATTERNS: RegExp[] = [
  /사진\s*번호\s*[:：]?\s*[①-⑳0-9A-Za-z\-.]+/,
  /[①-⑳][-–]\s?\d+/,
  /사진\s?\d+/,
  /No\.?\s?\d+/i,
  /[A-Z]-\d+/,
  /\b[A-Z]\d{3,}\b/,
];

/** 텍스트에서 사진번호 표기를 찾는다. 여러 업체 표기(사진 1, ③-01, No.1, P-01, D-003)를 모두 시도한다. */
export function parsePhotoNo(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const re of PHOTO_NO_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0].trim();
  }
  return null;
}

const LOCATION_PATTERN = /\d+(?:\.\d+)?(?:~\d+(?:\.\d+)?)?\s?(?:m|km|㎡|㎥)/;

export function parseLocationFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(LOCATION_PATTERN);
  return m ? m[0].replace(/\s+/g, "") : null;
}

/**
 * STEP 7 — 위치 표기를 정규화한다 (165m / 165 m / STA.165m / STA 165 / K165 / 165.0m 등).
 * 정규화 결과가 동일할 때만 "같은 위치"로 판단하도록, 최대한 보수적으로 처리한다.
 */
export function normalizeLocationText(loc: string | null | undefined): string | null {
  if (!loc) return null;
  let s = loc.trim().replace(/\s+/g, "");
  s = s.replace(/^STA\.?/i, "");
  s = s.replace(/^K(\d)/i, "$1");
  s = s.replace(/(\d+)\.0(m|km|㎡|㎥)/i, "$1$2");
  if (/^\d+(?:\.\d+)?(?:~\d+(?:\.\d+)?)?$/.test(s)) s += "m";
  return s || null;
}

interface LocationRange {
  start: number;
  end: number;
  unit: string;
}

function parseRange(loc: string | null): LocationRange | null {
  if (!loc) return null;
  const m = loc.match(/^(\d+(?:\.\d+)?)~(\d+(?:\.\d+)?)(m|km|㎡|㎥)$/);
  if (!m) return null;
  return { start: parseFloat(m[1]), end: parseFloat(m[2]), unit: m[3] };
}

/** point가 range 범위 안에 드는지 확인한다. 범위를 확정 근거로 쓰지 않고 약한 참고용으로만 사용한다. */
export function isPointWithinRange(point: string | null, range: string | null): boolean {
  const normPoint = normalizeLocationText(point);
  const normRange = normalizeLocationText(range);
  const r = parseRange(normRange);
  if (!r || !normPoint) return false;
  const pm = normPoint.match(/^(\d+(?:\.\d+)?)(m|km|㎡|㎥)$/);
  if (!pm || pm[2] !== r.unit) return false;
  const val = parseFloat(pm[1]);
  return val >= r.start && val <= r.end;
}

const KNOWN_SUBPARTS: Record<string, StandardPart> = {
  소단측구: "배수시설",
  산마루측구: "배수시설",
  도수로: "배수시설",
  배수로: "배수시설",
};

export function parseSubPartFromText(text: string | null | undefined): { subPart: string; part: StandardPart } | null {
  if (!text) return null;
  for (const [subPart, part] of Object.entries(KNOWN_SUBPARTS)) {
    if (text.includes(subPart)) return { subPart, part };
  }
  return null;
}

const DAMAGE_KEYWORDS = ["균열", "붕괴", "식생불량", "단차", "박리", "파손", "누수", "침하", "탈락", "마모", "동공", "백태", "철근노출", "낙석", "세굴"];

export function parseDamageNameFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  return DAMAGE_KEYWORDS.find((k) => text.includes(k)) ?? null;
}

const SECTION_PATTERN = /\d+\s?구간/;

/** STEP 8 등에서 재사용 — 텍스트에서 "N구간" 표기를 찾는다. */
export function parseSectionFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(SECTION_PATTERN);
  return m ? m[0].replace(/\s+/g, "") : null;
}

const REPAIR_METHOD_KEYWORDS = [
  "주입보수",
  "표면처리",
  "배수로 정비",
  "주의관찰",
  "실런트 주입",
  "앵커보강",
  "그라우팅",
  "단면복구",
  "방수처리",
  "구조보강",
  "절취",
  "옹벽 신설",
];

/** STEP 8 — 텍스트에서 보수방안 키워드를 찾는다. 목록에 없는 표현은 만들어내지 않고 null을 반환한다. */
export function parseRepairMethodFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  return REPAIR_METHOD_KEYWORDS.find((k) => text.includes(k)) ?? null;
}

const DECORATIVE_KEYWORDS = ["표지", "로고", "목차", "서명", "인장", "도장", "발간등록번호", "작성자", "감수자"];

/** 사진의 손상 관련성을 보수적으로 판정한다. 확신할 수 없으면 "unknown"을 반환한다. */
export function classifyDamageRelated(caption: string | null, nearbyText: string | null, photoNo: string | null): boolean | "unknown" {
  const combined = `${caption ?? ""} ${nearbyText ?? ""} ${photoNo ?? ""}`;
  if (DAMAGE_KEYWORDS.some((k) => combined.includes(k))) return true;
  if (DECORATIVE_KEYWORDS.some((k) => combined.includes(k))) return false;
  return "unknown";
}

/**
 * 그레이스케일 픽셀 배열(길이 size*size, 0~255)로부터 average hash를 계산한다.
 * 이미지 리사이즈/그레이스케일 변환은 호출부(캔버스 처리)에서 수행하고,
 * 이 함수는 순수 계산만 담당해 테스트하기 쉽게 유지한다.
 */
export function averageHashFromGrayscale(pixels: number[], size = 8): string {
  if (pixels.length !== size * size) {
    throw new Error(`픽셀 배열 길이가 size*size(${size * size})와 일치해야 합니다. 실제: ${pixels.length}`);
  }
  const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
  return pixels.map((p) => (p >= mean ? "1" : "0")).join("");
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let dist = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dist++;
  return dist;
}

export interface HashedPhotoRef {
  id: string;
  hash: string;
}

/**
 * 이미지 해시가 서로 가까운 사진들을 중복 후보로 표시한다.
 * 사진번호가 같다는 이유만으로 동일 사진이라 판단하지 않고, 반대로
 * 사진번호가 달라도 이미지가 실제로 유사하면 중복 후보로 남긴다.
 */
export function detectDuplicateCandidates(photos: HashedPhotoRef[], threshold = 8): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const p of photos) result.set(p.id, []);
  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      if (hammingDistance(photos[i].hash, photos[j].hash) <= threshold) {
        result.get(photos[i].id)!.push(photos[j].id);
        result.get(photos[j].id)!.push(photos[i].id);
      }
    }
  }
  return result;
}

interface PhotoLike {
  photoNo: string | null;
  caption: string | null;
  section: string | null;
  part: StandardPart | null;
  subPart: string | null;
  location: string | null;
  damageName: string | null;
  ocrText: string | null;
  nearbyText: string | null;
  visionInference: { damageType?: string } | null;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, "");
}

/** STEP 7 매칭 가중치. 스펙 8번 기준값을 그대로 사용하고, 목록에 없는 보조 신호는 작은 가중치만 둔다. */
export const MATCH_WEIGHTS = {
  photoNoMatch: 30,
  damageNameMatch: 20,
  captionMatch: 10,
  partMatch: 5,
  subPartMatch: 15,
  locationMatch: 20,
  sectionMatch: 5,
  ocrMatch: 10,
  contextMatch: 5,
  visionMatch: 5,
  rangeContainsWeak: 5,
} as const;

/**
 * 정규화 기준(100%) — "확실한 근거들만으로 완전히 일치"했을 때 도달하는 점수.
 * OCR/문맥/Vision/범위포함은 사진번호·캡션 등 핵심 근거가 부족할 때 보조적으로만 쓰이는
 * 신호라서 기준에서 제외한다 (안 그러면 완전 일치해도 100%에 못 미치게 된다).
 */
export const MAX_MATCH_SCORE =
  MATCH_WEIGHTS.photoNoMatch +
  MATCH_WEIGHTS.damageNameMatch +
  MATCH_WEIGHTS.captionMatch +
  MATCH_WEIGHTS.partMatch +
  MATCH_WEIGHTS.subPartMatch +
  MATCH_WEIGHTS.locationMatch +
  MATCH_WEIGHTS.sectionMatch;

/**
 * STEP 7 — 사진과 손상 하나를 비교해 매칭 점수와 근거를 계산한다. 점수만으로 자동 확정하지
 * 않도록, 위치/세부부위가 서로 다르면 별도의 하드 충돌 판정(hasHardConflict)에서 걸러낸다.
 */
export function computeMatchScore(photo: PhotoLike, damage: DamageRecord): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const displayIds = [damage.id, damage.groupNo].map(norm);
  if (photo.photoNo && displayIds.includes(norm(photo.photoNo))) {
    score += MATCH_WEIGHTS.photoNoMatch;
    reasons.push("사진번호 일치");
  }
  if (photo.damageName && norm(photo.damageName) === norm(damage.damageName)) {
    score += MATCH_WEIGHTS.damageNameMatch;
    reasons.push("손상명 일치");
  }
  if (photo.caption && damage.damageName && (photo.caption.includes(damage.damageName) || (damage.subPart !== "-" && photo.caption.includes(damage.subPart)))) {
    score += MATCH_WEIGHTS.captionMatch;
    reasons.push("캡션 텍스트 일치");
  }
  if (photo.part && photo.part === damage.part) {
    score += MATCH_WEIGHTS.partMatch;
    reasons.push("부위 일치");
  }
  if (photo.subPart && norm(photo.subPart) === norm(damage.subPart)) {
    score += MATCH_WEIGHTS.subPartMatch;
    reasons.push("세부부위 일치");
  }
  const normPhotoLoc = normalizeLocationText(photo.location);
  const normDamageLoc = normalizeLocationText(damage.location);
  if (normPhotoLoc && normDamageLoc && normPhotoLoc === normDamageLoc) {
    score += MATCH_WEIGHTS.locationMatch;
    reasons.push("위치 일치");
  } else if (photo.location && damage.location && isPointWithinRange(photo.location, damage.location)) {
    score += MATCH_WEIGHTS.rangeContainsWeak;
    reasons.push("위치가 손상 범위 내에 포함 (참고용, 확정 아님)");
  }
  if (photo.section && norm(photo.section) === norm(damage.section)) {
    score += MATCH_WEIGHTS.sectionMatch;
    reasons.push("구간 일치");
  }
  const ocrHitsLocation = !!(photo.ocrText && damage.location && photo.ocrText.includes(damage.location));
  const ocrHitsSubPart = !!(photo.ocrText && damage.subPart && damage.subPart !== "-" && photo.ocrText.includes(damage.subPart));
  if (ocrHitsLocation || ocrHitsSubPart) {
    score += MATCH_WEIGHTS.ocrMatch;
    reasons.push(`OCR 텍스트 일치 (${[ocrHitsLocation && "위치", ocrHitsSubPart && "세부부위"].filter(Boolean).join(", ")})`);
  }
  if (photo.nearbyText && damage.subPart && damage.subPart !== "-" && photo.nearbyText.includes(damage.subPart)) {
    score += MATCH_WEIGHTS.contextMatch;
    reasons.push("주변 문맥에 세부부위 포함");
  }
  if (photo.visionInference?.damageType && photo.visionInference.damageType.includes(damage.damageName)) {
    score += MATCH_WEIGHTS.visionMatch;
    reasons.push("Vision 추정 손상 유형 일치 (참고용)");
  }

  return { score: Math.min(score, MAX_MATCH_SCORE), reasons };
}

/**
 * 강한 정보 충돌을 판정한다. "사진번호가 손상과 연결되어 보이거나 세부부위가 같아 보이는데
 * 위치가 다르다" 처럼, 동일 대상이라고 볼 근거(식별 앵커)가 있을 때만 충돌로 본다.
 * 애초에 서로 관련 없어 보이는 사진-손상 쌍의 위치가 다른 것은 충돌이 아니라 그냥 무관한
 * 것이므로 review로 밀어넣지 않는다 (스펙 10~13번).
 */
export function hasHardConflict(photo: PhotoLike, damage: DamageRecord): boolean {
  const idMatches = !!(photo.photoNo && [damage.id, damage.groupNo].map(norm).includes(norm(photo.photoNo)));
  const subPartMatches = !!(photo.subPart && damage.subPart !== "-" && norm(photo.subPart) === norm(damage.subPart));
  if (!idMatches && !subPartMatches) return false;

  const normPhotoLoc = normalizeLocationText(photo.location);
  const normDamageLoc = normalizeLocationText(damage.location);
  if (normPhotoLoc && normDamageLoc && normPhotoLoc !== normDamageLoc && !isPointWithinRange(photo.location, damage.location)) {
    return true;
  }
  if (idMatches && photo.subPart && damage.subPart !== "-" && norm(photo.subPart) !== norm(damage.subPart)) {
    return true;
  }
  return false;
}

export function computeMatchCandidates(photo: PhotoLike, damages: DamageRecord[], topN = 5): PhotoMatchCandidate[] {
  return damages
    .map((d) => ({ damageId: d.id, ...computeMatchScore(photo, d), conflict: hasHardConflict(photo, d) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
