import { useEffect, useRef, useState } from "react";
import UploadPanel from "./components/UploadPanel";
import DamageTable, { type ReviewFilter } from "./components/DamageTable";
import PhotoGallery from "./components/PhotoGallery";
import AdditionalDataPanel from "./components/AdditionalDataPanel";
import FinalReviewBar from "./components/FinalReviewBar";
import FinalOutputPanel from "./components/FinalOutputPanel";
import ValidationApp from "./components/ValidationApp";
import AISettingsPanel from "./components/AISettingsPanel";
import type { DamageRecord, ExtractedPhoto } from "./types";
import { createReviewSession } from "./types";
import { clearAllReports, deleteReport, loadAllReports, saveReport, type AnalyzedReport } from "./lib/reportStorage";
import "./App.css";

type Tab = "damages" | "photos";
type Mode = "analysis" | "validation";

// 분석 1건의 전체 작업 상태 스냅샷(AnalyzedReport)은 IndexedDB 저장 스키마이기도 해서
// src/lib/reportStorage.ts에 정의돼 있다 — App은 그 타입을 그대로 가져다 쓴다.

let reportIdCounter = 0;
function nextReportId(): string {
  reportIdCounter += 1;
  return `R${String(reportIdCounter).padStart(3, "0")}`;
}

function createAnalyzedReport(records: DamageRecord[], photos: ExtractedPhoto[], sourceName: string): AnalyzedReport {
  const session = createReviewSession();
  session.reportName = sourceName.replace(/\.pdf$/i, "");
  return {
    id: nextReportId(),
    sourceName,
    createdAt: new Date().toISOString(),
    records,
    photos,
    documents: [],
    candidateDamages: [],
    session,
    exportHistory: [],
  };
}

