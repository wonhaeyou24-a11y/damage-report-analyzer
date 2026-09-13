import type {
  AdditionalDocument,
  AdditionalEvidenceCandidate,
  CandidateDamage,
  CrossValidation,
  CrossValidationConflict,
  CrossValidationEnrichment,
  CrossValidationEvidence,
  CrossValidationFieldStatus,
  DamageRecord,
  StandardPart,
} from "../types";
import { normalizeLocationText } from "./photoAnalysis";

/**
 * STEP 8 — 추가자료(외관조사망도/사진대지/보수보강표/수량표 등)에서 뽑아낸 손상 후보를
 * STEP5 손상 데이터와 교차검증한다. 자료가 없으면 이 모듈은 아예 호출되지 않으며,
 * 그 경우 damage.crossValidation은 undefined로 남아 "건너뜀"을 자연스럽게 표현한다.
 *
 * STEP 8 확장(2026-09) — "정리/비교"에서 "기존 손상 보완"으로: 매칭된 추가자료 근거 중
 * 세부부위/사진번호 같은 식별 앵커가 있는 것만, 그리고 damage의 해당 필드가 정말 비어 있을
 * 때만 그 값을 채운다(enrichment). 이미 값이 있으면(같든 다르든) 자동으로 바꾸지 않고, 값이
 * 다르면 conflict로만 남겨 사용자 판단에 맡긴다. 사용자가 fieldOverrides로 이미 손댄 필드는
 * enrichment 대상에서 완전히 제외한다 — 수동 수정값이 항상 최우선이다.
 */

const WEIGHTS = {
  damageNameMatch: 20,
  subPartMatch: 15,
  locationMatch: 20,
  sectionMatch: 10,
  partMatch: 5,
  repairMethodMatch: 10,
  quantityMatch: 10,
  photoNoMatch: 10,
};

const MAX_SCORE = Object.values(WEIGHTS).reduce((a, b) => a + b, 0); // 100

const MATCHED_THRESHOLD = 0.6;

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, "");
}

interface ScoredMatch {
  score: number;
  confidence: number;
  reasons: string[];
  conflict: boolean;
  conflictFields: Array<"damageName" | "location" | "repairMethod" | "quantity">;
  /** 세부부위 또는 사진번호처럼 "같은 대상"임을 특정하는 강한 단서가 있었는지 — 이게 있어야만
   * conflict 판정을 신뢰할 수 있다(기존 동작 그대로 유지). */
  anchor: boolean;
  /** enrichment(빈 필드 보완) 전용 앵커 — anchor에 더해 위치 일치도 포함한다. 세부부위 자체가
   * 비어 있어 채워야 하는 경우, 위치가 정확히 같다는 것도 "같은 대상"이라는 충분한 근거가
   * 된다(spec 10번 예시: subPart가 없을 때 location 일치만으로 subPart를 보완). */
  enrichAnchor: boolean;
}

