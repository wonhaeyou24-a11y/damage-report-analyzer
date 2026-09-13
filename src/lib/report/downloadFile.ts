/** 브라우저에서 바이트 데이터를 파일로 다운로드한다. Excel/Word/PDF 생성 로직과 분리해서
 * 그 로직 자체는 (Node에서도 실행 가능한) 순수 함수로 남기고, 이 함수만 DOM에 의존한다. */
export function downloadBytes(bytes: ArrayBuffer | Uint8Array, fileName: string, mimeType: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const MIME_TYPES = {
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;