export default function App() {
  const [mode, setMode] = useState<Mode>("analysis");
  const [reports, setReports] = useState<AnalyzedReport[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [tab, setTab] = useState<Tab>("damages");
  const [storageNote, setStorageNote] = useState("");
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 앱을 처음 열 때 IndexedDB에 저장돼 있던 이전 분석 결과를 불러온다(새로고침해도 남아있게).
  // 저장/로드 실패는 분석 기능 자체를 막지 않는다 — 그냥 빈 목록으로 시작한다.
  useEffect(() => {
    (async () => {
      try {
        const saved = await loadAllReports();
        if (saved.length > 0) {
          setReports(saved);
          const maxNum = Math.max(0, ...saved.map((r) => Number(r.id.replace(/^R/, "")) || 0));
          reportIdCounter = maxNum; // 새 보고서 id가 불러온 것과 겹치지 않도록 이어서 채번
        }
      } catch (err) {
        console.error("저장된 보고서를 불러오지 못했습니다:", err);
        setStorageNote("이전에 저장된 분석 결과를 불러오지 못했습니다(브라우저 저장소 접근 실패).");
      } finally {
        loadedRef.current = true;
      }
    })();
  }, []);

  // reports가 바뀔 때마다(사용자 입력마다 매번 쓰지 않도록 1.5초 디바운스) IndexedDB에 저장한다.
  useEffect(() => {
    if (!loadedRef.current) return; // 초기 로드 직후의 setReports(saved)까지 다시 저장하지 않는다.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      Promise.all(reports.map((r) => saveReport(r))).catch((err) => {
        console.error("보고서 저장 실패:", err);
        setStorageNote("분석 결과를 저장하지 못했습니다(저장 공간 부족 등). 이 세션 동안은 화면에서 계속 볼 수 있습니다.");
      });
    }, 1500);
    return () => clearTimeout(saveTimerRef.current);
  }, [reports]);

  const activeReport = reports.find((r) => r.id === activeReportId) ?? null;

  const updateActiveReport = (patch: Partial<AnalyzedReport>) => {
    if (!activeReportId) return;
    setReports((prev) => prev.map((r) => (r.id === activeReportId ? { ...r, ...patch } : r)));
  };

  const openReport = (id: string) => {
    setActiveReportId(id);
    setReviewFilter("all");
    setTab("damages");
  };

  const handleAnalysisComplete = (records: DamageRecord[], photos: ExtractedPhoto[], sourceName: string) => {
    const report = createAnalyzedReport(records, photos, sourceName);
    setReports((prev) => [...prev, report]);
    openReport(report.id);
  };

  const removeReport = (id: string) => {
    if (!window.confirm("이 보고서의 분석 결과를 목록에서 삭제할까요? (되돌릴 수 없습니다)")) return;
    setReports((prev) => prev.filter((r) => r.id !== id));
    if (activeReportId === id) setActiveReportId(null);
    deleteReport(id).catch((err) => console.error("보고서 삭제 실패(저장소):", err));
  };

  const removeAllReports = () => {
    if (!window.confirm(`저장된 분석 결과 ${reports.length}건을 전부 삭제할까요? (되돌릴 수 없습니다)`)) return;
    setReports([]);
    setActiveReportId(null);
    clearAllReports().catch((err) => console.error("전체 삭제 실패(저장소):", err));
  };

  return (
    <div className="app">
      <header>
        <h1>보고서 손상분석 프로그램</h1>
        <p className="subtitle">손상 그룹을 개별 위치별 레코드로 분리하고, 부위/세부부위/위치를 구조화하여 검토합니다.</p>
      </header>

      <div className="tab-bar">
        <button className={mode === "analysis" ? "active" : ""} onClick={() => setMode("analysis")}>
          보고서 분석
        </button>
        <button className={mode === "validation" ? "active" : ""} onClick={() => setMode("validation")}>
          정확도 / 범용성 검증
        </button>
      </div>

      {/* 두 화면 모두 항상 마운트해 두고 hidden으로만 전환한다 — 조건부 렌더링으로 언마운트하면
          ValidationApp의 테스트 목록/Ground Truth/검증 결과 같은 화면 내부 상태가 탭을 바꿀 때마다
          사라진다(사용자가 실제로 겪은 문제: "분석/검증 후 창을 바꾸면 사라진다"). */}
      <div hidden={mode !== "validation"}>
        <ValidationApp />
      </div>
      <div hidden={mode !== "analysis"}>
        <>
          <AISettingsPanel />
          <UploadPanel onAnalysisComplete={handleAnalysisComplete} />

          {storageNote && <p className="status-line">{storageNote}</p>}

          {reports.length > 0 && (
            <div className="additional-data-panel">
              <div className="final-review-header">
                <h2>분석한 보고서 목록 ({reports.length})</h2>
                <button className="link-btn danger" onClick={removeAllReports}>
                  전체 삭제
                </button>
              </div>
              <p className="hint">분석 결과는 이 브라우저에 자동 저장되어 새로고침해도 남아있습니다. 공용 컴퓨터라면 다 쓴 뒤 "전체 삭제"를 눌러주세요.</p>
              <table className="photo-table">
                <thead>
                  <tr>
                    <th>보고서</th>
                    <th>분석일시</th>
                    <th>손상</th>
                    <th>사진</th>
                    <th>검수 상태</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id} className={r.id === activeReportId ? "clickable-row" : ""}>
                      <td>{r.session.reportName || r.sourceName}</td>
                      <td>{new Date(r.createdAt).toLocaleString()}</td>
                      <td>{r.records.length}건</td>
                      <td>{r.photos.length}건</td>
                      <td>
                        {r.session.finalReviewStatus === "finalized"
                          ? "최종확정"
                          : r.session.finalReviewStatus === "completed"
                            ? "검수완료"
                            : "진행중"}
                      </td>
                      <td>
                        <button className="link-btn" disabled={r.id === activeReportId} onClick={() => openReport(r.id)}>
                          {r.id === activeReportId ? "현재 보는 중" : "열기"}
                        </button>{" "}
                        <button className="link-btn danger" onClick={() => removeReport(r.id)}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeReport ? (
            <>
              <FinalReviewBar
                session={activeReport.session}
                onSessionChange={(session) => updateActiveReport({ session })}
                records={activeReport.records}
                onRecordsChange={(records) => updateActiveReport({ records })}
                photos={activeReport.photos}
                onPhotosChange={(photos) => updateActiveReport({ photos })}
                documents={activeReport.documents}
                candidateDamages={activeReport.candidateDamages}
                onFilterSelect={(f) => {
                  setReviewFilter(f);
                  setTab(f === "photoReview" ? "photos" : "damages");
                }}
              />

              <AdditionalDataPanel
                damages={activeReport.records}
                onDamagesChange={(records) => updateActiveReport({ records })}
                documents={activeReport.documents}
                onDocumentsChange={(documents) => updateActiveReport({ documents })}
                candidateDamages={activeReport.candidateDamages}
                onCandidateDamagesChange={(candidateDamages) => updateActiveReport({ candidateDamages })}
              />

              <div className="tab-bar">
                <button className={tab === "damages" ? "active" : ""} onClick={() => setTab("damages")}>
                  손상 목록 {activeReport.records.length > 0 ? `(${activeReport.records.length})` : ""}
                </button>
                <button className={tab === "photos" ? "active" : ""} onClick={() => setTab("photos")}>
                  사진 목록 {activeReport.photos.length > 0 ? `(${activeReport.photos.length})` : ""}
                </button>
              </div>
              {tab === "damages" ? (
                activeReport.records.length > 0 ? (
                  <DamageTable
                    records={activeReport.records}
                    onChange={(records) => updateActiveReport({ records })}
                    photos={activeReport.photos}
                    onPhotosChange={(photos) => updateActiveReport({ photos })}
                    reviewFilter={reviewFilter}
                    onReviewFilterChange={setReviewFilter}
                  />
                ) : (
                  <p className="empty-state">추출된 손상 데이터가 없습니다.</p>
                )
              ) : (
                <PhotoGallery
                  photos={activeReport.photos}
                  onChange={(photos) => updateActiveReport({ photos })}
                  damages={activeReport.records}
                  onDamagesChange={(records) => updateActiveReport({ records })}
                />
              )}

              <FinalOutputPanel
                session={activeReport.session}
                records={activeReport.records}
                photos={activeReport.photos}
                candidateDamages={activeReport.candidateDamages}
                history={activeReport.exportHistory}
                onHistoryChange={(exportHistory) => updateActiveReport({ exportHistory })}
              />
            </>
          ) : (
            <p className="empty-state">
              {reports.length > 0
                ? "위 목록에서 보고서를 선택하세요."
                : "PDF를 업로드해 분석을 실행하거나, 샘플 데이터로 화면을 먼저 확인해 보세요."}
            </p>
          )}
        </>
      </div>
    </div>
  );
}
