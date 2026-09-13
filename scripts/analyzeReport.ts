import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expandAllGroups } from "../src/lib/normalize.js";
import { mergeDuplicates } from "../src/lib/mergeDuplicates.js";
import { buildExcelWorkbookBuffer, excelFileName } from "../src/lib/report/exportExcel.js";
import { buildWordDocumentBuffer, wordFileName } from "../src/lib/report/exportWord.js";
import { buildPdfArrayBuffer, pdfFileName } from "../src/lib/report/exportPdf.js";
import { createDefaultExportOptions, createReviewSession, type RawDamageGroup } from "../src/types.js";

/**
 * Claude Skill "report-damage-analysis"용 CLI. AI(Claude)가 보고서를 직접 읽고 만든
 * RawDamageGroup[] JSON을, 이 프로젝트의 실제 STEP4~5(정규화/중복통합)와 STEP10
 * (Excel/Word/PDF 생성) 로직에 그대로 통과시킨다 — 로직을 다시 구현하지 않는다.
 *
 * 이 스크립트가 하지 않는 것(정직하게 밝힘): STEP6/7 사진 추출·연결과 STEP8 교차검증은
 * pdfjs-dist의 canvas 렌더링(document.createElement("canvas"))에 의존해 브라우저 전용이라
 * Node CLI로는 재사용할 수 없다. 그래서 사진 없이 손상 목록/출처만 출력한다. 사진까지
 * 필요하면 웹앱(npm run dev)에서 직접 PDF를 업로드해야 한다.
 *
 * 사용법:
 *   npx vite-node scripts/analyzeReport.ts --input <RawDamageGroup[].json> --report-name <이름> --out <출력폴더> [--formats excel,word,pdf]
 */

interface Args {
  input: string;
  reportName: string;
  facilityName: string;
  facilityType: string;
  outDir: string;
  formats: string[];
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback = ""): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const input = get("--input");
  if (!input) throw new Error("--input <RawDamageGroup[].json 경로>가 필요합니다.");
  const reportName = get("--report-name", "보고서");
  const formatsRaw = get("--formats", "excel,word,pdf");
  return {
    input,
    reportName,
    facilityName: get("--facility-name", ""),
    facilityType: get("--facility-type", ""),
    outDir: get("--out", "."),
    formats: formatsRaw.split(",").map((s) => s.trim()).filter(Boolean),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(readFileSync(resolve(args.input), "utf-8")) as RawDamageGroup[];
  if (!Array.isArray(raw)) throw new Error("--input 파일은 RawDamageGroup[] 형태의 JSON 배열이어야 합니다.");

  const rawRecords = expandAllGroups(raw);
  const records = mergeDuplicates(rawRecords);
  const mergedCount = records.filter((r) => r.mergeInfo?.merged).length;
  const conflictCount = records.filter((r) => r.status === "conflict").length;

  const session = { ...createReviewSession(), reportName: args.reportName, facilityName: args.facilityName, facilityType: args.facilityType };
  // 사진/교차검증/검수이력은 이 스크립트에 존재하지 않는 데이터이므로 출력 항목에서 끈다 —
  // 빈 시트를 "값이 0건"인 것처럼 꾸미지 않는다(STEP10의 anti-fabrication 원칙과 동일).
  const options = { ...createDefaultExportOptions(), includePhotos: false, includeCrossValidation: false, includeReviewHistory: false };

  mkdirSync(args.outDir, { recursive: true });
  const written: string[] = [];

  if (args.formats.includes("excel")) {
    const buf = buildExcelWorkbookBuffer(records, [], options);
    const path = resolve(args.outDir, excelFileName(session));
    writeFileSync(path, Buffer.from(buf));
    written.push(path);
  }
  if (args.formats.includes("word")) {
    const buf = await buildWordDocumentBuffer(session, records, [], [], options);
    const path = resolve(args.outDir, wordFileName(session));
    writeFileSync(path, Buffer.from(buf));
    written.push(path);
  }
  if (args.formats.includes("pdf")) {
    const buf = buildPdfArrayBuffer(session, records, [], [], options);
    const path = resolve(args.outDir, pdfFileName(session));
    writeFileSync(path, Buffer.from(buf));
    written.push(path);
  }

  console.log(
    JSON.stringify(
      {
        groupCount: raw.length,
        individualDamageCount: rawRecords.length,
        mergedRecordCount: records.length,
        mergedCount,
        conflictCount,
        files: written,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
