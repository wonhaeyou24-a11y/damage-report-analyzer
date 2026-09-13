import { useState } from "react";
import type { CandidateDamage, DamageRecord, ExportFormat, ExportOptions, ExtractedPhoto, ReviewSession } from "../types";
import { createDefaultExportOptions } from "../types";
import { validateForExport } from "../lib/report/buildDataset";
import { buildExcelWorkbookBuffer, excelFileName } from "../lib/report/exportExcel";
import { buildWordDocumentBuffer, wordFileName } from "../lib/report/exportWord";
import { buildPdfArrayBuffer, pdfFileName } from "../lib/report/exportPdf";
import { downloadBytes, MIME_TYPES } from "../lib/report/downloadFile";
import { buildHistoryEntry } from "../lib/report/exportHistory";
import { getFinalizedDamageRecords, getFinalizedPhotoRecords } from "../lib/finalReview";
import type { ExportHistoryEntry } from "../types";

interface Props {
  session: ReviewSession;
  records: DamageRecord[];
  photos: ExtractedPhoto[];
  candidateDamages: CandidateDamage[];
  history: ExportHistoryEntry[];
  onHistoryChange: (history: ExportHistoryEntry[]) => void;
}

const FORMAT_LABEL: Record<ExportFormat, string> = { excel: "Excel", word: "Word", pdf: "PDF" };

export default function FinalOutputPanel({ session, records, photos, candidateDamages, history, onHistoryChange }: Props) {
  const [options, setOptions] = useState<ExportOptions>(createDefaultExportOptions);
  const [selectedIdsText, setSelectedIdsText] = useState("");
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [blockedReasons, setBlockedReasons] = useState<string[] | null>(null);
  const [lastResult, setLastResult] = useState<Record<ExportFormat, "success" | "failed" | null>>({ excel: null, word: null, pdf: null });

  const finalizedDamages = getFinalizedDamageRecords(records);
  const finalizedPhotos = getFinalizedPhotoRecords(photos);
  const locked = session.finalReviewStatus === "in_progress";

  const applyScope = (): ExportOptions => {
    const ids = selectedIdsText
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { ...options, scope: ids.length > 0 ? "selected" : "all", selectedDamageIds: ids };
  };

  const run = async (type: ExportFormat) => {
    const effectiveOptions = applyScope();
    const check = validateForExport(session, records, photos, candidateDamages);
    if (!check.ok) {
      setBlockedReasons(check.reasons);
      return;
    }
    setBlockedReasons(null);
    setBusy(type);
    let fileName = "";
    try {
      if (type === "excel") {
        fileName = excelFileName(session);
        const buf = buildExcelWorkbookBuffer(records, photos, effectiveOptions);
        downloadBytes(buf, fileName, MIME_TYPES.excel);
      } else if (type === "word") {
        fileName = wordFileName(session);
        const buf = await buildWordDocumentBuffer(session, records, photos, candidateDamages, effectiveOptions);
        downloadBytes(buf, fileName, MIME_TYPES.word);
      } else {
        fileName = pdfFileName(session);
        const buf = buildPdfArrayBuffer(session, records, photos, candidateDamages, effectiveOptions);
        downloadBytes(buf, fileName, MIME_TYPES.pdf);
      }
      onHistoryChange([...history, buildHistoryEntry(type, session, effectiveOptions.selectedDamageIds, fileName, "success")]);
      setLastResult((r) => ({ ...r, [type]: "success" }));
    } catch (err: any) {
      onHistoryChange([...history, buildHistoryEntry(type, session, effectiveOptions.selectedDamageIds, fileName || "-", "failed", err.message ?? String(err))]);
      setLastResult((r) => ({ ...r, [type]: "failed" }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="final-output-panel">
      <h2>최종 결과</h2>
      {/* 검수 진행 상태/전체 건수는 위쪽 "최종 검토/검수"에 이미 표시된다 — 여기서는 그걸
          반복하지 않고, 실제 출력 대상(제외된 항목 제외)만 한 줄로 보여준다. */}
      <p className="final-output-counts">
        {session.finalReviewStatus === "finalized" ? "✓ 최종 검수 완료" : session.finalReviewStatus === "completed" ? "검수 완료 (최종 확정 전)" : "검수 진행중"}
        {" · 출력 대상: "}
        손상 {finalizedDamages.length}건 · 사진 {finalizedPhotos.length}건 · 교차검증 {finalizedDamages.filter((d) => !!d.crossValidation).length}건
      </p>

      {locked && <p className="hint">최종 검수 완료 후 결과물을 생성할 수 있습니다. (STEP9에서 "검수 완료"를 먼저 진행하세요.)</p>}

      <div className="final-output-options">
        <label className="checkbox">
          <input type="checkbox" checked={options.includeDamageList} onChange={(e) => setOptions({ ...options, includeDamageList: e.target.checked })} />
          손상목록
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={options.includePhotos} onChange={(e) => setOptions({ ...options, includePhotos: e.target.checked })} />
          손상사진
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={options.includeCrossValidation}
            onChange={(e) => setOptions({ ...options, includeCrossValidation: e.target.checked })}
          />
          교차검증 결과
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={options.includeSources} onChange={(e) => setOptions({ ...options, includeSources: e.target.checked })} />
          출처정보
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={options.includeReviewHistory}
            onChange={(e) => setOptions({ ...options, includeReviewHistory: e.target.checked })}
          />
          검수이력
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={options.includeUnlinkedPhotos}
            onChange={(e) => setOptions({ ...options, includeUnlinkedPhotos: e.target.checked })}
          />
          미연결 사진 포함
        </label>
      </div>

      <div className="final-output-scope">
        <label>
          선택 손상만 출력 (No를 콤마/공백으로 구분, 비우면 전체)
          <input
            className="search-box"
            placeholder="예: ③-01, ③-02, ④-01"
            value={selectedIdsText}
            onChange={(e) => setSelectedIdsText(e.target.value)}
          />
        </label>
      </div>

      {blockedReasons && (
        <div className="final-review-check-fail">
          <strong>최종 출력 전에 해결해야 할 항목이 있습니다:</strong>
          <ul>
            {blockedReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="final-output-actions">
        <button onClick={() => run("excel")} disabled={locked || busy === "excel"}>
          {busy === "excel" ? "생성 중..." : "Excel 다운로드"}
          {lastResult.excel === "success" ? " ✅" : lastResult.excel === "failed" ? " ⚠" : ""}
        </button>
        <button onClick={() => run("word")} disabled={locked || busy === "word"}>
          {busy === "word" ? "생성 중..." : "Word 보고서 생성"}
          {lastResult.word === "success" ? " ✅" : lastResult.word === "failed" ? " ⚠" : ""}
        </button>
        <button onClick={() => run("pdf")} disabled={locked || busy === "pdf"}>
          {busy === "pdf" ? "생성 중..." : "PDF 생성"}
          {lastResult.pdf === "success" ? " ✅" : lastResult.pdf === "failed" ? " ⚠" : ""}
        </button>
      </div>

      <button className="secondary" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
        최종 데이터 다시 보기
      </button>

      {history.length > 0 && (
        <>
          <h4>출력 이력</h4>
          <ul className="export-history-list">
            {[...history]
              .reverse()
              .slice(0, 10)
              .map((h) => (
                <li key={h.id}>
                  [{FORMAT_LABEL[h.type]}] {h.fileName} — {new Date(h.createdAt).toLocaleString()} · v{h.reviewVersion} ·{" "}
                  {h.status === "success" ? "성공" : `실패 (${h.error ?? "-"})`}
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}
