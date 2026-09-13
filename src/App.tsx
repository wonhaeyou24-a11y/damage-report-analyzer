import { useEffect, useRef, useState } from "react";
import UploadPanel from "./components/UploadPanel";
import DamageTable, { type ReviewFilter } from "./components/DamageTable";
import PhotoGallery from "./components/PhotoGallery";
import AdditionalDataPanel from "./components/AdditionalDataPanel";
import FinalReviewBar from "./components/FinalReviewBar";
import FinalOutputPanel from "./components/FinalOutputPanel";
import ValidationApp from "./components/ValidationApp";
import AISettingsPanel from "./components/AISettingsPanel";
import QualityDashboard from "./components/QualityDashboard";
import type { DamageRecord, ExtractedPhoto, ReviewSession } from "./types";
import { createReviewSession } from "./types";
import { clearAllReports, deleteReport, loadAllReports, saveReport, type AnalyzedReport } from "./lib/reportStorage";
import { ENGINE_VERSION, PROMPT_VERSION, getCurrentProviderModel } from "./lib/ai/providerManager";
import { buildReanalyzedEvent, diffPhotosForQualityEvents, diffRecordsForQualityEvents, diffSessionForQualityEvents } from "./lib/quality/diffEvents";
import type { AnalysisRunMeta } from "./lib/quality/types";
import "./App.css";

type Tab = "damages" | "photos";
type Mode = "analysis" | "validation" | "quality";

// 분석 1건의 전체 작업 상태 스냅샷(AnalyzedReport)은 IndexedDB 저장 스키마이기도 해서
// src/lib/reportStorage.ts에 정의돼 있다 — App은 그 타입을 그대로 가져다 쓴다.

let reportIdCounter = 0;
function nextReportId(): string {
  reportIdCounter += 1;
  return `R${String(reportIdCounter).padStart(3, "0")}`;
}
let runIdCounter = 0;
function nextRunId(): string {
  runIdCounter += 1;
  return `AR-${Date.now()}-${runIdCounter}`;
}