function scoreCandidate(damage: DamageRecord, c: AdditionalEvidenceCandidate): ScoredMatch {
  let score = 0;
  const reasons: string[] = [];

  if (c.damageName && norm(c.damageName) === norm(damage.damageName)) {
    score += WEIGHTS.damageNameMatch;
    reasons.push("손상명 일치");
  }
  if (c.subPart && norm(c.subPart) === norm(damage.subPart)) {
    score += WEIGHTS.subPartMatch;
    reasons.push("세부부위 일치");
  }
  const normCLoc = normalizeLocationText(c.location);
  const normDLoc = normalizeLocationText(damage.location);
  if (normCLoc && normDLoc && normCLoc === normDLoc) {
    score += WEIGHTS.locationMatch;
    reasons.push("위치 일치");
  }
  if (c.section && norm(c.section) === norm(damage.section)) {
    score += WEIGHTS.sectionMatch;
    reasons.push("구간 일치");
  }
  if (c.part && c.part === damage.part) {
    score += WEIGHTS.partMatch;
    reasons.push("부위 일치");
  }
  if (c.repairMethod && norm(c.repairMethod) === norm(damage.repairMethod)) {
    score += WEIGHTS.repairMethodMatch;
    reasons.push("보수방안 일치");
  }
  if (c.quantity && damage.quantityGroup && norm(c.quantity) === norm(damage.quantityGroup)) {
    score += WEIGHTS.quantityMatch;
    reasons.push("수량(그룹 합계) 일치");
  } else if (c.quantity && damage.quantity && norm(c.quantity) === norm(damage.quantity)) {
    score += WEIGHTS.quantityMatch;
    reasons.push("수량(개별) 일치");
  }
  if (c.photoNo && [damage.id, damage.groupNo].map(norm).includes(norm(c.photoNo))) {
    score += WEIGHTS.photoNoMatch;
    reasons.push("사진번호 일치");
  }

  // 식별 앵커(세부부위 또는 사진번호)가 있어야만 값 차이를 "충돌"로 본다. 손상명/구간처럼
  // 여러 손상이 공유하기 쉬운 값만 같다고 해서 동일 대상으로 보지 않는다 — 그러면 무관한
  // 후보끼리도 위치가 다르다는 이유만으로 거짓 충돌이 발생한다.
  const anchor =
    (!!c.subPart && norm(c.subPart) === norm(damage.subPart)) ||
    (!!c.photoNo && [damage.id, damage.groupNo].map(norm).includes(norm(c.photoNo)));

  const conflictFields: ScoredMatch["conflictFields"] = [];
  if (anchor) {
    if (normCLoc && normDLoc && normCLoc !== normDLoc) conflictFields.push("location");
    if (c.damageName && damage.damageName && norm(c.damageName) !== norm(damage.damageName)) conflictFields.push("damageName");
    if (c.repairMethod && damage.repairMethod && norm(c.repairMethod) !== norm(damage.repairMethod)) conflictFields.push("repairMethod");
    // 규모(개별)는 그룹 합계와 별개로, 이미 개별 물량이 명시된 손상끼리만 값 차이를 충돌로 본다.
    if (c.quantity && damage.quantity && norm(c.quantity) !== norm(damage.quantity)) conflictFields.push("quantity");
  }

  const locMatch = !!normCLoc && !!normDLoc && normCLoc === normDLoc;

  return {
    score: Math.min(score, MAX_SCORE),
    confidence: Math.min(score, MAX_SCORE) / MAX_SCORE,
    reasons,
    conflict: conflictFields.length > 0,
    conflictFields,
    anchor,
    enrichAnchor: anchor || locMatch,
  };
}

/** enrichment 대상 필드 — 위치는 손상을 특정하는 핵심 앵커라 보수적으로 다루기 위해 제외하고,
 * 이미 거의 항상 채워져 있는 값이라 실질적으로 비어 있는 경우가 드물다(spec 11번 참고). */
const ENRICHABLE_FIELDS = ["damageName", "subPart", "quantity", "repairMethod"] as const;
type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

function isBlank(v: string | null | undefined): boolean {
  if (v == null) return true;
  const t = v.trim();
  return t === "" || t === "-";
}

function candidateFieldValue(c: AdditionalEvidenceCandidate, field: EnrichableField): string | null {
  switch (field) {
    case "damageName":
      return c.damageName;
    case "subPart":
      return c.subPart;
    case "quantity":
      return c.quantity;
    case "repairMethod":
      return c.repairMethod;
  }
}

const REASON_FIELD: Array<{ match: string; field: CrossValidationConflict["field"] }> = [
  { match: "손상명", field: "damageName" },
  { match: "세부부위", field: "subPart" },
  { match: "위치", field: "location" },
  { match: "구간", field: "section" },
  { match: "부위", field: "part" }, // "세부부위"보다 뒤에 두어 먼저 매칭되지 않도록 함
  { match: "보수방안", field: "repairMethod" },
  { match: "수량", field: "quantity" },
];

function fieldValueOf(candidate: AdditionalEvidenceCandidate, field: CrossValidationConflict["field"]): string | null {
  switch (field) {
    case "damageName":
      return candidate.damageName;
    case "location":
      return candidate.location;
    case "repairMethod":
      return candidate.repairMethod;
    case "quantity":
      return candidate.quantity;
    case "part":
      return candidate.part;
    case "subPart":
      return candidate.subPart;
    case "section":
      return candidate.section;
  }
}

