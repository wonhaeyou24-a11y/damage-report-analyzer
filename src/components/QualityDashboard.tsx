import type { AnalyzedReport } from "../lib/reportStorage";
import {
  computeCrossValidationChangeRate,
  computeErrorCategoryBreakdown,
  computeFieldRetention,
  computeImprovementCandidates,
  computePhotoExtractionQuality,
  computePhotoLinkRetention,
  computeRecentTrend,
  computeVersionBreakdown,
  computeWorkQualitySummary,
} from "../lib/quality/metrics";
import type { MetricValue } from "../lib/quality/types";
import { MIN_SAMPLE_SIZE } from "../lib/quality/types";

interface Props {
  reports: AnalyzedReport[];
}

/** 데이터가 부족하면 절대 %를 지어내지 않는다(스펙 12/13/23번) — 항상 표본 수와 함께 보여준다. */
function MetricCell({ label, metric }: { label: string; metric: MetricValue }) {
  if (!metric.sufficient || metric.value == null) {
    return (
      <div className="quality-metric">
        <div className="quality-metric-label">{label}</div>
        <div className="quality-metric-value hint">
          데이터 부족 (검토 데이터 {metric.sampleSize}건, 최소 {MIN_SAMPLE_SIZE}건 필요)
        </div>
      </div>
    );
  }
  return (
    <div className="quality-metric">
      <div className="quality-metric-label">{label}</div>
      <div className="quality-metric-value">{(metric.value * 100).toFixed(1)}%</div>
      <div className="quality-metric-sample">검토 데이터 {metric.sampleSize}건</div>
    </div>
  );
}

