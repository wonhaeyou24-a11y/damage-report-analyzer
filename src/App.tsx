import { useState } from "react";
import UploadPanel from "./components/UploadPanel";
import DamageTable, { type ReviewFilter } from "./components/DamageTable";
import PhotoGallery from "./components/PhotoGallery";
import AdditionalDataPanel from "./components/AdditionalDataPanel";
import FinalReviewBar from "./components/FinalReviewBar";
import FinalOutputPanel from "./components/FinalOutputPanel";
import ValidationApp from "./components/ValidationApp";
import AISettingsPanel from "./components/AISettingsPanel";
import type { AdditionalDocument, CandidateDamage, DamageRecord, ExportHistoryEntry, ExtractedPhoto, ReviewSession } from "./types";
import { createReviewSession } from "./types";
import "./App.css";

type Tab = "damages" | "photos";
type Mode = "analysis" | "validation";

export default function App() {
  const [mode, setMode] = useState<Mode>("analysis");
  const [records, setRecords] = useState<DamageRecord[]>([]);
  const [photos, setPhotos] = useState<ExtractedPhoto[]>([]);
  const [documents, setDocuments] = useState<AdditionalDocument[]>([]);
  const [candidateDamages, setCandidateDamages] = useState<CandidateDamage[]>([]);
  const [session, setSession] = useState<ReviewSession>(createReviewSession);
  const [exportHistory, setExportHistory] = useState<ExportHistoryEntry[]>([]);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [tab, setTab] = useState<Tab>("damages");

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

      {mode === "validation" ? (
        <ValidationApp />
      ) : (
        <>
          <AISettingsPanel />
          <UploadPanel onResult={setRecords} onPhotosResult={setPhotos} />

          {records.length > 0 || photos.length > 0 ? (
            <>
              <FinalReviewBar
                session={session}
                onSessionChange={setSession}
                records={records}
                onRecordsChange={setRecords}
                photos={photos}
                onPhotosChange={setPhotos}
                documents={documents}
                candidateDamages={candidateDamages}
                onFilterSelect={(f) => {
                  setReviewFilter(f);
                  setTab(f === "photoReview" ? "photos" : "damages");
                }}
              />

              <AdditionalDataPanel
                damages={records}
                onDamagesChange={setRecords}
                documents={documents}
                onDocumentsChange={setDocuments}
                candidateDamages={candidateDamages}
                onCandidateDamagesChange={setCandidateDamages}
              />

              <div className="tab-bar">
                <button className={tab === "damages" ? "active" : ""} onClick={() => setTab("damages")}>
                  손상 목록 {records.length > 0 ? `(${records.length})` : ""}
                </button>
                <button className={tab === "photos" ? "active" : ""} onClick={() => setTab("photos")}>
                  사진 목록 {photos.length > 0 ? `(${photos.length})` : ""}
                </button>
              </div>
              {tab === "damages" ? (
                records.length > 0 ? (
                  <DamageTable
                    records={records}
                    onChange={setRecords}
                    photos={photos}
                    onPhotosChange={setPhotos}
                    reviewFilter={reviewFilter}
                    onReviewFilterChange={setReviewFilter}
                  />
                ) : (
                  <p className="empty-state">추출된 손상 데이터가 없습니다.</p>
                )
              ) : (
                <PhotoGallery photos={photos} onChange={setPhotos} damages={records} onDamagesChange={setRecords} />
              )}

              <FinalOutputPanel
                session={session}
                records={records}
                photos={photos}
                candidateDamages={candidateDamages}
                history={exportHistory}
                onHistoryChange={setExportHistory}
              />
            </>
          ) : (
            <p className="empty-state">PDF를 업로드해 분석을 실행하거나, 샘플 데이터로 화면을 먼저 확인해 보세요.</p>
          )}
        </>
      )}
    </div>
  );
}
