import { useMemo, useState } from "react";
import type { AdditionalDocument, DamageRecord, ExtractedPhoto } from "../types";
import { extractPdfText, formatPagesForPrompt } from "../lib/pdf";
import { getActiveProvider, getAiProviderStatus } from "../lib/ai/providerManager";
import { getActiveProviderId, getGeminiModel } from "../lib/ai/settings";
import { MODEL as CLAUDE_MODEL } from "../lib/claude";
import { expandAllGroups } from "../lib/normalize";
import { mergeDuplicates } from "../lib/mergeDuplicates";
import { extractPhotosFromPdf } from "../lib/photoExtraction";
import { matchPhotosToDamages } from "../lib/matchPhotos";
import { loadAdditionalDocuments } from "../lib/additionalDocs/loadDocuments";
import { runCrossValidation } from "../lib/crossValidate";
import { downloadBytes, MIME_TYPES } from "../lib/report/downloadFile";

import type { RunPair } from "../validation/dashboard";
import { aggregateByDifficulty, aggregateByFacilityType, aggregateByReportFormat, checkUniversalityCriteria, computeOverallSummary } from "../validation/dashboard";
import { aggregateErrorsByCategory } from "../validation/errorAnalysis";
import { buildValidationExcelBuffer, validationExcelFileName } from "../validation/exportValidationExcel";
import { compareRuns } from "../validation/regression";
import { buildValidationRun, runFullValidation } from "../validation/runValidation";
import { createEmptyGroundTruth, DIFFICULTIES, FACILITY_TYPES } from "../validation/types";
import type { Difficulty, ErrorEntry, FacilityType, GroundTruthDamage, TestCase, TokenUsage, ValidationRun } from "../validation/types";
import type { StandardPart } from "../types";
import { STANDARD_PARTS } from "../types";
import { getAiCallLog } from "../lib/ai/aiCallLog";

const ENGINE_VERSION = "1.0.0";
const PROMPT_VERSION = "v1";

type View = "list" | "groundTruth" | "dashboard" | "errors";

let testCaseCounter = 0;
function nextTestCaseId(): string {
  testCaseCounter += 1;
  return `T${String(testCaseCounter).padStart(3, "0")}`;
}
let gtDamageCounter = 0;
function nextGtDamageId(): string {
  gtDamageCounter += 1;
  return `GT-${String(gtDamageCounter).padStart(3, "0")}`;
}

interface StoredFiles {
  report: File;
  additional: File[];
}