export default function QualityDashboard({ reports }: Props) {
  const summary = computeWorkQualitySummary(reports);
  const fieldRetention = computeFieldRetention(reports);
  const photoExtraction = computePhotoExtractionQuality(reports);
  const photoLinkRetention = computePhotoLinkRetention(reports);
  const allEvents = reports.flatMap((r) => r.qualityEvents ?? []);
  const crossValidationChangeRate = computeCrossValidationChangeRate(allEvents);
  const errorCategories = computeErrorCategoryBreakdown(allEvents);
  const recentTrend = computeRecentTrend(allEvents);
  const versionBreakdown = computeVersionBreakdown(reports);
  const improvementCandidates = computeImprovementCandidates(reports);
  const legacyCount = reports.filter((r) => r.legacy).length;

  if (reports.length === 0) {
    return (
      <div className="quality-dashboard">
        <p className="empty-state">
          아직 분석한 보고서가 없습니다. 보고서를 분석하고 검토/수정/확정하는 과정이 쌓이면 이 화면에 품질 지표가 나타납니다.
          <br />
          별도의 테스트 절차는 필요하지 않습니다 — 실제 업무를 진행할수록 자동으로 데이터가 쌓입니다.
        </p>
      </div>
    );
  }

  return (
    <div className="quality-dashboard">
      <h2>품질 Dashboard</h2>
      <p className="hint">
        여기 보이는 지표는 사람이 직접 만든 정답(Ground Truth)이 아니라, 실제 검토·수정 과정에서 자동으로 쌓인 데이터를 기준으로 합니다. "AI가
        정확했다"는 뜻이 아니라 "사용자가 AI 결과를 얼마나 그대로 유지했는지/고쳤는지"를 보여줍니다.
        {legacyCount > 0 && ` (이 기능 도입 이전에 저장된 보고서 ${legacyCount}건은 세부 이벤트 없이 현재 상태만 집계에 포함됩니다.)`}
      </p>

      <h3>전체 품질</h3>
      <div className="quality-summary-grid">
        <div className="quality-summary-item">
          <span>분석 보고서</span>
          <strong>{summary.totalReports}건</strong>
        </div>
        <div className="quality-summary-item">
          <span>분석 손상</span>
          <strong>{summary.totalDamages}건</strong>
        </div>
        <div className="quality-summary-item">
          <span>검토 완료</span>
          <strong>{summary.reviewedDamages}건</strong>
        </div>
        <div className="quality-summary-item">
          <span>미검토</span>
          <strong>{summary.unreviewedDamages}건</strong>
        </div>
        <div className="quality-summary-item">
          <span>사용자 수정</span>
          <strong>{summary.userModifiedDamages}건</strong>
        </div>
        <div className="quality-summary-item">
          <span>사용자 추가</span>
          <strong>{summary.userAddedDamages}건</strong>
        </div>
        <div className="quality-summary-item">
          <span>사용자 제외</span>
          <strong>{summary.userExcludedDamages}건</strong>
        </div>
      </div>

      <h3>검토 후 유지율 (필드별)</h3>
      <p className="hint">미검토 손상은 계산에서 제외됩니다 — 사용자가 아직 보지 않은 값을 "AI가 맞았다"는 근거로 쓰지 않습니다.</p>
      <div className="quality-summary-grid">
        {fieldRetention.map((row) => (
          <MetricCell key={row.field} label={row.label} metric={row.metric} />
        ))}
      </div>

      <h3>사진 품질</h3>
      <div className="quality-summary-grid">
        <MetricCell label="사진 추출 (extractionStatus 기준)" metric={photoExtraction} />
        <MetricCell label="사진 연결 유지율 (자동연결이 그대로 유지된 비율)" metric={photoLinkRetention} />
      </div>

      <h3>교차검증 변경률</h3>
      <p className="hint">사용자가 STEP8 충돌을 해결하면서 본문 값을 그대로 두지 않고 추가자료 값으로 바꾼 비율입니다.</p>
      <MetricCell label="교차검증 변경률" metric={crossValidationChangeRate} />

      <h3>오류 후보 (필드별 수정 이벤트 집계)</h3>
      <p className="hint">
        이 표는 "확정된 AI 오류"가 아니라 "AI 결과와 최종 결과가 달랐던 사례"입니다. 사용자 판단 차이일 수도 있습니다(스펙 18번).
      </p>
      {errorCategories.length === 0 ? (
        <p className="hint">아직 집계할 이벤트가 없습니다.</p>
      ) : (
        <table className="photo-table">
          <thead>
            <tr>
              <th>유형</th>
              <th>건수</th>
            </tr>
          </thead>
          <tbody>
            {errorCategories.map((row) => (
              <tr key={row.category}>
                <td>{row.category}</td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {recentTrend.length > 0 && (
        <>
          <h3>최근 추세</h3>
          <table className="photo-table">
            <thead>
              <tr>
                <th>유형</th>
                <th>이전 구간</th>
                <th>최근 구간</th>
                <th>방향</th>
              </tr>
            </thead>
            <tbody>
              {recentTrend.map((t) => (
                <tr key={t.category}>
                  <td>{t.category}</td>
                  <td>
                    {(t.previousRate * 100).toFixed(1)}% ({t.previousSample}건)
                  </td>
                  <td>
                    {(t.recentRate * 100).toFixed(1)}% ({t.recentSample}건)
                  </td>
                  <td>{t.direction === "improved" ? "개선" : t.direction === "worsened" ? "악화" : "동일"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>Provider / Model / Prompt / Engine 버전별 품질</h3>
      {versionBreakdown.length === 0 ? (
        <p className="hint">버전 정보가 기록된 분석이 아직 없습니다(이 기능 도입 이전 데이터는 버전을 알 수 없어 제외됩니다).</p>
      ) : (
        versionBreakdown.map((v) => (
          <div key={v.key} className="additional-data-panel">
            <h4>
              {v.provider} / {v.model} / Prompt {v.promptVersion} / Engine {v.engineVersion} ({v.reportCount}건)
            </h4>
            <div className="quality-summary-grid">
              {v.fieldRetention.map((row) => (
                <MetricCell key={row.field} label={row.label} metric={row.metric} />
              ))}
            </div>
          </div>
        ))
      )}

      <h3>개선 후보</h3>
      <p className="hint">Prompt/Rule/Model은 자동으로 바뀌지 않습니다. 아래는 개발자가 검토할 후보일 뿐입니다(스펙 29번).</p>
      {improvementCandidates.length === 0 ? (
        <p className="hint">현재 표본으로는 뚜렷한 개선 후보가 없습니다.</p>
      ) : (
        <ul>
          {improvementCandidates.map((c) => (
            <li key={c.field}>{c.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
