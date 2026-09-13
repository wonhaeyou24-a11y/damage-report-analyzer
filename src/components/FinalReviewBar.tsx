import { useMemo, useState } from "react";
import type { CandidateDamage, DamageRecord, ExtractedPhoto, ReviewSession } from "../types";
import { canFinalize, computeReviewCounts, finalizeReview, markReviewCompleted } from "../lib/finalReview";
import { matchPhotosToDamages } from "../lib/matchPhotos";
import { runCrossValidation } from "../lib/crossValidate";
import type { AdditionalDocument } from "../types";
import type { ReviewFilter } from "./DamageTable";

interface Props {
  session: ReviewSession;
  onSessionChange: (session: ReviewSession) => void;
  records: DamageRecord[];
  onRecordsChange: (records: DamageRecord[]) => void;
  photos: ExtractedPhoto[];
  onPhotosChange: (photos: ExtractedPhoto[]) => void;
  documents: AdditionalDocument[];
  candidateDamages: CandidateDamage[];
  onFilterSelect: (filter: ReviewFilter) => void;
}

/**
 * STEP 9 — 최종 검토/검수 상단 바. STEP1~8이 이미 계산해 둔 damageRecords/photoRecords/
 * additionalDocuments/candidateDamages를 그대로 재사용하고, 새 데이터 구조를 만들지 않는다.
 */
export default function FinalReviewBar({
  session,
  onSessionChange,
  records,
  onRecordsChange,
  photos,
  onPhotosChange,
  documents,
  candidateDamages,
  onFilterSelect,
}: Props) {
  const [checkResult, setCheckResult] = useState<{ ok: boolean; reasons: string[] } | null>(null);
  const counts = useMemo(() => computeReviewCounts(records, photos, candidateDamages), [records, photos, candidateDamages]);

  const reanalyze = () => {
    // STEP7/9: 사용자가 수동으로 결정한 사진 연결(manualOverride)/필드값(fieldOverrides)/
    // 해결된 교차검증 충돌(resolved)은 그대로 보존한 채 나머지만 다시 계산한다.
    const matched = matchPhotosToDamages(records, photos);
    const okDocs = documents.filter((d) => d.status === "ok");
    const finalDamages = okDocs.length > 0 ? runCrossValidation(matched.damages, documents).damages : matched.damages;
    onRecordsChange(finalDamages);
    onPhotosChange(matched.photos);
  };

  const completeReview = () => {
    onSessionChange(markReviewCompleted(session));
  };

  const finalize = () => {
    const check = canFinalize(records, candidateDamages);
    setCheckResult(check);
    if (!check.ok) return;
    onSessionChange(finalizeReview(session));
  };

  const canFinalizeNow = session.finalReviewStatus !== "in_progress";

  return (
    <div className="final-review-bar">
      <div className="final-review-header">
        <h2>최종 검토/검수</h2>
        <div className="final-review-meta">
          <input placeholder="보고서명" value={session.reportName} onChange={(e) => onSessionChange({ ...session, reportName: e.target.value })} />
          <input placeholder="시설물" value={session.facilityName} onChange={(e) => onSessionChange({ ...session, facilityName: e.target.value })} />
          <input
            placeholder="시설물 유형 (예: 비탈면/옹벽/교량/터널)"
            value={session.facilityType}
            onChange={(e) => onSessionChange({ ...session, facilityType: e.target.value })}
          />
          <span className="review-status-badge">
            분석 상태: {session.finalReviewStatus === "in_progress" ? "진행중" : session.finalReviewStatus === "completed" ? "검수완료" : "최종확정됨"}
          </span>
        </div>
        <div className="final-review-actions">
          <button onClick={reanalyze}>재분석</button>
          <button onClick={completeReview} disabled={session.finalReviewStatus === "finalized"}>
            검수 완료
          </button>
          <button onClick={finalize} disabled={!canFinalizeNow || session.finalReviewStatus === "finalized"}>
            최종 확정
          </button>
        </div>
      </div>

      <div className="final-review-counts">
        <button onClick={() => onFilterSelect("all")}>전체 손상 {counts.total}건</button>
        <button onClick={() => onFilterSelect("confirmed")}>검수 완료 {counts.confirmed}건</button>
        <button onClick={() => onFilterSelect("review")}>검수 필요 {counts.needsReview}건</button>
        <button onClick={() => onFilterSelect("conflict")}>충돌 {counts.conflict}건</button>
        <button onClick={() => onFilterSelect("all")}>후보 {counts.candidate}건 (추가자료 패널 참고)</button>
        <button onClick={() => onFilterSelect("noPhoto")}>사진 없음 {counts.noPhoto}건</button>
        <button onClick={() => onFilterSelect("photoReview")}>미연결 사진 {counts.unlinkedPhotos}건</button>
      </div>

      {checkResult && !checkResult.ok && (
        <div className="final-review-check-fail">
          <strong>최종 확정 불가 — 아래 항목을 먼저 해결하세요:</strong>
          <ul>
            {checkResult.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {session.finalReviewStatus === "finalized" && (
        <p className="status-line">
          ✅ 최종 확정됨 — {session.finalizedAt ? new Date(session.finalizedAt).toLocaleString() : ""} ({session.finalizedBy}, v{session.reviewVersion})
        </p>
      )}
    </div>
  );
}
