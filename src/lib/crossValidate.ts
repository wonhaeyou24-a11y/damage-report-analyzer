import type {
  AdditionalDocument,
  AdditionalEvidenceCandidate,
  CandidateDamage,
  CrossValidation,
  CrossValidationConflict,
  CrossValidationEvidence,
  DamageRecord,
  StandardPart,
} from "../types";
import { normalizeLocationText } from "./photoAnalysis";

/**
 * STEP 8 — 추가자료(외관조사망도/사진대지/보수보강표/수량표 등)에서 뽑아낸 손상 후보를
 * STEP5 손상 데이터와 교차검증한다. 자료가 없으면 이 모듈은 아예 호출되지 않으며,
 * 그 경우 damage.crossValidation은 undefined로 남아 "건너뜀"을 자연스럽게 표현한다.
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
  }

  return {
    score: Math.min(score, MAX_SCORE),
    confidence: Math.min(score, MAX_SCORE) / MAX_SCORE,
    reasons,
    conflict: conflictFields.length > 0,
    conflictFields,
  };
}

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

/** damage 하나에 대해 여러 추가자료의 근거를 모아 crossValidation을 계산한다. */
function buildCrossValidationForDamage(
  damage: DamageRecord,
  documents: AdditionalDocument[],
  previousConflicts: CrossValidationConflict[]
): CrossValidation {
  const evidence: CrossValidationEvidence[] = [];
  const conflicts: CrossValidationConflict[] = [];

  for (const doc of documents) {
    if (doc.status !== "ok" || doc.candidates.length === 0) continue;
    const scored = doc.candidates.map((c) => ({ candidate: c, match: scoreCandidate(damage, c) })).sort((a, b) => b.match.score - a.match.score);
    const best = scored[0];
    if (!best || best.match.score === 0) continue;

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
          mainReport: { value: damageFieldValue(damage, field), source: "본문", page: damage.sourcePages[0] },
          additional: {
            value: additionalValue,
            source: doc.fileName,
            fileName: doc.fileName,
            sourceType: doc.sourceType,
            page: best.candidate.sourceRef.page,
          },
        });
      }
    } else if (best.match.confidence >= MATCHED_THRESHOLD) {
      evidence.push({
        sourceType: doc.sourceType,
        fileName: doc.fileName,
        result: "matched",
        sourceRef: best.candidate.sourceRef,
        reasons: best.match.reasons,
      });
    }
    // MATCHED_THRESHOLD 미만이고 충돌도 아니면 "이 자료에서는 확인 안 됨" — 부정적 신호로 쓰지 않고 그냥 건너뛴다.
  }

  // 이전 실행에서 사용자가 해결한 필드는 그대로 유지한다 (재실행해도 수동 결정 보존).
  const mergedConflicts = conflicts.map((c) => {
    const prev = previousConflicts.find((p) => p.field === c.field && p.resolved);
    return prev ? { ...c, resolved: prev.resolved } : c;
  });

  const matchedCount = evidence.filter((e) => e.result === "matched").length;
  const hasUnresolvedConflict = mergedConflicts.some((c) => !c.resolved);

  let result: CrossValidation["result"];
  let confidence: number;
  if (hasUnresolvedConflict) {
    result = "conflict";
    confidence = 0.4;
  } else if (matchedCount > 0) {
    result = "matched";
    confidence = Math.min(0.98, 0.6 + 0.15 * matchedCount);
  } else if (documents.some((d) => d.status === "ok")) {
    result = "missingInAdditional";
    confidence = 0;
  } else {
    result = "unsupported";
    confidence = 0;
  }

  return {
    enabled: true,
    result,
    confidence,
    evidenceCount: matchedCount,
    evidence,
    conflicts: mergedConflicts,
    reviewRequired: hasUnresolvedConflict,
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

  const nextDamages = damages.map((d) => ({
    ...d,
    crossValidation: buildCrossValidationForDamage(d, okDocuments, d.crossValidation?.conflicts ?? []),
  }));

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
      crossValidation: { ...d.crossValidation, conflicts, reviewRequired, result: reviewRequired ? "conflict" : "matched" },
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
