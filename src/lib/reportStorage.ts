import type { AdditionalDocument, CandidateDamage, DamageRecord, ExportHistoryEntry, ExtractedPhoto, ReviewSession } from "../types";

/**
 * 분석 1건의 전체 작업 상태 스냅샷. IndexedDB에 저장되는 최소 단위이기도 하다(이 인터페이스가
 * 곧 저장 스키마). App.tsx가 화면에 보여주는 "분석한 보고서 목록"의 각 항목과 정확히 같다.
 */
export interface AnalyzedReport {
  id: string;
  sourceName: string; // 원본 PDF 파일명 또는 "샘플 데이터"
  createdAt: string;
  records: DamageRecord[];
  photos: ExtractedPhoto[];
  documents: AdditionalDocument[];
  candidateDamages: CandidateDamage[];
  session: ReviewSession;
  exportHistory: ExportHistoryEntry[];
}

const DB_NAME = "damage-report-analyzer";
const DB_VERSION = 1;
const STORE_NAME = "reports";

/**
 * 분석한 보고서(손상목록/사진 포함)를 새로고침 후에도 다시 볼 수 있도록 브라우저에 저장한다.
 * localStorage(보통 5~10MB 한도, 동기 API)는 사진 dataUrl이 많은 실제 보고서 하나만으로도
 * 한도를 넘기기 쉬워 쓰지 않는다 — IndexedDB(훨씬 큰 한도, 비동기)를 쓴다. 별도 라이브러리
 * 없이 브라우저 내장 API만 사용한다(이 프로젝트가 localStorage도 직접 쓰는 것과 같은 방식).
 *
 * 저장 실패(예: 프라이빗 모드, 저장공간 부족)가 분석 기능 자체를 막아서는 안 되므로, 호출부는
 * 이 함수들을 try/catch로 감싸고 실패해도 화면 동작은 그대로 유지해야 한다.
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB를 열지 못했습니다."));
  });
}

export async function loadAllReports(): Promise<AnalyzedReport[]> {
  const db = await openDb();
  try {
    return await new Promise<AnalyzedReport[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as AnalyzedReport[]);
      req.onerror = () => reject(req.error ?? new Error("저장된 보고서를 불러오지 못했습니다."));
    });
  } finally {
    db.close();
  }
}

export async function saveReport(report: AnalyzedReport): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(report);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("보고서를 저장하지 못했습니다."));
    });
  } finally {
    db.close();
  }
}

export async function deleteReport(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("보고서를 삭제하지 못했습니다."));
    });
  } finally {
    db.close();
  }
}

export async function clearAllReports(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("전체 삭제에 실패했습니다."));
    });
  } finally {
    db.close();
  }
}
