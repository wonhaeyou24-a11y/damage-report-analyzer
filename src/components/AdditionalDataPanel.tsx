import { useState } from "react";
import type { AdditionalDocument, CandidateDamage, DamageRecord } from "../types";
import { loadAdditionalDocuments } from "../lib/additionalDocs/loadDocuments";
import { approveCandidateDamage, runCrossValidation } from "../lib/crossValidate";
import { deferCandidateDamage, excludeCandidateDamage } from "../lib/finalReview";

interface Props {
  damages: DamageRecord[];
  onDamagesChange: (damages: DamageRecord[]) => void;
  documents: AdditionalDocument[];
  onDocumentsChange: (documents: AdditionalDocument[]) => void;
  candidateDamages: CandidateDamage[];
  onCandidateDamagesChange: (candidates: CandidateDamage[]) => void;
}

export default function AdditionalDataPanel({
  damages,
  onDamagesChange,
  documents,
  onDocumentsChange,
  candidateDamages,
  onCandidateDamagesChange,
}: Props) {
  const [enabled, setEnabled] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [hasRun, setHasRun] = useState(false);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setPendingFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const removePendingFile = (name: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const attachAndParse = async () => {
    if (pendingFiles.length === 0) return;
    setBusy(true);
    setStatus("추가자료 분석 중... (형식별로 순차 처리)");
    try {
      const parsed = await loadAdditionalDocuments(pendingFiles);
      onDocumentsChange([...documents, ...parsed]);
      setPendingFiles([]);
      const failed = parsed.filter((d) => d.status === "failed").length;
      setStatus(`추가자료 ${parsed.length}건 첨부 완료${failed > 0 ? ` (${failed}건 분석 실패, 나머지는 정상)` : ""}. "교차검증 시작"을 눌러 검증하세요.`);
    } catch (err: any) {
      setStatus(`추가자료 처리 중 오류: ${err.message ?? String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const startCrossValidation = () => {
    const okDocs = documents.filter((d) => d.status === "ok");
    if (okDocs.length === 0) {
      setStatus("정상적으로 분석된 추가자료가 없습니다.");
      return;
    }
    const result = runCrossValidation(damages, documents);
    onDamagesChange(result.damages);
    onCandidateDamagesChange(result.candidateDamages);
    setHasRun(true);
    const matched = result.damages.filter((d) => d.crossValidation?.result === "matched").length;
    const conflict = result.damages.filter((d) => d.crossValidation?.result === "conflict").length;
    const missing = result.damages.filter((d) => d.crossValidation?.result === "missingInAdditional").length;
    setStatus(
      `교차검증 완료: 일치 ${matched}건 · 불일치 ${conflict}건 · 추가자료에서 미확인 ${missing}건 · 새 후보 ${result.candidateDamages.length}건`
    );
  };

  const approve = (candidateId: string) => {
    const result = approveCandidateDamage(damages, candidateDamages, candidateId);
    onDamagesChange(result.damages);
    onCandidateDamagesChange(result.candidateDamages);
  };

  // STEP 9 — 제외/보류는 후보를 삭제하지 않고 결정만 기록한다("검토 보류"는 나중에 다시 볼 수 있음).
  const exclude = (candidateId: string) => {
    onCandidateDamagesChange(excludeCandidateDamage(candidateDamages, candidateId));
  };

  const defer = (candidateId: string) => {
    onCandidateDamagesChange(deferCandidateDamage(candidateDamages, candidateId));
  };

  return (
    <div className="additional-data-panel">
      <h2>STEP 8. 추가자료 교차검증</h2>
      <p className="subtitle">
        주 보고서에서 추출된 손상정보를 외관조사망도, 사진대지, 보수·보강표, 수량표, 도면 등의 추가자료와 비교하여 검증합니다.
      </p>

      <label className="checkbox">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        추가자료를 이용한 교차검증
      </label>
      <p className="hint">추가자료가 없는 경우 이 단계를 건너뛸 수 있습니다.</p>

      {enabled && (
        <div className="additional-data-body">
          <div className="upload-row">
            <label className="secondary-upload">
              + 추가자료 첨부 (PDF / Excel / Word)
              <input type="file" multiple accept=".pdf,.xlsx,.xls,.docx,.doc" onChange={(e) => addFiles(e.target.files)} />
            </label>
            <button onClick={attachAndParse} disabled={busy || pendingFiles.length === 0}>
              {busy ? "분석 중..." : `첨부 파일 분석 (${pendingFiles.length})`}
            </button>
          </div>

          {pendingFiles.length > 0 && (
            <ul className="pending-file-list">
              {pendingFiles.map((f) => (
                <li key={f.name}>
                  {f.name}{" "}
                  <button className="link-btn danger" onClick={() => removePendingFile(f.name)}>
                    제거
                  </button>
                </li>
              ))}
            </ul>
          )}

          {documents.length > 0 && (
            <>
              <h4>첨부된 파일</h4>
              <ul className="attached-doc-list">
                {documents.map((d) => (
                  <li key={d.id}>
                    {d.status === "ok" ? "☑" : "⚠"} {d.fileName} — {d.sourceType}
                    {d.sourceTypeConfidence < 0.5 ? " (분류 확신 낮음)" : ""} · 후보 {d.candidates.length}건
                    {d.status === "failed" ? ` · 분석 실패: ${d.error}` : ""}
                    {d.duplicateOfIds.length > 0 ? " · ⚠ 중복 자료 후보" : ""}
                  </li>
                ))}
              </ul>
              <button onClick={startCrossValidation} disabled={busy}>
                교차검증 시작
              </button>
            </>
          )}

          {status && <p className="status-line">{status}</p>}

          {hasRun && candidateDamages.length > 0 && (
            <div id="candidate-section">
              <h4>🟡 누락 가능성 — 추가자료에서 발견되었으나 기본 손상목록에서 확인되지 않음</h4>
              <ul className="candidate-damage-list">
                {candidateDamages
                  .filter((c) => !c.decision)
                  .map((c) => (
                    <li key={c.id}>
                      <strong>{c.id}</strong> {c.damageName ?? "-"} / {c.part ?? "-"} / {c.subPart ?? "-"} / {c.location ?? "-"} — 출처:{" "}
                      {c.fileName}
                      {c.sourceRef.page ? ` p.${c.sourceRef.page}` : ""}
                      {c.sourceRef.sheet ? ` (${c.sourceRef.sheet})` : ""}{" "}
                      <button onClick={() => approve(c.id)}>손상목록에 추가</button>{" "}
                      <button className="link-btn danger" onClick={() => exclude(c.id)}>
                        제외
                      </button>{" "}
                      <button className="link-btn" onClick={() => defer(c.id)}>
                        검토 보류
                      </button>
                    </li>
                  ))}
                {candidateDamages.every((c) => c.decision) && <li>모든 후보에 대한 결정이 완료되었습니다.</li>}
              </ul>
              {candidateDamages.some((c) => c.decision) && (
                <p className="hint">
                  결정 완료: 제외 {candidateDamages.filter((c) => c.decision === "excluded").length}건 · 보류{" "}
                  {candidateDamages.filter((c) => c.decision === "deferred").length}건
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!enabled && <p className="hint">[STEP 8 건너뛰기] — 추가자료 없이도 나머지 분석 결과는 정상적으로 유지됩니다.</p>}
    </div>
  );
}