function damageFieldValue(damage: DamageRecord, field: CrossValidationConflict["field"]): string {
  switch (field) {
    case "damageName":
      return damage.damageName;
    case "location":
      return damage.location;
    case "repairMethod":
      return damage.repairMethod;
    case "quantity":
      return damage.quantity ?? damage.quantityGroup ?? "";
    case "part":
      return damage.part;
    case "subPart":
      return damage.subPart;
    case "section":
      return damage.section;
  }
}

interface DamageValidationResult {
  crossValidation: CrossValidation;
  /** 비어 있던 필드만 채워진다 — 값이 있던 필드는 절대 여기 담기지 않는다. */
  enrichedFields: Partial<Pick<DamageRecord, "damageName" | "subPart" | "quantity" | "repairMethod">>;
}

/** damage 하나에 대해 여러 추가자료의 근거를 모아 crossValidation을 계산하고, 비어 있던
 * 필드를 안전하게 보완한다(spec 6~9번 — 값이 있으면 절대 자동으로 바꾸지 않는다). */
function buildCrossValidationForDamage(
  damage: DamageRecord,
  documents: AdditionalDocument[],
  previousConflicts: CrossValidationConflict[],
  previousEnrichments: CrossValidationEnrichment[]
): DamageValidationResult {
  const evidence: CrossValidationEvidence[] = [];
  const conflicts: CrossValidationConflict[] = [];
  const newEnrichments: CrossValidationEnrichment[] = [];
  const matchedFields = new Set<CrossValidationConflict["field"]>();
  let groupQuantityConfirmed = damage.crossValidation?.groupQuantityConfirmed === true;

  // 사용자가 fieldOverrides로 이미 확정한 필드는 enrichment 대상에서 완전히 제외한다 — 수동
  // 수정값이 항상 최우선이다(spec 5/25번).
  const lockedFields = new Set((damage.fieldOverrides ?? []).map((o) => o.field));

  // 이번 실행 안에서 여러 추가자료가 같은 손상을 다룰 수 있으므로, 채워진 값을 즉시 반영해
  // 다음 자료가 "이미 채워진 값"을 기준으로 확인/충돌 판단을 하도록 누적한다. damage 원본은
  // 건드리지 않는다.
  const working: Pick<DamageRecord, "damageName" | "subPart" | "quantity" | "repairMethod"> = {
    damageName: damage.damageName,
    subPart: damage.subPart,
    quantity: damage.quantity,
    repairMethod: damage.repairMethod,
  };

  for (const doc of documents) {
    if (doc.status !== "ok" || doc.candidates.length === 0) continue;
    const workingDamage: DamageRecord = { ...damage, ...working };
    const scored = doc.candidates
      .map((c) => ({ candidate: c, match: scoreCandidate(workingDamage, c) }))
      .sort((a, b) => b.match.score - a.match.score);
    const best = scored[0];
    if (!best || best.match.score === 0) continue;

    // reasons는 필드별로 독립적으로 매겨진다(예: 보수방안만 다르고 위치는 일치) — conflict
    // 여부와 무관하게 "실제로 일치가 확인된 필드"는 항상 반영해 필드별 상태를 보존한다.
    for (const r of best.match.reasons) {
      const hit = REASON_FIELD.find((rf) => r.includes(rf.match));
      if (hit) matchedFields.add(hit.field);
    }

    if (best.match.conflict) {
      evidence.push({
        sourceType: doc.sourceType,
        fileName: doc.fileName,
        result: "conflict",
        sourceRef: best.candidate.sourceRef,
        reasons: best.match.reasons,
      });
      for (const field of best.match.conflictFields) {
        const additionalValue = fieldValueOf(best.candidate, field);
        if (additionalValue == null) continue;
        conflicts.push({
          field,
          mainReport: { value: damageFieldValue(workingDamage, field), source: "본문", page: damage.sourcePages[0] },
          additional: {
            value: additionalValue,
            source: doc.fileName,
            fileName: doc.fileName,
            sourceType: doc.sourceType,
            page: best.candidate.sourceRef.page,
          },
        });
      }
      continue; // 충돌이 감지된 후보는 보완의 근거로 쓰지 않는다.
    }

    if (best.match.confidence < MATCHED_THRESHOLD) continue; // 이 자료에서는 확인 안 됨 — 부정적 신호로 쓰지 않고 건너뛴다.

    evidence.push({
      sourceType: doc.sourceType,
      fileName: doc.fileName,
      result: "matched",
      sourceRef: best.candidate.sourceRef,
      reasons: best.match.reasons,
    });

    // 그룹 합계 물량이 추가자료에서도 동일하게 확인된 경우 — 개별 quantity 필드에는 절대
    // 복사하지 않고(spec 12번), "확인됨" 표시만 남긴다.
    if (best.candidate.quantity && damage.quantityGroup && norm(best.candidate.quantity) === norm(damage.quantityGroup)) {
      groupQuantityConfirmed = true;
    }

    if (!best.match.enrichAnchor) continue; // 식별 앵커(세부부위/사진번호/위치) 없이는 필드를 채우지 않는다.

    for (const field of ENRICHABLE_FIELDS) {
      if (lockedFields.has(field)) continue;
      if (!isBlank(working[field])) continue; // 이미 값이 있으면(같든 다르든) 자동으로 채우지 않는다.
      if (field === "quantity" && damage.quantityGroup) continue; // 그룹 합계가 있는 손상의 개별 물량은 보완 대상이 아니다.
      const cValue = candidateFieldValue(best.candidate, field);
      if (cValue == null || isBlank(cValue)) continue;

      working[field] = cValue;
      newEnrichments.push({
        field,
        value: cValue,
        fileName: doc.fileName,
        sourceType: doc.sourceType,
        sourceRef: best.candidate.sourceRef,
        appliedAt: new Date().toISOString(),
      });
    }
  }

  // 이전 실행에서 사용자가 해결한 필드는 그대로 유지한다 (재실행해도 수동 결정 보존).
  const mergedConflicts = conflicts.map((c) => {
    const prev = previousConflicts.find((p) => p.field === c.field && p.resolved);
    return prev ? { ...c, resolved: prev.resolved } : c;
  });

  // 과거 실행에서 채운 필드는 이번 실행에서 재도출되지 않아도(자료가 빠졌거나 이미 채워져
  // 대상에서 제외됐거나) 이력으로 계속 남는다 — 재분석해도 보완 이력을 지우지 않는다(spec 26번).
  const enrichments = [...previousEnrichments, ...newEnrichments];

  const matchedCount = evidence.filter((e) => e.result === "matched").length;
  const hasUnresolvedConflict = mergedConflicts.some((c) => !c.resolved);

  let result: CrossValidation["result"];
  let confidence: number;
  if (hasUnresolvedConflict) {
    result = "conflict";
    confidence = 0.4;
  } else if (matchedCount > 0) {
    result = "matched";
    // 독립적인 근거(문서 수)가 많을수록, 그리고 비어 있던 필드를 실제로 보완했을수록 신뢰도가
    // 오른다 — 그러나 "자료가 많다 = 무조건 높다"가 되지 않도록 여전히 0.98로 상한을 둔다.
    confidence = Math.min(0.98, 0.6 + 0.15 * matchedCount + 0.02 * newEnrichments.length);
  } else if (documents.some((d) => d.status === "ok")) {
    result = "missingInAdditional";
    confidence = 0;
  } else {
    result = "unsupported";
    confidence = 0;
  }

  const fieldValidation: CrossValidation["fieldValidation"] = {};
  const FIELDS: CrossValidationConflict["field"][] = ["damageName", "part", "subPart", "location", "quantity", "repairMethod", "section"];
  for (const field of FIELDS) {
    const unresolvedConflict = mergedConflicts.some((c) => c.field === field && !c.resolved);
    const resolvedConflict = mergedConflicts.some((c) => c.field === field && c.resolved);
    const wasEnriched = enrichments.some((e) => e.field === field);
    let status: CrossValidationFieldStatus | undefined;
    if (unresolvedConflict) status = "conflict";
    else if (wasEnriched) status = "enriched";
    else if (resolvedConflict || matchedFields.has(field) || (field === "quantity" && groupQuantityConfirmed)) status = "matched";
    if (status) fieldValidation[field] = status;
  }

  return {
    crossValidation: {
      enabled: true,
      result,
      confidence,
      evidenceCount: matchedCount,
      evidence,
      conflicts: mergedConflicts,
      reviewRequired: hasUnresolvedConflict,
      enrichments,
      fieldValidation,
      groupQuantityConfirmed,
    },
    enrichedFields: Object.fromEntries(newEnrichments.map((e) => [e.field, working[e.field]])),
  };
}

