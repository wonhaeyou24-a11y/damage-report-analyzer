import { useState } from "react";
import { extractPdfText, formatPagesForPrompt } from "../lib/pdf";
import { extractDamageGroupsWithClaude } from "../lib/claude";
import { expandAllGroups } from "../lib/normalize";
import { mergeDuplicates } from "../lib/mergeDuplicates";
import { extractPhotosFromPdf } from "../lib/photoExtraction";
import { matchPhotosToDamages } from "../lib/matchPhotos";
import type { DamageRecord, ExtractedPhoto } from "../types";
import { SAMPLE_GROUPS } from "../lib/sampleData";
import { SAMPLE_PHOTOS } from "../lib/photoSampleData";

interface Props {
  onResult: (records: DamageRecord[]) => void;
  onPhotosResult: (photos: ExtractedPhoto[]) => void;
}

const API_KEY_STORAGE = "damage-analyzer-api-key";

export default function UploadPanel({ onResult, onPhotosResult }: Props) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const saveKey = (value: string) => {
    setApiKey(value);
    localStorage.setItem(API_KEY_STORAGE, value);
  };

  const analyze = async () => {
    if (!file) {
      setStatus("PDF 파일을 먼저 선택하세요.");
      return;
    }
    if (!apiKey) {
      setStatus("Claude API 키를 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      setStatus("PDF에서 텍스트 추출 중...");
      const pages = await extractPdfText(file);
      const text = formatPagesForPrompt(pages);
      setStatus("AI로 손상 그룹 분석 중... (문서 길이에 따라 시간이 걸릴 수 있습니다)");
      const groups = await extractDamageGroupsWithClaude(apiKey, text);
      const rawRecords = expandAllGroups(groups);
      const records = mergeDuplicates(rawRecords);
      const mergedCount = records.filter((r) => r.mergeInfo?.merged).length;
      const conflictCount = records.filter((r) => r.status === "conflict").length;

      let photoStatusNote = "사진 추출 실패 (손상 데이터는 정상 반영됨)";
      let finalRecords = records;
      try {
        setStatus("PDF에서 사진 후보 추출 중... (임베디드 이미지 탐색 + OCR)");
        const photos = await extractPhotosFromPdf(file);
        setStatus("손상-사진 자동 매칭 중...");
        const matched = matchPhotosToDamages(records, photos);
        finalRecords = matched.damages;
        onPhotosResult(matched.photos);
        const confirmedPhotoCount = matched.photos.filter((p) => p.matchStatus === "confirmed").length;
        photoStatusNote = `사진 후보 ${photos.length}건 추출 → 자동 연결 ${confirmedPhotoCount}건`;
      } catch (photoErr: any) {
        // 사진 추출/매칭 실패가 이미 완료된 손상 분석 결과에 영향을 주지 않도록 별도로 처리한다.
        photoStatusNote = `사진 추출 실패: ${photoErr.message ?? String(photoErr)}`;
      }

      onResult(finalRecords);
      setStatus(
        `완료: 손상 그룹 ${groups.length}개 → 개별 손상 ${rawRecords.length}건 → 통합 후 ${records.length}건 (중복통합 ${mergedCount}건, 정보불일치 ${conflictCount}건) / ${photoStatusNote}`
      );
    } catch (err: any) {
      setStatus(`오류: ${err.message ?? String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const loadSample = () => {
    const rawRecords = expandAllGroups(SAMPLE_GROUPS);
    const records = mergeDuplicates(rawRecords);
    const matched = matchPhotosToDamages(records, SAMPLE_PHOTOS);
    onResult(matched.damages);
    onPhotosResult(matched.photos);
    const confirmedPhotoCount = matched.photos.filter((p) => p.matchStatus === "confirmed").length;
    setStatus(
      `샘플 데이터 로드: 그룹 ${SAMPLE_GROUPS.length}개 → 개별 손상 ${rawRecords.length}건 → 통합 후 ${records.length}건 / 샘플 사진 ${SAMPLE_PHOTOS.length}건 → 자동 연결 ${confirmedPhotoCount}건`
    );
  };

  return (
    <div className="upload-panel">
      <div className="upload-row">
        <label>
          Claude API 키
          <input
            type="password"
            value={apiKey}
            onChange={(e) => saveKey(e.target.value)}
            placeholder="sk-ant-..."
          />
        </label>
        <label>
          보고서 PDF
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <button onClick={analyze} disabled={busy}>
          {busy ? "분석 중..." : "분석 시작"}
        </button>
        <button onClick={loadSample} disabled={busy} className="secondary">
          샘플 데이터로 미리보기
        </button>
      </div>
      {status && <p className="status-line">{status}</p>}
    </div>
  );
}
