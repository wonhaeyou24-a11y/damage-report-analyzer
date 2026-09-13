import { useState } from "react";
import type { DamageRecord, ExtractedPhoto } from "../types";
import { PHOTO_STATUS_LABEL } from "../types";
import { deriveDamagePhotoLinks, manuallyLinkPhoto, manuallyUnlinkPhoto } from "../lib/matchPhotos";
import { getActiveProvider, getAiProviderStatus } from "../lib/ai/providerManager";

interface Props {
  photos: ExtractedPhoto[];
  onChange: (photos: ExtractedPhoto[]) => void;
  damages?: DamageRecord[];
  onDamagesChange?: (damages: DamageRecord[]) => void;
}

const RELATED_LABEL: Record<string, string> = {
  true: "손상사진",
  false: "손상무관",
  unknown: "분류 검토 필요",
};

const MATCH_STATUS_LABEL: Record<string, string> = {
  confirmed: "🟢 연결됨",
  review: "🟡 검토 필요",
  unmatched: "⚪ 미연결",
};

type PhotoLinkFilter = "all" | "confirmed" | "review" | "unmatched";

export default function PhotoGallery({ photos, onChange, damages = [], onDamagesChange }: Props) {
  const [detail, setDetail] = useState<ExtractedPhoto | null>(null);
  const [onlyDamageRelated, setOnlyDamageRelated] = useState(false);
  const [linkFilter, setLinkFilter] = useState<PhotoLinkFilter>("all");
  const [visionBusy, setVisionBusy] = useState<string | null>(null);

  let rows = onlyDamageRelated ? photos.filter((p) => p.damageRelated !== false) : photos;
  if (linkFilter !== "all") rows = rows.filter((p) => (p.matchStatus ?? "unmatched") === linkFilter);

  const updatePhoto = (id: string, patch: Partial<ExtractedPhoto>) => {
    onChange(photos.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setDetail((d) => (d && d.id === id ? { ...d, ...patch } : d));
  };

  const runVision = async (photo: ExtractedPhoto) => {
    const aiStatus = getAiProviderStatus();
    if (!aiStatus.ready) {
      alert(`AI 분석을 실행할 수 없습니다. ${aiStatus.reason ?? ""}`);
      return;
    }
    setVisionBusy(photo.id);
    try {
      const inference = await getActiveProvider().analyzeImage(photo.image.dataUrl, photo.nearbyText ?? photo.caption ?? "");
      updatePhoto(photo.id, { visionInference: inference });
    } catch (err: any) {
      alert(`Vision 분석 실패: ${err.message ?? String(err)}`);
    } finally {
      setVisionBusy(null);
    }
  };

  // STEP 7: 사진 목록에서도 손상을 수동으로 연결/해제할 수 있게 한다.
  const linkTo = (photoId: string, damageId: string) => {
    const nextPhotos = manuallyLinkPhoto(photos, photoId, damageId);
    onChange(nextPhotos);
    setDetail(nextPhotos.find((p) => p.id === photoId) ?? null);
    if (onDamagesChange) onDamagesChange(deriveDamagePhotoLinks(damages, nextPhotos));
  };

  const unlinkFrom = (photoId: string, damageId: string) => {
    const nextPhotos = manuallyUnlinkPhoto(photos, photoId, damageId);
    onChange(nextPhotos);
    setDetail(nextPhotos.find((p) => p.id === photoId) ?? null);
    if (onDamagesChange) onDamagesChange(deriveDamagePhotoLinks(damages, nextPhotos));
  };

  if (photos.length === 0) {
    return <p className="empty-state">추출된 사진이 없습니다. PDF 분석 시 자동으로 사진 후보를 추출합니다.</p>;
  }

  return (
    <div className="photo-gallery">
      <div className="toolbar">
        <label className="checkbox">
          <input type="checkbox" checked={onlyDamageRelated} onChange={(e) => setOnlyDamageRelated(e.target.checked)} />
          손상관련(손상사진/검토) 사진만 보기
        </label>
        <label className="checkbox">
          연결 상태
          <select value={linkFilter} onChange={(e) => setLinkFilter(e.target.value as PhotoLinkFilter)}>
            <option value="all">전체</option>
            <option value="confirmed">연결됨</option>
            <option value="review">검토 필요</option>
            <option value="unmatched">미연결 사진</option>
          </select>
        </label>
        <span className="status-line">
          전체 {photos.length}건 · 손상사진 {photos.filter((p) => p.damageRelated === true).length}건 · 검토필요{" "}
          {photos.filter((p) => p.damageRelated === "unknown" || p.status === "review").length}건 · 중복후보{" "}
          {photos.filter((p) => p.duplicateCandidate).length}건
        </span>
      </div>

      <table className="photo-table">
        <thead>
          <tr>
            <th>사진번호</th>
            <th>페이지</th>
            <th>캡션</th>
            <th>위치</th>
            <th>손상관련성</th>
            <th>중복후보</th>
            <th>손상연결</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} onClick={() => setDetail(p)} className="clickable-row">
              <td>{p.photoNo ?? "-"}</td>
              <td>{p.page}</td>
              <td>{p.caption ?? "-"}</td>
              <td>{p.location ?? "-"}</td>
              <td>{RELATED_LABEL[String(p.damageRelated)]}</td>
              <td>{p.duplicateCandidate ? `⚠ ${p.duplicateOfIds.join(", ")}` : "-"}</td>
              <td>
                {MATCH_STATUS_LABEL[p.matchStatus ?? "unmatched"]}
                {p.linkedDamageIds.length > 0 ? ` (${p.linkedDamageIds.join(", ")})` : ""}
              </td>
              <td>{PHOTO_STATUS_LABEL[p.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>사진 상세 — {detail.photoNo ?? detail.id}</h3>
            {detail.image.dataUrl && <img src={detail.image.dataUrl} alt={detail.caption ?? detail.id} style={{ maxWidth: "100%", borderRadius: 4 }} />}
            <p>
              <strong>출처</strong>: {detail.sourceFile} p.{detail.page}
              {detail.sourceRef.quote ? ` — "${detail.sourceRef.quote}"` : ""}
            </p>
            <p>
              <strong>캡션</strong>: {detail.caption ?? "-"}
            </p>
            <p>
              <strong>주변 문맥</strong>: {detail.nearbyText ?? "-"}
            </p>
            <p>
              <strong>OCR</strong>: {detail.ocrText ?? "-"}
              {detail.ocrConfidence != null ? ` (신뢰도 ${(detail.ocrConfidence * 100).toFixed(0)}%)` : ""}
            </p>
            <p>
              <strong>Vision 추정(참고용, 원문 사실 아님)</strong>:{" "}
              {detail.visionInference
                ? `${detail.visionInference.damageType ?? "-"} / ${detail.visionInference.facility ?? "-"} (신뢰도 ${(detail.visionInference.confidence * 100).toFixed(0)}%)`
                : "미실행"}
            </p>
            <button onClick={() => runVision(detail)} disabled={visionBusy === detail.id}>
              {visionBusy === detail.id ? "분석 중..." : "Vision 분석 실행"}
            </button>

            <h4>연결된 손상 ({detail.linkedDamageIds.length})</h4>
            <ul>
              {detail.linkedDamageIds.map((id) => (
                <li key={id}>
                  {id}{" "}
                  <button className="link-btn danger" onClick={() => unlinkFrom(detail.id, id)}>
                    연결 해제
                  </button>
                </li>
              ))}
              {detail.linkedDamageIds.length === 0 && <li>연결된 손상이 없습니다 ({MATCH_STATUS_LABEL[detail.matchStatus ?? "unmatched"]}).</li>}
            </ul>

            {detail.matchCandidates.filter((c) => !detail.linkedDamageIds.includes(c.damageId)).length > 0 && (
              <>
                <h4>연결 후보 (확정 아님)</h4>
                <ul>
                  {detail.matchCandidates
                    .filter((c) => !detail.linkedDamageIds.includes(c.damageId))
                    .map((c) => (
                      <li key={c.damageId}>
                        {c.damageId} — 점수 {c.score} ({c.reasons.join(", ")}){c.conflict ? " ⚠ 정보 충돌" : ""}{" "}
                        <button onClick={() => linkTo(detail.id, c.damageId)}>이 손상에 연결</button>
                      </li>
                    ))}
                </ul>
              </>
            )}

            <button onClick={() => setDetail(null)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