let candidateIdCounter = 0;
function nextCandidateId(): string {
  candidateIdCounter += 1;
  return `CAND-${String(candidateIdCounter).padStart(3, "0")}`;
}

/**
 * 후보가 기존 손상 중 "같은 대상일 가능성"이 있는지 판단한다. 세부부위·위치·사진번호처럼
 * 대상을 특정하는 강한 필드가 하나라도 겹치면 이미 존재하는 손상으로 보고, 손상명/구간처럼
 * 여러 손상이 흔히 공유하는 약한 필드만 같은 것은 "같은 대상"의 근거로 보지 않는다.
 */
function isPlausiblySameDamage(damage: DamageRecord, c: AdditionalEvidenceCandidate): boolean {
  const subPartMatch = !!c.subPart && norm(c.subPart) === norm(damage.subPart);
  const locMatch = !!normalizeLocationText(c.location) && normalizeLocationText(c.location) === normalizeLocationText(damage.location);
  const photoNoMatch = !!c.photoNo && [damage.id, damage.groupNo].map(norm).includes(norm(c.photoNo));
  return subPartMatch || locMatch || photoNoMatch;
}

/**
 * 추가자료에서 나왔지만 어떤 기존 손상과도 겹치지 않는 후보들을 "누락 가능성" 후보로
 * 모은다. 즉시 확정 추가하지 않고 사용자 승인을 기다리는 상태로 둔다.
 */
