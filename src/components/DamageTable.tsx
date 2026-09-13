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

ModuleRegistry.registerModules([AllCommunityModule]);

interface Props {
  records: DamageRecord[];
  onChange: (records: DamageRecord[]) => void;
  photos?: ExtractedPhoto[];
  onPhotosChange?: (photos: ExtractedPhoto[]) => void;
  reviewFilter?: ReviewFilter;
  onReviewFilterChange?: (filter: ReviewFilter) => void;
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

export default function DamageTable({ records, onChange, photos = [], onPhotosChange, reviewFilter: controlledFilter, onReviewFilterChange }: Props) {
  const gridRef = useRef<AgGridReact<DamageRecord>>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("individual");
  const [internalFilter, setInternalFilter] = useState<ReviewFilter>("all");
  const reviewFilter = controlledFilter ?? internalFilter;
  const setReviewFilter = onReviewFilterChange ?? setInternalFilter;
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceModal, setSourceModal] = useState<DamageRecord | null>(null);
  const [linkModal, setLinkModal] = useState<DamageRecord | null>(null);
  const [conflictModal, setConflictModal] = useState<DamageRecord | null>(null);
  const [cvModal, setCvModal] = useState<DamageRecord | null>(null);
  const [inspectorModal, setInspectorModal] = useState<DamageRecord | null>(null);
  const [cvManualValue, setCvManualValue] = useState<Record<string, string>>({});

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
          <button className="link-btn" onClick={() => setLinkModal(r)}>
            📷 {linkedCount > 0 ? `${linkedCount}장` : "0장"} {icon}
          </button>
        );
      },
    },
    {
      headerName: "출처",
      colId: "source",
      width: 80,
      cellRenderer: (p: any) => (
        <button className="link-btn" onClick={() => setSourceModal(p.data)}>
          🔎
        </button>
      ),
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
          <button className="link-btn" onClick={() => setCvModal(r)}>
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
        <button className="link-btn" onClick={() => setInspectorModal(p.data)}>
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
    setLinkModal((m) => (m && m.id === record.id ? updated : m));
  };

  // STEP 7: 손상 ↔ 사진 수동 연결/해제. 사용자 결정은 자동 매칭보다 항상 우선한다.
  const linkPhoto = (damageId: string, photoId: string) => {
    if (!onPhotosChange) return;
    const nextPhotos = manuallyLinkPhoto(photos, photoId, damageId);
    onPhotosChange(nextPhotos);
    const nextDamages = deriveDamagePhotoLinks(setDamageNoPhoto(records, damageId, false), nextPhotos);
    onChange(nextDamages);
    setLinkModal(nextDamages.find((d) => d.id === damageId) ?? null);
  };

  const unlinkPhoto = (damageId: string, photoId: string) => {
    if (!onPhotosChange) return;
    const nextPhotos = manuallyUnlinkPhoto(photos, photoId, damageId);
    onPhotosChange(nextPhotos);
    const nextDamages = deriveDamagePhotoLinks(records, nextPhotos);
    onChange(nextDamages);
    setLinkModal(nextDamages.find((d) => d.id === damageId) ?? null);
  };

  const markNoPhoto = (damageId: string, value: boolean) => {
    const nextDamages = deriveDamagePhotoLinks(setDamageNoPhoto(records, damageId, value), photos);
    onChange(nextDamages);
    setLinkModal(nextDamages.find((d) => d.id === damageId) ?? null);
  };

  // STEP 8: 불일치 해결 — 기본값 유지 / 추가자료 값 채택 / 직접 수정 모두 이 경로로 처리한다.
  const resolveConflict = (damageId: string, field: CrossValidationConflict["field"], value: string, reason?: string) => {
    const nextDamages = resolveCrossValidationConflict(records, damageId, field, value, reason);
    onChange(nextDamages);
    setCvModal(nextDamages.find((d) => d.id === damageId) ?? null);
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

      <div style={{ height: 520, width: "100%" }}>
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

      {sourceModal && (
        <div className="modal-backdrop" onClick={() => setSourceModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>출처 정보 — {sourceModal.id}</h3>
            <p>페이지: {sourceModal.sourcePages.join(", ") || "미상"}</p>
            <ul>
              {sourceModal.sourceReferences.map((ref, i) => (
                <li key={i}>
                  <strong>p.{ref.page}</strong> ({ref.type}){ref.excerpt ? ` — ${ref.excerpt}` : ""}
                </li>
              ))}
              {sourceModal.sourceReferences.length === 0 && <li>등록된 출처 정보가 없습니다.</li>}
            </ul>
            <button onClick={() => setSourceModal(null)}>닫기</button>
          </div>
        </div>
      )}

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

      {cvModal && cvModal.crossValidation && (
        <div className="modal-backdrop" onClick={() => setCvModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>교차검증 상세 — {cvModal.id}</h3>
            <p>
              {cvModal.damageName} / {cvModal.part} / {cvModal.subPart} / {cvModal.location}
            </p>
            <p>
              <strong>기본 보고서</strong>: p.{cvModal.sourcePages.join(", ") || "미상"}
              {cvModal.sourceReferences[0]?.excerpt ? ` — "${cvModal.sourceReferences[0].excerpt}"` : ""}
            </p>

            <h4>추가자료</h4>
            <ul>
              {cvModal.crossValidation.evidence.map((e, i) => (
                <li key={i}>
                  [{e.sourceType}] {e.fileName}
                  {e.sourceRef.page ? ` p.${e.sourceRef.page}` : ""}
                  {e.sourceRef.sheet ? ` (${e.sourceRef.sheet}${e.sourceRef.cell ? ` ${e.sourceRef.cell}` : ""})` : ""} → {e.result === "matched" ? "일치" : "불일치"}
                </li>
              ))}
              {cvModal.crossValidation.evidence.length === 0 && <li>참고할 수 있는 추가자료 근거가 없습니다.</li>}
            </ul>

            {cvModal.crossValidation.conflicts.length > 0 && (
              <>
                <h4>⚠ 정보 불일치</h4>
                <table className="photo-table">
                  <thead>
                    <tr>
                      <th>항목</th>
                      <th>기본 보고서</th>
                      <th>추가자료</th>
                      <th>처리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cvModal.crossValidation.conflicts.map((c, i) => (
                      <tr key={i}>
                        <td>{c.field}</td>
                        <td>
                          {c.mainReport.value} {c.mainReport.page != null ? `(p.${c.mainReport.page})` : ""}
                        </td>
                        <td>
                          [{c.additional.sourceType}] {c.additional.value} — {c.additional.fileName}
                          {c.additional.page != null ? ` p.${c.additional.page}` : ""}
                        </td>
                        <td>
                          {c.resolved ? (
                            <span>✅ {c.resolved.value}로 확정 (수동)</span>
                          ) : (
                            <>
                              <button onClick={() => resolveConflict(cvModal.id, c.field, c.mainReport.value, "기본값 유지")}>기본값 유지</button>{" "}
                              <button onClick={() => resolveConflict(cvModal.id, c.field, c.additional.value, "추가자료 값 채택")}>
                                추가자료 값 채택
                              </button>{" "}
                              <input
                                className="search-box"
                                placeholder="직접 입력"
                                value={cvManualValue[c.field] ?? ""}
                                onChange={(e) => setCvManualValue((m) => ({ ...m, [c.field]: e.target.value }))}
                                style={{ width: 100 }}
                              />
                              <button
                                onClick={() => {
                                  const v = cvManualValue[c.field];
                                  if (v) resolveConflict(cvModal.id, c.field, v, "직접 수정");
                                }}
                              >
                                직접 입력 확정
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <p>
              교차검증 결과: {CROSS_VALIDATION_ICON[cvModal.crossValidation.result]} (신뢰도 {(cvModal.crossValidation.confidence * 100).toFixed(0)}%)
            </p>
            <button onClick={() => setCvModal(null)}>닫기</button>
          </div>
        </div>
      )}

      {linkModal &&
        (() => {
          const linkedPhotos = photos.filter((p) => linkModal.photoIds?.includes(p.id));
          const candidatePhotos = photos
            .filter((p) => !linkModal.photoIds?.includes(p.id) && p.matchCandidates.some((c) => c.damageId === linkModal.id))
            .map((p) => ({ photo: p, candidate: p.matchCandidates.find((c) => c.damageId === linkModal.id)! }))
            .sort((a, b) => b.candidate.score - a.candidate.score);

          return (
            <div className="modal-backdrop" onClick={() => setLinkModal(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>
                  사진 연결 — {linkModal.id} ({linkModal.damageName} / {linkModal.subPart} / {linkModal.location})
                </h3>

                <h4>연결된 사진 ({linkedPhotos.length})</h4>
                <div className="photo-grid">
                  {linkedPhotos.map((p) => {
                    const c = p.matchCandidates.find((c) => c.damageId === linkModal.id);
                    return (
                      <div key={p.id} className="photo-thumb">
                        {p.image.dataUrl && <img src={p.image.dataUrl} alt={p.caption ?? p.id} />}
                        <span>
                          {p.photoNo ?? p.id} · p.{p.page}
                        </span>
                        {c && <span>점수 {c.score} — {c.reasons.join(", ") || "수동 연결"}</span>}
                        <button className="link-btn danger" onClick={() => unlinkPhoto(linkModal.id, p.id)}>
                          연결 해제
                        </button>
                      </div>
                    );
                  })}
                  {linkedPhotos.length === 0 && <p>연결된 사진이 없습니다.</p>}
                </div>

                {candidatePhotos.length > 0 && (
                  <>
                    <h4>연결 후보 (자동 확정되지 않음 — 검토 필요)</h4>
                    <div className="photo-grid">
                      {candidatePhotos.map(({ photo: p, candidate }) => (
                        <div key={p.id} className="photo-thumb">
                          {p.image.dataUrl && <img src={p.image.dataUrl} alt={p.caption ?? p.id} />}
                          <span>
                            {p.photoNo ?? p.id} · p.{p.page}
                          </span>
                          <span>
                            점수 {candidate.score} — {candidate.reasons.join(", ")}
                            {candidate.conflict ? " ⚠ 정보 충돌" : ""}
                          </span>
                          <button onClick={() => linkPhoto(linkModal.id, p.id)}>이 사진 연결</button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <p>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={linkModal.photoMatchOverride === "noPhoto"}
                      onChange={(e) => markNoPhoto(linkModal.id, e.target.checked)}
                    />
                    이 손상은 사진 없음으로 표시
                  </label>
                </p>

                <h4>직접 업로드한 사진 (수동, STEP4)</h4>
                <div className="photo-grid">
                  {linkModal.photos.map((p) => (
                    <div key={p.id} className="photo-thumb">
                      {p.url && <img src={p.url} alt={p.caption ?? p.id} />}
                      <span>{p.caption ?? p.id}</span>
                    </div>
                  ))}
                  {linkModal.photos.length === 0 && <p>직접 업로드한 사진이 없습니다.</p>}
                </div>
                <input type="file" multiple accept="image/*" onChange={(e) => onPhotoFileChange(linkModal, e.target.files)} />

                <button onClick={() => setLinkModal(null)}>닫기</button>
              </div>
            </div>
          );
        })()}

      {inspectorModal &&
        (() => {
          const d = inspectorModal;
          const linkedPhotos = photos.filter((p) => d.photoIds?.includes(p.id));
          return (
            <div className="modal-backdrop" onClick={() => setInspectorModal(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>손상 상세 Inspector — {d.id}</h3>

                <h4>손상 기본정보</h4>
                <p>
                  {d.section} / {d.damageName} / {d.part} / {d.subPart} / {d.location} / {d.repairMethod} /{" "}
                  {d.quantity ?? d.quantityGroup ?? "규모 정보 없음"}
                </p>

                <h4>AI 분석정보</h4>
                <p>
                  상태: {STATUS_LABEL[d.status]}
                  {d.crossValidation ? ` · 교차검증 신뢰도 ${(d.crossValidation.confidence * 100).toFixed(0)}%` : ""}
                </p>

                <h4>사진 ({linkedPhotos.length})</h4>
                <div className="photo-grid">
                  {linkedPhotos.map((p) => (
                    <div key={p.id} className="photo-thumb">
                      {p.image.dataUrl && <img src={p.image.dataUrl} alt={p.caption ?? p.id} />}
                      <span>
                        {p.photoNo ?? p.id} · p.{p.page}
                      </span>
                    </div>
                  ))}
                  {linkedPhotos.length === 0 && <p>{d.photoMatchOverride === "noPhoto" ? "사진 없음(확인됨)" : "연결된 사진 없음"}</p>}
                </div>

                <h4>교차검증</h4>
                {d.crossValidation ? (
                  <ul>
                    {d.crossValidation.evidence.map((e, i) => (
                      <li key={i}>
                        [{e.sourceType}] {e.fileName} → {e.result}
                      </li>
                    ))}
                    {d.crossValidation.evidence.length === 0 && <li>참고 근거 없음</li>}
                  </ul>
                ) : (
                  <p>교차검증 미실행 (추가자료 없음)</p>
                )}

                <h4>출처</h4>
                <ul>
                  {d.sourceReferences.map((r, i) => (
                    <li key={i}>
                      p.{r.page} ({r.type}){r.excerpt ? ` — "${r.excerpt}"` : ""}
                    </li>
                  ))}
                </ul>

                <h4>검수 기록</h4>
                <ul>
                  {(d.reviewHistory ?? []).map((h, i) => (
                    <li key={i}>
                      [{new Date(h.at).toLocaleString()}] {h.action}
                      {h.field ? ` — ${h.field}: ${h.from} → ${h.to}` : ""} ({h.source})
                    </li>
                  ))}
                  {(!d.reviewHistory || d.reviewHistory.length === 0) && <li>AI 추출 이후 수정 이력 없음</li>}
                </ul>
                {(d.fieldOverrides?.length ?? 0) > 0 && (
                  <>
                    <h4>사용자 수정값 (원본 보존)</h4>
                    <ul>
                      {d.fieldOverrides!.map((o, i) => (
                        <li key={i}>
                          {o.field}: 원본 "{o.originalValue}" → 현재 "{o.currentValue}"
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <button onClick={() => setInspectorModal(null)}>닫기</button>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