function createAnalyzedReport(records: DamageRecord[], photos: ExtractedPhoto[], sourceName: string): AnalyzedReport {
  const session = createReviewSession();
  session.reportName = sourceName.replace(/\.pdf$/i, "");
  const { provider, model } = getCurrentProviderModel();
  const createdAt = new Date().toISOString();
  const initialRun: AnalysisRunMeta = {
    id: nextRunId(),
    kind: "initial",
    provider,
    model,
    promptVersion: PROMPT_VERSION,
    engineVersion: ENGINE_VERSION,
    runAt: createdAt,
    recordCount: records.length,
  };
  return {
    id: nextReportId(),
    sourceName,
    createdAt,
    records,
    photos,
    documents: [],
    candidateDamages: [],
    session,
    exportHistory: [],
    analysisRuns: [initialRun],
    qualityEvents: [],
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

  // ---- STEP11(업무기반 품질추적): 손상/사진/세션이 바뀔 때마다 이전 상태와 비교해 이벤트를
  // 남긴다. DamageTable/PhotoGallery/FinalReviewBar 등 기존 컴포넌트는 손대지 않고, 이 경계
  // 한 곳에서만 diff를 계산한다. setReports의 functional updater 안에서 "직전 저장된 값"(r)을
  // 기준으로 비교해야, 같은 렌더에서 records/photos가 연달아 바뀌어도(예: 재분석) 이벤트가
  // 서로를 덮어쓰지 않는다.
  const handleRecordsChange = (records: DamageRecord[]) => {
    if (!activeReportId) return;
    setReports((prev) =>
      prev.map((r) => {
        if (r.id !== activeReportId) return r;
        const events = diffRecordsForQualityEvents(r.id, r.records, records);
        return events.length ? { ...r, records, qualityEvents: [...r.qualityEvents, ...events] } : { ...r, records };
      })
    );
  };

  const handlePhotosChange = (photos: ExtractedPhoto[]) => {
    if (!activeReportId) return;
    setReports((prev) =>
      prev.map((r) => {
        if (r.id !== activeReportId) return r;
        const events = diffPhotosForQualityEvents(r.id, r.photos, photos);
        return events.length ? { ...r, photos, qualityEvents: [...r.qualityEvents, ...events] } : { ...r, photos };
      })
    );
  };

  const handleSessionChange = (session: ReviewSession) => {
    if (!activeReportId) return;
    setReports((prev) =>
      prev.map((r) => {
        if (r.id !== activeReportId) return r;
        const events = diffSessionForQualityEvents(r.id, r.session, session);
        return events.length ? { ...r, session, qualityEvents: [...r.qualityEvents, ...events] } : { ...r, session };
      })
    );
  };

  // FinalReviewBar의 "재분석"(STEP7/8 재계산, AI 재호출 아님) 전용 — 일반 필드 편집과 구분해
  // "reanalyzed" 이벤트와 새 analysisRun(kind:"recompute")을 남긴다(스펙 26/27번).
  const handleReanalyzeRecordsChange = (records: DamageRecord[]) => {
    if (!activeReportId) return;
    const { provider, model } = getCurrentProviderModel();
    setReports((prev) =>
      prev.map((r) => {
        if (r.id !== activeReportId) return r;
        const diffEvents = diffRecordsForQualityEvents(r.id, r.records, records);
        const run: AnalysisRunMeta = {
          id: nextRunId(),
          kind: "recompute",
          provider,
          model,
          promptVersion: PROMPT_VERSION,
          engineVersion: ENGINE_VERSION,
          runAt: new Date().toISOString(),
          recordCount: records.length,
        };
        return {
          ...r,
          records,
          qualityEvents: [...r.qualityEvents, ...diffEvents, buildReanalyzedEvent(r.id)],
          analysisRuns: [...r.analysisRuns, run],
        };
      })
    );
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
      <header className="app-header">
        <div className="app-title-block">
          <h1>보고서 손상분석 프로그램</h1>
          <p className="subtitle">손상 그룹을 개별 위치별 레코드로 분리하고, 부위/세부부위/위치를 구조화하여 검토합니다.</p>
        </div>
        {/* 사용자 요청: AI 설정을 우측 상단 빈 공간에 배치. Gemini/Claude 선택은 "정확도/범용성
            검증"에서도 쓰이므로 모드와 무관하게 항상 보이는 위치가 맞다. */}
        <AISettingsPanel />
      </header>

      <div className="tab-bar">
        <button className={mode === "analysis" ? "active" : ""} onClick={() => setMode("analysis")}>
          보고서 분석
        </button>
        <button className={mode === "validation" ? "active" : ""} onClick={() => setMode("validation")}>
          정확도 / 범용성 검증
        </button>
        <button className={mode === "quality" ? "active" : ""} onClick={() => setMode("quality")}>
          품질
        </button>
      </div>

      {/* 세 화면 모두 항상 마운트해 두고 hidden으로만 전환한다 — 조건부 렌더링으로 언마운트하면
          ValidationApp의 테스트 목록/Ground Truth/검증 결과 같은 화면 내부 상태가 탭을 바꿀 때마다
          사라진다(사용자가 실제로 겪은 문제: "분석/검증 후 창을 바꾸면 사라진다"). */}
      <div hidden={mode !== "validation"}>
        <ValidationApp />
      </div>
      <div hidden={mode !== "quality"}>
        <QualityDashboard reports={reports} />
      </div>
      <div hidden={mode !== "analysis"}>
        <>
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
              {/* 사용자 요청: 별도 "최종 결과" 박스를 없애고, 출력(Excel/Word/PDF) 버튼을
                  재분석/검수완료/최종확정 버튼 밑에 이어서 배치한다(중복되던 손상/사진 건수 표시는 제거). */}
              <FinalReviewBar
                session={activeReport.session}
                onSessionChange={handleSessionChange}
                records={activeReport.records}
                onRecordsChange={handleReanalyzeRecordsChange}
                photos={activeReport.photos}
                onPhotosChange={handlePhotosChange}
                documents={activeReport.documents}
                candidateDamages={activeReport.candidateDamages}
                onFilterSelect={(f) => {
                  setReviewFilter(f);
                  setTab(f === "photoReview" ? "photos" : "damages");
                }}
                outputActions={
                  <FinalOutputPanel
                    session={activeReport.session}
                    records={activeReport.records}
                    photos={activeReport.photos}
                    candidateDamages={activeReport.candidateDamages}
                    history={activeReport.exportHistory}
                    onHistoryChange={(exportHistory) => updateActiveReport({ exportHistory })}
                  />
                }
              />

              <AdditionalDataPanel
                damages={activeReport.records}
                onDamagesChange={handleRecordsChange}
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
                    onChange={handleRecordsChange}
                    photos={activeReport.photos}
                    onPhotosChange={handlePhotosChange}
                    reviewFilter={reviewFilter}
                    onReviewFilterChange={setReviewFilter}
                    initialRun={activeReport.analysisRuns.find((r) => r.kind === "initial")}
                    qualityEvents={activeReport.qualityEvents}
                  />
                ) : (
                  <p className="empty-state">추출된 손상 데이터가 없습니다.</p>
                )
              ) : (
                <PhotoGallery photos={activeReport.photos} onChange={handlePhotosChange} damages={activeReport.records} onDamagesChange={handleRecordsChange} />
              )}
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
