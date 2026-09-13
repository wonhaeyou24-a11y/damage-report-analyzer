import { useMemo, useRef, useState } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ValueGetterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import * as XLSX from "xlsx";
import type { CrossValidationConflict, DamageRecord, DamageStatus, EditableDamageField, ExtractedPhoto } from "../types";
import { STATUS_LABEL } from "../types";
import { manuallyLinkPhoto, manuallyUnlinkPhoto, setDamageNoPhoto, deriveDamagePhotoLinks } from "../lib/matchPhotos";
import { resolveCrossValidationConflict } from "../lib/crossValidate";
import { bulkConfirm, bulkMarkNoPhoto, compareByLocation, isManualEntry, isPhotoProblem, isPositionProblem, isScaleProblem, recordFieldEdit, searchDamages } from "../lib/finalReview";
import type { AnalysisRunMeta, QualityEvent } from "../lib/quality/types";

ModuleRegistry.registerModules([AllCommunityModule]);

interface Props {
  records: DamageRecord[];
  onChange: (records: DamageRecord[]) => void;
  photos?: ExtractedPhoto[];
  onPhotosChange?: (photos: ExtractedPhoto[]) => void;
  reviewFilter?: ReviewFilter;
  onReviewFilterChange?: (filter: ReviewFilter) => void;
  /** STEP11(업무기반) — Inspector "변경 이력"에서 "AI 최초 분석" 쪽에 Provider/Model/버전을 보여주기 위함. */
  initialRun?: Pick<AnalysisRunMeta, "provider" | "model" | "promptVersion" | "engineVersion">;
  /** STEP11(업무기반) — Inspector "변경 이력"에서 사진 연결 변경 이벤트를 보여주기 위함. */
  qualityEvents?: QualityEvent[];
}

type ViewMode = "individual" | "group";

// STEP 5/7/8/9: 검토 필터
export type ReviewFilter =
  | "all"
  | "confirmed"
  | "review"
  | "conflict"
  | "excluded"
  | "merged"
  | "sourceMissing"
  | "photoReview"
  | "noPhoto"
  | "cvConflict"
  | "cvMissing"
  | "positionProblem"
  | "photoProblem"
  | "scaleProblem"
  | "manualEntry"
  | "modified"
  | "unmodified";

const STATUS_OPTIONS: DamageStatus[] = ["confirmed", "review", "conflict", "excluded"];

const PHOTO_MATCH_ICON: Record<string, string> = {
  confirmed: "🟢",
  review: "🟡",
  conflict: "🔴",
  noPhoto: "⚪",
};

const CROSS_VALIDATION_ICON: Record<string, string> = {
  matched: "🟢 일치",
  conflict: "🔴 불일치",
  missingInAdditional: "🟡 미확인",
  candidate: "🟡 후보",
  unsupported: "⚪ 검증 불가",
};

export const REVIEW_FILTER_OPTIONS: { value: ReviewFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "confirmed", label: "확정" },
  { value: "review", label: "검토필요" },
  { value: "conflict", label: "정보 불일치" },
  { value: "excluded", label: "제외됨" },
  { value: "merged", label: "중복 통합" },
  { value: "sourceMissing", label: "출처 확인 필요" },
  { value: "photoReview", label: "사진 연결 검토" },
  { value: "noPhoto", label: "사진 없음" },
  { value: "cvConflict", label: "교차검증 불일치" },
  { value: "cvMissing", label: "추가자료 미확인" },
  { value: "positionProblem", label: "위치 문제" },
  { value: "photoProblem", label: "사진 문제" },
  { value: "scaleProblem", label: "규모 문제" },
  { value: "manualEntry", label: "직접입력 손상" },
  { value: "modified", label: "변경됨" },
  { value: "unmodified", label: "변경 없음" },
];