export default function ValidationApp() {
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [files, setFiles] = useState<Record<string, StoredFiles>>({});
  const [runsByTestCase, setRunsByTestCase] = useState<Record<string, ValidationRun[]>>({});
  const [view, setView] = useState<View>("list");
  const [activeTestCaseId, setActiveTestCaseId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  // STEP 12-1: 검증 실행에 실제 사용 중인 Provider/Model을 기록한다(스펙 17번) — 더 이상
  // "anthropic"/"claude-sonnet-5"로 하드코딩하지 않는다.
  const currentProviderMeta = () => {
    const providerId = getActiveProviderId();
    return { provider: providerId, model: providerId === "gemini" ? getGeminiModel() : CLAUDE_MODEL };
  };

  const latestRunPairs: RunPair[] = useMemo(
    () =>
      testCases
        .map((tc) => {
          const runs = runsByTestCase[tc.id] ?? [];
          const latest = runs[runs.length - 1];
          return latest ? { testCase: tc, run: latest } : null;
        })
        .filter((p): p is RunPair => p !== null),
    [testCases, runsByTestCase]
  );

  const addTestCase = (file: File) => {
    const tc: TestCase = {
      id: nextTestCaseId(),
      reportFileName: file.name,
      reportName: file.name.replace(/\.pdf$/i, ""),
      facilityType: "비탈면",
      reportFormat: "",
      vendorType: "",
      difficulty: "LOW",
      additionalFiles: [],
      groundTruth: createEmptyGroundTruth(),
      runs: [],
      status: "not_run",
    };
    setTestCases((prev) => [...prev, tc]);
    setFiles((prev) => ({ ...prev, [tc.id]: { report: file, additional: [] } }));
  };

  const updateTestCase = (id: string, patch: Partial<TestCase>) => {
    setTestCases((prev) => prev.map((tc) => (tc.id === id ? { ...tc, ...patch } : tc)));
  };

  const addAdditionalFiles = (id: string, fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles = Array.from(fileList);
    setFiles((prev) => ({ ...prev, [id]: { report: prev[id].report, additional: [...prev[id].additional, ...newFiles] } }));
    updateTestCase(id, {
      additionalFiles: [
        ...(testCases.find((tc) => tc.id === id)?.additionalFiles ?? []),
        ...newFiles.map((f) => ({ fileName: f.name, fileType: (f.name.split(".").pop()?.toLowerCase() as any) ?? "pdf" })),
      ],
    });
  };

  // ---- 실제 STEP1~10 파이프라인을 그대로 호출하는 executor. 검증 로직이 분석 로직을 우회하지 않는다. ----
  // 테스트가 1건뿐이면 runAll의 "N/M건" 진행률은 끝날 때까지 0/1에 머물러 아무 정보가 안 되므로,
  // 보고서 분석 화면(UploadPanel)과 동일하게 이 실행 하나 안에서의 단계별 진행 상황도 보여준다.
  const executeAnalysis = async (
    testCase: TestCase
  ): Promise<{ aiDamages: DamageRecord[]; aiPhotos: ExtractedPhoto[]; processingTimeMs: number; tokenUsage: TokenUsage }> => {
    const stored = files[testCase.id];
    if (!stored) throw new Error("원본 보고서 파일이 없습니다.");
    const aiStatus = getAiProviderStatus();
    if (!aiStatus.ready) throw new Error(aiStatus.reason ?? "AI Provider가 연결되지 않았습니다.");

    const start = Date.now();
    setStatus(`${testCase.id}: PDF에서 텍스트 추출 중... (0/?페이지)`);
    const pages = await extractPdfText(stored.report, (page, total) =>
      setStatus(`${testCase.id}: PDF에서 텍스트 추출 중... (${page}/${total}페이지)`)
    );
    const text = formatPagesForPrompt(pages);

    const aiStart = Date.now();
    setStatus(`${testCase.id}: AI로 손상 그룹 분석 중... (0초 경과)`);
    const timer = setInterval(() => setStatus(`${testCase.id}: AI로 손상 그룹 분석 중... (${Math.round((Date.now() - aiStart) / 1000)}초 경과)`), 1000);
    let groups;
    try {
      groups = await getActiveProvider().analyzeDocument(text);
    } finally {
      clearInterval(timer);
    }
    const rawRecords = expandAllGroups(groups);
    const merged = mergeDuplicates(rawRecords);
    setStatus(`${testCase.id}: PDF에서 사진 후보 추출 중... (0/?페이지)`);
    const photos = await extractPhotosFromPdf(stored.report, (page, total) =>
      setStatus(`${testCase.id}: PDF에서 사진 후보 추출 중... (${page}/${total}페이지)`)
    );
    const matched = matchPhotosToDamages(merged, photos);

    let finalDamages = matched.damages;
    if (stored.additional.length > 0) {
      const documents: AdditionalDocument[] = await loadAdditionalDocuments(stored.additional);
      finalDamages = runCrossValidation(finalDamages, documents).damages;
    }

    // 이번 실행 동안 기록된 AI 호출 로그에서 실제 토큰 사용량만 집계한다(제공되지 않으면 null 유지, 임의 계산 안 함).
    const calls = getAiCallLog().filter((c) => c.startedAt >= start && c.operation === "damageExtraction");
    const hasUsage = calls.some((c) => c.tokenUsage);
    const tokenUsage: TokenUsage = hasUsage
      ? {
          inputTokens: calls.reduce((sum, c) => sum + (c.tokenUsage?.inputTokens ?? 0), 0),
          outputTokens: calls.reduce((sum, c) => sum + (c.tokenUsage?.outputTokens ?? 0), 0),
          totalTokens: calls.reduce((sum, c) => sum + (c.tokenUsage?.totalTokens ?? 0), 0),
          estimatedCost: "미제공",
        }
      : { inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: "미제공" };

    return { aiDamages: finalDamages, aiPhotos: matched.photos, processingTimeMs: Date.now() - start, tokenUsage };
  };

  const runSingle = async (id: string) => {
    const tc = testCases.find((t) => t.id === id);
    if (!tc) return;
    setBusy(true);
    setStatus(`${id} 분석 및 검증 실행 중...`);
    try {
      const result = await executeAnalysis(tc);
      const run = buildValidationRun({
        testCase: tc,
        aiDamages: result.aiDamages,
        aiPhotos: result.aiPhotos,
        processingTimeMs: result.processingTimeMs,
        tokenUsage: result.tokenUsage,
        engineVersion: ENGINE_VERSION,
        promptVersion: PROMPT_VERSION,
        ...currentProviderMeta(),
      });
      setRunsByTestCase((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), run] }));
      updateTestCase(id, { runs: [...tc.runs, run.id], status: "completed" });
      setStatus(`${id} 검증 완료 — F1 ${(run.metrics.overallF1 * 100).toFixed(1)}% (${run.metrics.status})`);
    } catch (err: any) {
      updateTestCase(id, { status: "failed" });
      setStatus(`${id} 실패: ${err.message ?? String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const runAll = async () => {
    setBusy(true);
    setStatus(`전체 검증 실행 중... (0/${testCases.length}건)`);
    const outcomes = await runFullValidation(
      testCases,
      (tc) => executeAnalysis(tc),
      { engineVersion: ENGINE_VERSION, promptVersion: PROMPT_VERSION, ...currentProviderMeta() },
      undefined,
      (done, total, testCaseId) => setStatus(`전체 검증 실행 중... (${done}/${total}건, 방금 완료: ${testCaseId})`)
    );
    setRunsByTestCase((prev) => {
      const next = { ...prev };
      for (const o of outcomes) {
        if (o.run) next[o.testCaseId] = [...(next[o.testCaseId] ?? []), o.run];
      }
      return next;
    });
    setTestCases((prev) =>
      prev.map((tc) => {
        const outcome = outcomes.find((o) => o.testCaseId === tc.id);
        if (!outcome) return tc;
        return outcome.run ? { ...tc, runs: [...tc.runs, outcome.run.id], status: "completed" } : { ...tc, status: "failed" };
      })
    );
    const succeeded = outcomes.filter((o) => o.run).length;
    setStatus(`전체 검증 완료: ${succeeded}/${testCases.length}건 성공 (하나 실패해도 나머지는 계속 진행됨)`);
    setBusy(false);
  };

  const exportExcel = () => {
    const buf = buildValidationExcelBuffer(testCases, latestRunPairs);
    downloadBytes(buf, validationExcelFileName(), MIME_TYPES.excel);
  };

  const summary = computeOverallSummary(latestRunPairs, testCases.length);
  const universality = checkUniversalityCriteria(latestRunPairs, testCases);
  const allErrors: ErrorEntry[] = latestRunPairs.flatMap((p) => p.run.errors);
  const errorAgg = aggregateErrorsByCategory(allErrors);

  const activeTestCase = testCases.find((tc) => tc.id === activeTestCaseId) ?? null;

  return (
    <div className="validation-app">
      <div className="tab-bar">
        <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
          테스트 목록 ({testCases.length})
        </button>
        <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
          결과 대시보드
        </button>
        <button className={view === "errors" ? "active" : ""} onClick={() => setView("errors")}>
          오류 분석 ({allErrors.length})
        </button>
      </div>

      {status && <p className="status-line">{status}</p>}

      {view === "list" && (
        <div className="validation-list">
          <div className="toolbar">
            <label className="secondary-upload">
              + 테스트 보고서 추가
              <input type="file" accept=".pdf" onChange={(e) => e.target.files?.[0] && addTestCase(e.target.files[0])} />
            </label>
            <button onClick={runAll} disabled={busy || testCases.length === 0}>
              전체 검증 실행
            </button>
            <button onClick={exportExcel} disabled={latestRunPairs.length === 0}>
              검증 결과 Excel
            </button>
          </div>

          <table className="photo-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>보고서명</th>
                <th>시설물</th>
                <th>회사/양식</th>
                <th>난이도</th>
                <th>Ground Truth</th>
                <th>분석 상태</th>
                <th>F1</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {testCases.map((tc) => {
                const runs = runsByTestCase[tc.id] ?? [];
                const latest = runs[runs.length - 1];
                return (
                  <tr key={tc.id}>
                    <td>{tc.id}</td>
                    <td>
                      <input className="search-box" value={tc.reportName} onChange={(e) => updateTestCase(tc.id, { reportName: e.target.value })} />
                    </td>
                    <td>
                      <select value={tc.facilityType} onChange={(e) => updateTestCase(tc.id, { facilityType: e.target.value as FacilityType })}>
                        {FACILITY_TYPES.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="search-box"
                        placeholder="예: 양식 A"
                        value={tc.vendorType}
                        onChange={(e) => updateTestCase(tc.id, { vendorType: e.target.value })}
                      />
                    </td>
                    <td>
                      <select value={tc.difficulty} onChange={(e) => updateTestCase(tc.id, { difficulty: e.target.value as Difficulty })}>
                        {DIFFICULTIES.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        className="link-btn"
                        onClick={() => {
                          setActiveTestCaseId(tc.id);
                          setView("groundTruth");
                        }}
                      >
                        {tc.groundTruth?.locked ? `확정 (${tc.groundTruth.damages.length}건)` : `작성 (${tc.groundTruth?.damages.length ?? 0}건)`}
                      </button>
                    </td>
                    <td>{tc.status}</td>
                    <td>{latest ? `${(latest.metrics.overallF1 * 100).toFixed(1)}% (${latest.metrics.status})` : "N/A"}</td>
                    <td>
                      <button onClick={() => runSingle(tc.id)} disabled={busy || !tc.groundTruth?.locked}>
                        분석 실행
                      </button>
                    </td>
                  </tr>
                );
              })}
              {testCases.length === 0 && (
                <tr>
                  <td colSpan={9}>등록된 테스트 보고서가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view === "groundTruth" && activeTestCase && (
        <GroundTruthEditor
          testCase={activeTestCase}
          onChange={(gt) => updateTestCase(activeTestCase.id, { groundTruth: gt })}
          onAddAdditionalFiles={(fl) => addAdditionalFiles(activeTestCase.id, fl)}
          onBack={() => setView("list")}
        />
      )}

      {view === "dashboard" && (
        <div className="validation-dashboard">
          <h3>전체 요약</h3>
          <p>
            총 테스트 {summary.totalTestCases}건 · 완료 {summary.completed}건 · GOOD {summary.good} · WARNING {summary.warning} · FAIL {summary.fail}
          </p>
          <p>
            전체 Damage F1 {(summary.overallDamageF1 * 100).toFixed(1)}% · 위치 정확도 {(summary.overallLocationAccuracy * 100).toFixed(1)}% · 사진추출 F1{" "}
            {(summary.overallPhotoExtractionF1 * 100).toFixed(1)}% · 사진연결 F1 {(summary.overallPhotoLinkF1 * 100).toFixed(1)}%
          </p>
          <div className={universality.ok ? "hint" : "final-review-check-fail"}>
            {universality.label}
            {!universality.ok && (
              <ul>
                {universality.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>

          <h4>시설물별</h4>
          <GroupTable groups={aggregateByFacilityType(latestRunPairs)} />
          <h4>양식별</h4>
          <GroupTable groups={aggregateByReportFormat(latestRunPairs)} />
          <h4>난이도별</h4>
          <GroupTable groups={aggregateByDifficulty(latestRunPairs)} />

          <h4>Regression (재실행 비교)</h4>
          <ul>
            {testCases.map((tc) => {
              const runs = runsByTestCase[tc.id] ?? [];
              if (runs.length < 2) return null;
              const cmp = compareRuns(runs[runs.length - 2], runs[runs.length - 1]);
              return (
                <li key={tc.id}>
                  {tc.id}: {(cmp.prevF1 * 100).toFixed(1)}% → {(cmp.nextF1 * 100).toFixed(1)}% {cmp.warning ? "⚠ 큰 폭 하락" : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {view === "errors" && (
        <div className="validation-errors">
          <h3>오류 유형별 건수</h3>
          <ul>
            {errorAgg.map((a) => (
              <li key={a.category}>
                {a.category}: {a.count}건
              </li>
            ))}
            {errorAgg.length === 0 && <li>기록된 오류가 없습니다.</li>}
          </ul>

          <h3>오류 상세</h3>
          <table className="photo-table">
            <thead>
              <tr>
                <th>테스트</th>
                <th>단계</th>
                <th>항목</th>
                <th>Ground Truth</th>
                <th>AI</th>
                <th>GT 출처</th>
                <th>AI 출처</th>
                <th>유형</th>
              </tr>
            </thead>
            <tbody>
              {allErrors.map((e) => (
                <tr key={e.id}>
                  <td>{e.testCaseId}</td>
                  <td>{e.step}</td>
                  <td>{e.field ?? "-"}</td>
                  <td>{e.groundTruthValue ?? "-"}</td>
                  <td>{e.aiValue ?? "-"}</td>
                  <td>{e.groundTruthSource ?? "-"}</td>
                  <td>{e.aiSource ?? "-"}</td>
                  <td>{e.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GroupTable({ groups }: { groups: { key: string; testCount: number; avgF1: number; avgLocationAccuracy: number; avgPhotoLinkF1: number }[] }) {
  if (groups.length === 0) return <p className="hint">N/A (실제로 테스트된 항목 없음)</p>;
  return (
    <table className="photo-table">
      <thead>
        <tr>
          <th>구분</th>
          <th>테스트 수</th>
          <th>F1</th>
          <th>위치 정확도</th>
          <th>사진연결 F1</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.key}>
            <td>{g.key}</td>
            <td>{g.testCount}</td>
            <td>{(g.avgF1 * 100).toFixed(1)}%</td>
            <td>{(g.avgLocationAccuracy * 100).toFixed(1)}%</td>
            <td>{(g.avgPhotoLinkF1 * 100).toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface GtEditorProps {
  testCase: TestCase;
  onChange: (gt: NonNullable<TestCase["groundTruth"]>) => void;
  onAddAdditionalFiles: (files: FileList | null) => void;
  onBack: () => void;
}

function GroundTruthEditor({ testCase, onChange, onAddAdditionalFiles, onBack }: GtEditorProps) {
  const gt = testCase.groundTruth ?? createEmptyGroundTruth();

  const addRow = () => {
    const blank: GroundTruthDamage = {
      id: nextGtDamageId(),
      groupNo: "",
      section: "",
      damageName: "",
      part: "기타",
      subPart: "-",
      location: "",
      quantity: null,
      quantityGroup: null,
      repairMethod: "",
      sourceRefs: [],
      photoNos: [],
    };
    onChange({ ...gt, damages: [...gt.damages, blank] });
  };

  const updateRow = (id: string, patch: Partial<GroundTruthDamage>) => {
    onChange({ ...gt, damages: gt.damages.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  };

  const removeRow = (id: string) => {
    onChange({ ...gt, damages: gt.damages.filter((d) => d.id !== id) });
  };

  const lock = () => {
    onChange({ ...gt, locked: true, lockedAt: new Date().toISOString(), revisions: [...gt.revisions, { at: new Date().toISOString(), note: "검증 기준 확정" }] });
  };

  const unlock = () => {
    onChange({ ...gt, locked: false, revisions: [...gt.revisions, { at: new Date().toISOString(), note: "Ground Truth 수정 재개" }] });
  };

  return (
    <div className="ground-truth-editor">
      <button onClick={onBack}>← 목록으로</button>
      <h3>
        Ground Truth 작성 — {testCase.id} ({testCase.reportName})
      </h3>
      <p className="hint">사람이 실제 보고서를 확인해 명확히 알 수 있는 정보만 입력합니다. 보고서에 없는 정보는 추측해서 채우지 않습니다.</p>

      <div className="toolbar">
        <label className="secondary-upload">
          + 추가자료 첨부 (STEP8 검증용, 선택)
          <input type="file" multiple accept=".pdf,.xlsx,.xls,.docx,.doc" onChange={(e) => onAddAdditionalFiles(e.target.files)} />
        </label>
        {testCase.additionalFiles.length > 0 && <span>{testCase.additionalFiles.map((f) => f.fileName).join(", ")}</span>}
      </div>

      <table className="photo-table">
        <thead>
          <tr>
            <th>구간</th>
            <th>손상명</th>
            <th>부위</th>
            <th>세부부위</th>
            <th>위치</th>
            <th>보수방안</th>
            <th>규모/물량</th>
            <th>사진번호</th>
            <th>출처(페이지)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {gt.damages.map((d) => (
            <tr key={d.id}>
              <td>
                <input className="search-box" value={d.section} disabled={gt.locked} onChange={(e) => updateRow(d.id, { section: e.target.value })} />
              </td>
              <td>
                <input className="search-box" value={d.damageName} disabled={gt.locked} onChange={(e) => updateRow(d.id, { damageName: e.target.value })} />
              </td>
              <td>
                <select value={d.part} disabled={gt.locked} onChange={(e) => updateRow(d.id, { part: e.target.value as StandardPart })}>
                  {STANDARD_PARTS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input className="search-box" value={d.subPart} disabled={gt.locked} onChange={(e) => updateRow(d.id, { subPart: e.target.value })} />
              </td>
              <td>
                <input className="search-box" value={d.location} disabled={gt.locked} onChange={(e) => updateRow(d.id, { location: e.target.value })} />
              </td>
              <td>
                <input className="search-box" value={d.repairMethod} disabled={gt.locked} onChange={(e) => updateRow(d.id, { repairMethod: e.target.value })} />
              </td>
              <td>
                <input
                  className="search-box"
                  placeholder="개별 또는 그룹 합계"
                  value={d.quantity ?? d.quantityGroup ?? ""}
                  disabled={gt.locked}
                  onChange={(e) => updateRow(d.id, { quantity: e.target.value || null })}
                />
              </td>
              <td>
                <input
                  className="search-box"
                  value={d.photoNos.join(", ")}
                  disabled={gt.locked}
                  onChange={(e) => updateRow(d.id, { photoNos: e.target.value.split(/[,\s]+/).filter(Boolean) })}
                />
              </td>
              <td>
                <input
                  className="search-box"
                  type="number"
                  placeholder="p."
                  value={d.sourceRefs[0]?.page ?? ""}
                  disabled={gt.locked}
                  onChange={(e) => updateRow(d.id, { sourceRefs: [{ page: Number(e.target.value) || 0, type: "table" }] })}
                />
              </td>
              <td>
                {!gt.locked && (
                  <button className="link-btn danger" onClick={() => removeRow(d.id)}>
                    삭제
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!gt.locked && <button onClick={addRow}>+ 손상 행 추가</button>}

      <div className="toolbar">
        {!gt.locked ? (
          <button onClick={lock} disabled={gt.damages.length === 0}>
            검증 기준 확정
          </button>
        ) : (
          <button onClick={unlock}>Ground Truth 수정</button>
        )}
      </div>
    </div>
  );
}