function collectUnmatchedCandidates(damages: DamageRecord[], documents: AdditionalDocument[]): CandidateDamage[] {
  const leftovers: { doc: AdditionalDocument; candidate: AdditionalEvidenceCandidate }[] = [];

  for (const doc of documents) {
    if (doc.status !== "ok") continue;
    for (const candidate of doc.candidates) {
      if (!candidate.damageName && !candidate.location) continue; // 최소한의 근거도 없으면 후보로 만들지 않는다.
      const matchesExisting = damages.some((d) => isPlausiblySameDamage(d, candidate));
      if (!matchesExisting) leftovers.push({ doc, candidate });
    }
  }

  // 동일 자료 종류 + 손상명 + 세부부위 + 위치가 같은 후보는 중복 생성하지 않고 하나로 합친다.
  const seen = new Map<string, CandidateDamage>();
  for (const { doc, candidate } of leftovers) {
    const key = `${doc.sourceType}|${norm(candidate.damageName)}|${norm(candidate.subPart)}|${normalizeLocationText(candidate.location)}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      id: nextCandidateId(),
      sourceType: doc.sourceType,
      fileName: doc.fileName,
      damageName: candidate.damageName,
      part: candidate.part as StandardPart | null,
      subPart: candidate.subPart,
      location: candidate.location,
      repairMethod: candidate.repairMethod,
      quantity: candidate.quantity,
      section: candidate.section,
      sourceRef: candidate.sourceRef,
      status: "review",
    });
  }
  return Array.from(seen.values());
}

export interface CrossValidationRunResult {
  damages: DamageRecord[];
  candidateDamages: CandidateDamage[];
}

/**
 * STEP 8 진입점. 추가자료가 없으면 호출하지 않는 것을 권장한다(호출 시에도 안전하게
 * "확인 대상 없음"으로 처리되지만, 그 경우 damage.crossValidation은 그대로 두는 것이
 * "건너뜀" 의미를 더 분명히 전달한다).
 */
export function runCrossValidation(damages: DamageRecord[], documents: AdditionalDocument[]): CrossValidationRunResult {
  candidateIdCounter = 0;
  const okDocuments = documents; // 실패한 문서는 buildCrossValidationForDamage 내부에서 자연히 제외됨

  const nextDamages = damages.map((d) => {
    const { crossValidation, enrichedFields } = buildCrossValidationForDamage(
      d,
      okDocuments,
      d.crossValidation?.conflicts ?? [],
      d.crossValidation?.enrichments ?? []
    );
    return { ...d, ...enrichedFields, crossValidation };
  });

  const candidateDamages = collectUnmatchedCandidates(damages, okDocuments);

  return { damages: nextDamages, candidateDamages };
}

/** 사용자가 불일치를 해결한다 — 기본값 유지 / 추가자료 값 채택 / 직접 수정 모두 이 함수로 처리한다. */
export function resolveCrossValidationConflict(
  damages: DamageRecord[],
  damageId: string,
  field: CrossValidationConflict["field"],
  value: string,
  reason?: string
): DamageRecord[] {
  return damages.map((d) => {
    if (d.id !== damageId || !d.crossValidation) return d;
    const conflicts = d.crossValidation.conflicts.map((c) =>
      c.field === field ? { ...c, resolved: { value, source: "manual" as const, reason, decidedAt: new Date().toISOString() } } : c
    );
    const reviewRequired = conflicts.some((c) => !c.resolved);
    const updatedField = applyFieldValue(d, field, value);
    return {
      ...updatedField,
      crossValidation: {
        ...d.crossValidation,
        conflicts,
        reviewRequired,
        result: reviewRequired ? "conflict" : "matched",
        // 사용자가 직접 판단해 확정했으므로 이 필드는 더 이상 "충돌"이 아니라 "확인됨"이다.
        fieldValidation: { ...d.crossValidation.fieldValidation, [field]: "matched" },
      },
    };
  });
}

function applyFieldValue(d: DamageRecord, field: CrossValidationConflict["field"], value: string): DamageRecord {
  switch (field) {
    case "damageName":
      return { ...d, damageName: value };
    case "part":
      return { ...d, part: value as StandardPart };
    case "subPart":
      return { ...d, subPart: value };
    case "location":
      return { ...d, location: value };
    case "quantity":
      return { ...d, quantity: value };
    case "repairMethod":
      return { ...d, repairMethod: value };
    case "section":
      return { ...d, section: value };
  }
}

/** 후보 손상을 사용자가 승인하면 정식 DamageRecord로 승격시킨다. */
export function approveCandidateDamage(damages: DamageRecord[], candidateDamages: CandidateDamage[], candidateId: string): CrossValidationRunResult {
  const candidate = candidateDamages.find((c) => c.id === candidateId);
  if (!candidate) return { damages, candidateDamages };

  // STEP 9 — 승인 전 기존 손상과 중복인지 확인한다(구간+손상명+부위+세부부위+위치). 손상명이
  // 같아도 위치가 다르면 별도 손상으로 유지하고, 절대 자동 병합하지 않는다.
  const duplicate = damages.find(
    (d) =>
      norm(d.section) === norm(candidate.section) &&
      norm(d.damageName) === norm(candidate.damageName) &&
      d.part === (candidate.part ?? d.part) &&
      norm(d.subPart) === norm(candidate.subPart) &&
      normalizeLocationText(d.location) === normalizeLocationText(candidate.location)
  );
  if (duplicate) {
    const withEvidence = damages.map((d) =>
      d.id === duplicate.id
        ? {
            ...d,
            sourceReferences: [
              ...d.sourceReferences,
              { page: candidate.sourceRef.page ?? 0, type: candidate.sourceType, excerpt: candidate.sourceRef.quote },
            ],
          }
        : d
    );
    return { damages: withEvidence, candidateDamages: candidateDamages.filter((c) => c.id !== candidateId) };
  }

  const newDamage: DamageRecord = {
    id: candidate.id,
    groupNo: "-",
    groupIndex: 1,
    section: candidate.section ?? "",
    damageName: candidate.damageName ?? "",
    part: candidate.part ?? "기타",
    subPart: candidate.subPart ?? "-",
    location: candidate.location ?? "",
    repairMethod: candidate.repairMethod ?? "",
    quantity: candidate.quantity,
    quantityGroup: null,
    photos: [],
    status: "review",
    sourcePages: candidate.sourceRef.page ? [candidate.sourceRef.page] : [],
    sourceReferences: [{ page: candidate.sourceRef.page ?? 0, type: candidate.sourceType, excerpt: candidate.sourceRef.quote }],
    notes: `추가자료(${candidate.fileName})에서 발견되어 사용자가 승인한 손상`,
  };

  return {
    damages: [...damages, newDamage],
    candidateDamages: candidateDamages.filter((c) => c.id !== candidateId),
  };
}