const EDITABLE_FIELD_BY_COLUMN: Record<string, EditableDamageField> = {
  section: "section",
  damageName: "damageName",
  part: "part",
  subPart: "subPart",
  location: "location",
  repairMethod: "repairMethod",
  status: "status",
};

export default function DamageTable({
  records,
  onChange,
  photos = [],
  onPhotosChange,
  reviewFilter: controlledFilter,
  onReviewFilterChange,
  initialRun,
  qualityEvents = [],
}: Props) {
  const gridRef = useRef<AgGridReact<DamageRecord>>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("individual");
  const [internalFilter, setInternalFilter] = useState<ReviewFilter>("all");
  const reviewFilter = controlledFilter ?? internalFilter;
  const setReviewFilter = onReviewFilterChange ?? setInternalFilter;
  const [searchQuery, setSearchQuery] = useState("");
  const [conflictModal, setConflictModal] = useState<DamageRecord | null>(null);
  const [cvManualValue, setCvManualValue] = useState<Record<string, string>>({});

  // 스펙(20번, Inspector 재정의): 중앙 표에서 손상을 "선택"하면 오른쪽 Inspector가 그 손상의
  // 사진/출처/교차검증/변경이력으로 즉시 갱신된다 — 예전처럼 여러 개의 개별 모달(사진 연결,
  // 출처, 교차검증, 상세)을 각각 열고 닫는 대신, 하나의 상시 패널로 통합했다. id만 들고 있고
  // 매 렌더마다 records/photos에서 최신값을 다시 찾는다(스냅샷을 따로 들고 있지 않음 — 재분석 등
  // 다른 경로로 데이터가 바뀌어도 패널이 항상 최신 상태를 보여준다).
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const inspected = records.find((r) => r.id === inspectedId) ?? null;

  const rowData = useMemo(() => {
    let rows = records;
    switch (reviewFilter) {
      case "confirmed":
        rows = rows.filter((r) => r.status === "confirmed");
        break;
      case "review":
        rows = rows.filter((r) => r.status === "review");
        break;
      case "conflict":
        rows = rows.filter((r) => r.status === "conflict" || (r.conflicts?.length ?? 0) > 0);
        break;
      case "excluded":
        rows = rows.filter((r) => r.status === "excluded");
        break;
      case "merged":
        rows = rows.filter((r) => r.mergeInfo?.merged);
        break;
      case "sourceMissing":
        rows = rows.filter((r) => r.sourcePages.length === 0 || r.sourceReferences.length === 0);
        break;
      case "photoReview":
        rows = rows.filter((r) => r.photoMatchStatus === "review" || r.photoMatchStatus === "conflict");
        break;
      case "noPhoto":
        rows = rows.filter((r) => r.photoMatchStatus === "noPhoto" || r.photoMatchStatus == null);
        break;
      case "cvConflict":
        rows = rows.filter((r) => r.crossValidation?.result === "conflict");
        break;
      case "cvMissing":
        rows = rows.filter((r) => r.crossValidation?.result === "missingInAdditional");
        break;
      case "positionProblem":
        rows = rows.filter(isPositionProblem);
        break;
      case "photoProblem":
        rows = rows.filter(isPhotoProblem);
        break;
      case "scaleProblem":
        rows = rows.filter(isScaleProblem);
        break;
      case "manualEntry":
        rows = rows.filter(isManualEntry);
        break;
      case "modified":
        // STEP11(업무기반): fieldOverrides가 있으면 AI 원본값에서 사용자가 실제로 고친 것이다.
        rows = rows.filter((r) => (r.fieldOverrides?.length ?? 0) > 0);
        break;
      case "unmodified":
        rows = rows.filter((r) => (r.fieldOverrides?.length ?? 0) === 0);
        break;
    }
    if (searchQuery.trim()) rows = searchDamages(rows, photos, searchQuery);
    if (viewMode === "group") {
      const seen = new Set<string>();
      rows = rows.filter((r) => {
        if (seen.has(r.groupNo)) return false;
        seen.add(r.groupNo);
        return true;
      });
    }
    return rows;
  }, [records, photos, reviewFilter, searchQuery, viewMode]);

  const deleteRecord = (id: string) => {
    onChange(records.filter((r) => r.id !== id));
    if (inspectedId === id) setInspectedId(null);
  };

  const addBlankRecord = () => {
    const newId = `NEW-${Date.now()}`;
    const blank: DamageRecord = {
      id: newId,
      groupNo: "-",
      groupIndex: 1,
      section: "",
      damageName: "",
      part: "기타",
      subPart: "-",
      location: "",
      repairMethod: "",
      quantity: null,
      quantityGroup: null,
      photos: [],
      status: "review",
      sourcePages: [],
      sourceReferences: [],
    };
    onChange([...records, blank]);
  };

  const columnDefs: ColDef<DamageRecord>[] = [
    { headerName: "No", field: "id", editable: false, pinned: "left", width: 110, sortable: true, filter: true },
    { headerName: "구간", field: "section", editable: true, sortable: true, filter: true, width: 100 },
    { headerName: "손상명", field: "damageName", editable: true, sortable: true, filter: true, width: 150 },
    { headerName: "부위", field: "part", editable: true, sortable: true, filter: true, width: 110 },
    { headerName: "세부부위", field: "subPart", editable: true, sortable: true, filter: true, width: 120 },
    {
      headerName: "위치",
      field: "location",
      editable: true,
      sortable: true,
      filter: true,
      width: 110,
      comparator: (a: string, b: string) => compareByLocation(a, b),
    },
    { headerName: "보수방안", field: "repairMethod", editable: true, sortable: true, filter: true, width: 130 },
    {
      headerName: "규모/물량",
      colId: "quantityDisplay",
      editable: true,
      sortable: true,
      filter: true,
      width: 190,
      valueGetter: (p: ValueGetterParams<DamageRecord>) => p.data?.quantity ?? p.data?.quantityGroup ?? "-",
      valueSetter: (p) => {
        onChange(recordFieldEdit(records, p.data.id, "quantity", p.newValue, p.oldValue));
        return true;
      },
    },
    {
      headerName: "사진",
      colId: "photos",
      width: 110,
      cellRenderer: (p: any) => {
        const r = p.data as DamageRecord;
        const linkedCount = r.photoIds?.length ?? 0;
        const icon = PHOTO_MATCH_ICON[r.photoMatchStatus ?? "noPhoto"];
        return (
          <button className="link-btn" onClick={() => setInspectedId(r.id)}>
            📷 {linkedCount > 0 ? `${linkedCount}장` : "0장"} {icon}
          </button>
        );
      },
    },
    {
      headerName: "통합",
      colId: "mergeInfo",
      width: 100,
      cellRenderer: (p: any) => {
        const r = p.data as DamageRecord;
        const count = r.mergeInfo?.sourceRecordIds.length ?? 0;
        return r.mergeInfo?.merged ? <span title={`원본: ${[r.id, ...r.mergeInfo.sourceRecordIds].join(", ")}`}>🔗 {count + 1}건</span> : "-";
      },
    },
    {
      headerName: "불일치",
      colId: "conflicts",
      width: 130,
      cellRenderer: (p: any) => {
        const r = p.data as DamageRecord;
        if (!r.conflicts || r.conflicts.length === 0) return "-";
        return (
          <button className="link-btn danger" onClick={() => setConflictModal(r)}>
            ⚠ 불일치 {r.conflicts.length}건
          </button>
        );
      },
    },
    {
      headerName: "교차검증",
      colId: "crossValidation",
      width: 130,
      cellRenderer: (p: any) => {
        const r = p.data as DamageRecord;
        if (!r.crossValidation) return "-";
        return (
          <button className="link-btn" onClick={() => setInspectedId(r.id)}>
            {CROSS_VALIDATION_ICON[r.crossValidation.result] ?? r.crossValidation.result}
          </button>
        );
      },
    },
    {
      headerName: "상태",
      field: "status",
      width: 110,
      editable: true,
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: STATUS_OPTIONS },
      valueFormatter: (p) => STATUS_LABEL[p.value as DamageStatus] ?? p.value,
    },
    {
      headerName: "상세",
      colId: "inspector",
      width: 80,
      cellRenderer: (p: any) => (
        <button className="link-btn" onClick={() => setInspectedId((p.data as DamageRecord).id)}>
          🔍 상세
        </button>
      ),
    },
    {
      headerName: "삭제",
      colId: "delete",
      width: 70,
      cellRenderer: (p: any) => (
        <button className="link-btn danger" onClick={() => deleteRecord((p.data as DamageRecord).id)}>
          삭제
        </button>
      ),
    },
  ];

  // STEP 9 — 셀 편집은 원본 AI 값을 fieldOverrides에 보존하면서 적용한다(재분석해도 덮어쓰지 않음).
  const onCellValueChanged = (e: any) => {
    const colId = e.colDef.field ?? e.colDef.colId;
    const editableField = EDITABLE_FIELD_BY_COLUMN[colId];
    if (!editableField) return;
    onChange(recordFieldEdit(records, e.data.id, editableField, e.newValue, e.oldValue));
  };

  const exportCsv = () => {
    gridRef.current?.api.exportDataAsCsv({ fileName: "damage_report.csv" });
  };

  const exportXlsx = () => {
    const rows = rowData.map((r) => ({
      No: r.id,
      구간: r.section,
      손상명: r.damageName,
      부위: r.part,
      세부부위: r.subPart,
      위치: r.location,
      보수방안: r.repairMethod,
      "규모/물량": r.quantity ?? r.quantityGroup ?? "-",
      사진수: r.photos.length,
      상태: STATUS_LABEL[r.status],
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "손상목록");
    XLSX.writeFile(wb, "damage_report.xlsx");
  };

  const onPhotoFileChange = (record: DamageRecord, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newPhotos = Array.from(files).map((f, i) => ({
      id: `${record.id}-photo-${Date.now()}-${i}`,
      url: URL.createObjectURL(f),
      caption: f.name,
      linked: "individual" as const,
    }));
    const updated = { ...record, photos: [...record.photos, ...newPhotos] };
    onChange(records.map((r) => (r.id === record.id ? updated : r)));
  };

  // STEP 7: 손상 ↔ 사진 수동 연결/해제. 사용자 결정은 자동 매칭보다 항상 우선한다.
  // (기존 로직 그대로 — 예전엔 결과를 별도 모달 state에 다시 넣어줬지만, 이제 Inspector가
  // records/photos props에서 직접 최신값을 읽으므로 그 스냅샷 갱신이 필요 없어졌다.)
  const linkPhoto = (damageId: string, photoId: string) => {
    if (!onPhotosChange) return;
    const nextPhotos = manuallyLinkPhoto(photos, photoId, damageId);
    onPhotosChange(nextPhotos);
    onChange(deriveDamagePhotoLinks(setDamageNoPhoto(records, damageId, false), nextPhotos));
  };

  const unlinkPhoto = (damageId: string, photoId: string) => {
    if (!onPhotosChange) return;
    const nextPhotos = manuallyUnlinkPhoto(photos, photoId, damageId);
    onPhotosChange(nextPhotos);
    onChange(deriveDamagePhotoLinks(records, nextPhotos));
  };

  const markNoPhoto = (damageId: string, value: boolean) => {
    onChange(deriveDamagePhotoLinks(setDamageNoPhoto(records, damageId, value), photos));
  };

  // STEP 8: 불일치 해결 — 기본값 유지 / 추가자료 값 채택 / 직접 수정 모두 이 경로로 처리한다.
  const resolveConflict = (damageId: string, field: CrossValidationConflict["field"], value: string, reason?: string) => {
    onChange(resolveCrossValidationConflict(records, damageId, field, value, reason));
  };

  // STEP 9: 일괄 검수
  const bulkConfirmSelected = () => {
    const ids = (gridRef.current?.api.getSelectedRows() ?? []).map((r) => r.id);
    if (ids.length === 0) return;
    onChange(bulkConfirm(records, ids));
  };

  const bulkMarkNoPhotoSelected = () => {
    const ids = (gridRef.current?.api.getSelectedRows() ?? []).map((r) => r.id);
    if (ids.length === 0 || !onPhotosChange) return;
    const nextDamages = bulkMarkNoPhoto(records, photos, ids);
    onChange(deriveDamagePhotoLinks(nextDamages, photos));
  };

  return (
    <div className="damage-table">
      <div className="toolbar">
        <div className="toolbar-group">
          <button className={viewMode === "individual" ? "active" : ""} onClick={() => setViewMode("individual")}>
            개별 손상 보기
          </button>
          <button className={viewMode === "group" ? "active" : ""} onClick={() => setViewMode("group")}>
            그룹별 보기
          </button>
        </div>
        <div className="toolbar-group">
          <label className="checkbox">
            검토 필터
            <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value as ReviewFilter)}>
              {REVIEW_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <input
            className="search-box"
            placeholder="손상명/구간/부위/위치/사진번호/페이지 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="toolbar-group">
          <button onClick={bulkConfirmSelected}>일괄 검수 완료</button>
          <button onClick={bulkMarkNoPhotoSelected}>일괄 사진 없음 확인</button>
          <button onClick={addBlankRecord}>+ 손상 추가</button>
          <button onClick={exportCsv}>CSV 내보내기</button>
          <button onClick={exportXlsx}>Excel 내보내기</button>
        </div>
      </div>

      {/* 스펙 20번 8절 — 중앙은 판단/수정 공간(넓게), 오른쪽은 근거/부가정보 확인 공간. */}
      <div className="review-layout">
        <div className="review-grid-area" style={{ height: 520 }}>
          <AgGridReact<DamageRecord>
            ref={gridRef}
            theme={themeQuartz}
            rowData={rowData}
            columnDefs={columnDefs}
            defaultColDef={{ resizable: true }}
            rowSelection={{ mode: "multiRow" }}
            onCellValueChanged={onCellValueChanged}
          />
        </div>

        {inspected && (
          <DamageInspector
            key={inspected.id}
            damage={inspected}
            photos={photos}
            onClose={() => setInspectedId(null)}
            onLinkPhoto={linkPhoto}
            onUnlinkPhoto={unlinkPhoto}
            onMarkNoPhoto={markNoPhoto}
            onPhotoFileChange={onPhotoFileChange}
            onResolveConflict={resolveConflict}
            cvManualValue={cvManualValue}
            onCvManualValueChange={(field, value) => setCvManualValue((m) => ({ ...m, [field]: value }))}
            initialRun={initialRun}
            qualityEvents={qualityEvents}
          />
        )}
      </div>

      {conflictModal && (
        <div className="modal-backdrop" onClick={() => setConflictModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>⚠ 정보 불일치 — {conflictModal.id}</h3>
            <p>여러 출처에서 서로 다른 정보가 발견되어 자동으로 하나를 선택하지 않았습니다. 원문을 확인해 직접 수정하세요.</p>
            <ul>
              {(conflictModal.conflicts ?? []).map((c, i) => (
                <li key={i}>
                  <strong>{c.field}</strong>:{" "}
                  {c.values.map((v, j) => (
                    <span key={j}>
                      {v.value}
                      {v.page != null ? ` (p.${v.page})` : ""}
                      {j < c.values.length - 1 ? " / " : ""}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <button onClick={() => setConflictModal(null)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

interface InspectorProps {
  damage: DamageRecord;
  photos: ExtractedPhoto[];
  onClose: () => void;
  onLinkPhoto: (damageId: string, photoId: string) => void;
  onUnlinkPhoto: (damageId: string, photoId: string) => void;
  onMarkNoPhoto: (damageId: string, value: boolean) => void;
  onPhotoFileChange: (record: DamageRecord, files: FileList | null) => void;
  onResolveConflict: (damageId: string, field: CrossValidationConflict["field"], value: string, reason?: string) => void;
  cvManualValue: Record<string, string>;
  onCvManualValueChange: (field: string, value: string) => void;
  initialRun?: Pick<AnalysisRunMeta, "provider" | "model" | "promptVersion" | "engineVersion">;
  qualityEvents: QualityEvent[];
}

/**
 * 스펙 20번 — 오른쪽 Inspector. 중앙 표가 이미 보여주는 손상명/부위/세부부위/위치/규모/보수방안
 * 전체 편집 UI는 반복하지 않고, "이 손상의 사진은 무엇인가 / AI가 왜 연결했는가 / 출처는 어디인가 /
 * 추가자료와 일치하는가 / 무엇이 바뀌었는가"에만 답한다. 예전에 사진연결/출처/교차검증/상세로
 * 나뉘어 있던 4개의 개별 모달을 접이식 섹션 하나로 통합했다 — 기존 함수(linkPhoto/unlinkPhoto/
 * resolveConflict 등)는 그대로 재사용한다.
 */
function DamageInspector({
  damage: d,
  photos,
  onClose,
  onLinkPhoto,
  onUnlinkPhoto,
  onMarkNoPhoto,
  onPhotoFileChange,
  onResolveConflict,
  cvManualValue,
  onCvManualValueChange,
  initialRun,
  qualityEvents,
}: InspectorProps) {
  // 부모가 이 컴포넌트를 key={damage.id}로 렌더링하므로, 손상이 바뀌면 컴포넌트가 통째로
  // 다시 마운트되어 photoIndex가 자연히 0으로 리셋된다(별도 useEffect 리셋 불필요).
  const [photoIndex, onPhotoIndexChange] = useState(0);
  const linkedPhotos = photos.filter((p) => d.photoIds?.includes(p.id));
  const candidatePhotos = photos
    .filter((p) => !d.photoIds?.includes(p.id) && p.matchCandidates.some((c) => c.damageId === d.id))
    .map((p) => ({ photo: p, candidate: p.matchCandidates.find((c) => c.damageId === d.id)! }))
    .sort((a, b) => b.candidate.score - a.candidate.score);
  const currentPhoto = linkedPhotos[Math.min(photoIndex, Math.max(linkedPhotos.length - 1, 0))] ?? null;
  const hasConflict = (d.crossValidation?.conflicts.filter((c) => !c.resolved).length ?? 0) > 0;
  const photoLinkEvents = qualityEvents.filter((e) => e.recordId === d.id && (e.type === "photo_linked" || e.type === "photo_unlinked"));

  return (
    <aside className="inspector-panel">
      <div className="inspector-header">
        <strong>
          {d.groupNo !== "-" ? `${d.groupNo} ` : ""}
          {d.damageName || "(손상명 미입력)"} · {d.subPart} · {d.location || "위치 미입력"}
        </strong>
        <button className="link-btn" onClick={onClose}>
          닫기
        </button>
      </div>

      <details open className="inspector-section">
        <summary>손상 사진 {linkedPhotos.length > 0 ? `(${linkedPhotos.length})` : ""}</summary>
        {currentPhoto ? (
          <div className="inspector-photo-viewer">
            {currentPhoto.image.dataUrl && <img src={currentPhoto.image.dataUrl} alt={currentPhoto.caption ?? currentPhoto.id} />}
            <p className="hint">
              {photoIndex + 1} / {linkedPhotos.length}
            </p>
            <div className="toolbar-group">
              <button disabled={linkedPhotos.length < 2} onClick={() => onPhotoIndexChange((photoIndex - 1 + linkedPhotos.length) % linkedPhotos.length)}>
                ◀ 이전
              </button>
              <button disabled={linkedPhotos.length < 2} onClick={() => onPhotoIndexChange((photoIndex + 1) % linkedPhotos.length)}>
                다음 ▶
              </button>
            </div>
            <p>
              사진번호: {currentPhoto.photoNo ?? currentPhoto.id}
              <br />
              사진 ID: {currentPhoto.id}
              <br />
              페이지: {currentPhoto.page}
              <br />
              캡션: {currentPhoto.caption ?? "-"}
              <br />
              연결상태: {currentPhoto.matchStatus === "confirmed" ? "✓ 연결됨" : currentPhoto.matchStatus ?? "-"}
            </p>
          </div>
        ) : (
          <p className="hint">{d.photoMatchOverride === "noPhoto" ? "사진 없음으로 확인됨" : "연결된 사진이 없습니다."}</p>
        )}
      </details>

      <details open className="inspector-section">
        <summary>사진 연결 정보</summary>
        {linkedPhotos.length > 0 && (
          <ul className="inspector-photo-link-list">
            {linkedPhotos.map((p) => {
              const c = p.matchCandidates.find((c) => c.damageId === d.id);
              return (
                <li key={p.id}>
                  <strong>{p.photoNo ?? p.id}</strong> · {p.matchSource === "manual" ? "사용자 수동 연결" : "AI 자동 연결"}
                  {c && (
                    <>
                      {" "}
                      · 신뢰도 {Math.round(c.score)} · 근거: {c.reasons.join(", ") || "-"}
                    </>
                  )}
                  <button className="link-btn danger" onClick={() => onUnlinkPhoto(d.id, p.id)}>
                    연결 해제
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {candidatePhotos.length > 0 && (
          <>
            <p className="hint">연결 후보 (자동 확정되지 않음 — 검토 필요)</p>
            <ul className="inspector-photo-link-list">
              {candidatePhotos.map(({ photo: p, candidate }) => (
                <li key={p.id}>
                  <strong>{p.photoNo ?? p.id}</strong> · 점수 {candidate.score} · {candidate.reasons.join(", ")}
                  {candidate.conflict ? " ⚠ 정보 충돌" : ""}
                  <button className="link-btn" onClick={() => onLinkPhoto(d.id, p.id)}>
                    이 사진 연결
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {photoLinkEvents.length > 0 && (
          <>
            <p className="hint">연결 변경 이력</p>
            <ul>
              {photoLinkEvents.map((e) => (
                <li key={e.id}>
                  [{new Date(e.at).toLocaleString()}] {e.type === "photo_linked" ? `연결됨 (${e.to})` : `해제됨 (${e.from})`}
                </li>
              ))}
            </ul>
          </>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={d.photoMatchOverride === "noPhoto"} onChange={(e) => onMarkNoPhoto(d.id, e.target.checked)} />이 손상은
          사진 없음으로 표시
        </label>
        <div className="toolbar-group">
          <label className="secondary-upload">
            직접 업로드한 사진 추가 (STEP4, {d.photos.length}장)
            <input type="file" multiple accept="image/*" onChange={(e) => onPhotoFileChange(d, e.target.files)} />
          </label>
        </div>
      </details>

      <details open className="inspector-section">
        <summary>출처 / 근거</summary>
        <p>원본 보고서 · p.{d.sourcePages.join(", ") || "미상"}</p>
        <ul>
          {d.sourceReferences.map((r, i) => (
            <li key={i}>
              p.{r.page} ({r.type}){r.excerpt ? ` — "${r.excerpt}"` : ""}
            </li>
          ))}
          {d.sourceReferences.length === 0 && <li>등록된 출처 정보가 없습니다.</li>}
        </ul>
      </details>

      <details open={hasConflict} className={`inspector-section${hasConflict ? " inspector-section-alert" : ""}`}>
        <summary>추가자료 / 교차검증{hasConflict ? " ⚠" : ""}</summary>
        {d.crossValidation ? (
          <>
            <p>
              상태: {CROSS_VALIDATION_ICON[d.crossValidation.result] ?? d.crossValidation.result} (신뢰도{" "}
              {(d.crossValidation.confidence * 100).toFixed(0)}%)
            </p>
            <ul>
              {d.crossValidation.evidence.map((e, i) => (
                <li key={i}>
                  [{e.sourceType}] {e.fileName}
                  {e.sourceRef.page ? ` p.${e.sourceRef.page}` : ""} → {e.result === "matched" ? "일치" : "불일치"}
                </li>
              ))}
              {d.crossValidation.evidence.length === 0 && <li>참고 근거 없음</li>}
            </ul>
            {d.crossValidation.conflicts.length > 0 && (
              <table className="photo-table">
                <thead>
                  <tr>
                    <th>항목</th>
                    <th>본 보고서</th>
                    <th>추가자료</th>
                    <th>처리</th>
                  </tr>
                </thead>
                <tbody>
                  {d.crossValidation.conflicts.map((c, i) => (
                    <tr key={i}>
                      <td>{c.field}</td>
                      <td>
                        {c.mainReport.value} {c.mainReport.page != null ? `(p.${c.mainReport.page})` : ""}
                      </td>
                      <td>
                        [{c.additional.sourceType}] {c.additional.value} — {c.additional.fileName}
                      </td>
                      <td>
                        {c.resolved ? (
                          <span>✅ {c.resolved.value}로 확정</span>
                        ) : (
                          <>
                            <button onClick={() => onResolveConflict(d.id, c.field, c.mainReport.value, "기본값 유지")}>기본값 유지</button>{" "}
                            <button onClick={() => onResolveConflict(d.id, c.field, c.additional.value, "추가자료 값 채택")}>추가자료 값 채택</button>
                            <br />
                            <input
                              className="search-box"
                              placeholder="직접 입력"
                              value={cvManualValue[c.field] ?? ""}
                              onChange={(e) => onCvManualValueChange(c.field, e.target.value)}
                              style={{ width: 100 }}
                            />
                            <button
                              onClick={() => {
                                const v = cvManualValue[c.field];
                                if (v) onResolveConflict(d.id, c.field, v, "직접 수정");
                              }}
                            >
                              확정
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <p className="hint">추가자료 없음</p>
        )}
      </details>

      <details className="inspector-section">
        <summary>변경 이력</summary>
        {initialRun && (
          <p className="hint">
            AI 최초 분석: {initialRun.provider} / {initialRun.model} / Prompt {initialRun.promptVersion} / Engine {initialRun.engineVersion}
          </p>
        )}
        {(d.fieldOverrides?.length ?? 0) > 0 ? (
          <ul>
            {d.fieldOverrides!.map((o, i) => (
              <li key={i}>
                <strong>{o.field}</strong>
                <br />
                AI 분석: {o.originalValue}
                <br />
                사용자 수정: {o.currentValue}
                <br />
                변경시각: {new Date(o.changedAt).toLocaleString()} · 변경자: 사용자
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">AI 분석 이후 사용자가 수정한 필드가 없습니다.</p>
        )}
        <p className="hint">검수 기록</p>
        <ul>
          {(d.reviewHistory ?? []).map((h, i) => (
            <li key={i}>
              [{new Date(h.at).toLocaleString()}] {h.action}
              {h.field ? ` — ${h.field}: ${h.from} → ${h.to}` : ""} ({h.source})
            </li>
          ))}
          {(!d.reviewHistory || d.reviewHistory.length === 0) && <li>AI 추출 이후 검수 기록 없음</li>}
        </ul>
      </details>
    </aside>
  );
}
