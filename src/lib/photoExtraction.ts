import * as pdfjsLib from "pdfjs-dist";
import type { ExtractedPhoto, PhotoSourceRef } from "../types";
import {
  averageHashFromGrayscale,
  classifyDamageRelated,
  detectDuplicateCandidates,
  parseDamageNameFromText,
  parseLocationFromText,
  parsePhotoNo,
  parseSubPartFromText,
} from "./photoAnalysis";
import { runOcr } from "./ocr";

const { OPS } = pdfjsLib;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

interface ImagePlacement {
  bboxPdf: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * 페이지의 operator list를 순회하며 이미지가 그려진 위치(단위 사각형이 CTM으로
 * 변환된 영역)를 찾는다. 한 페이지에 여러 사진이 있어도 각각 개별 위치로 잡힌다.
 */
async function findImagePlacements(page: pdfjsLib.PDFPageProxy): Promise<ImagePlacement[]> {
  const opList = await page.getOperatorList();
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  const placements: ImagePlacement[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === OPS.transform) {
      ctm = multiply(args as Matrix, ctm);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageXObject) {
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y]) => applyMatrix(ctm, x, y));
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      placements.push({ bboxPdf: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } });
    }
  }
  return placements;
}

interface TextItemPixel {
  x: number;
  y: number;
  str: string;
}

function pdfTextItemsToPixels(items: any[], viewport: pdfjsLib.PageViewport): TextItemPixel[] {
  return items
    .filter((it) => typeof it.str === "string" && it.str.trim())
    .map((it) => {
      const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      return { x, y, str: it.str as string };
    });
}

function nearbyTextFor(bbox: { x0: number; y0: number; x1: number; y1: number }, items: TextItemPixel[], margin = 60): string {
  const hits = items.filter((it) => it.y >= bbox.y0 - margin && it.y <= bbox.y1 + margin && it.x >= bbox.x0 - margin && it.x <= bbox.x1 + margin);
  hits.sort((a, b) => a.y - b.y || a.x - b.x);
  return hits.map((h) => h.str).join(" ").trim();
}

function computeGrayscaleHash(ctx: CanvasRenderingContext2D, width: number, height: number, size = 8): string {
  const small = document.createElement("canvas");
  small.width = size;
  small.height = size;
  const sctx = small.getContext("2d")!;
  sctx.drawImage(ctx.canvas, 0, 0, width, height, 0, 0, size, size);
  const { data } = sctx.getImageData(0, 0, size, size);
  const gray: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return averageHashFromGrayscale(gray, size);
}

let idCounter = 0;
function nextPhotoId(): string {
  idCounter += 1;
  return `P${String(idCounter).padStart(3, "0")}`;
}

/**
 * STEP 6 — PDF에서 손상사진 후보를 추출한다. 임베디드 이미지 위치(bounding box)를
 * 찾아 각각 개별 크롭으로 분리하고, 페이지 텍스트에서 사진번호/캡션/위치 등을
 * 최대한 파싱한다. 문서에서 확인되지 않은 값은 만들어내지 않고 null로 남긴다.
 * 이미지 하나의 처리 실패가 전체 분석을 막지 않도록 개별적으로 예외를 처리한다.
 */
export async function extractPhotosFromPdf(file: File): Promise<ExtractedPhoto[]> {
  idCounter = 0;
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const photos: ExtractedPhoto[] = [];
  const RENDER_SCALE = 2;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    let placements: ImagePlacement[] = [];
    let textItemsPixel: TextItemPixel[] = [];
    let pageCanvas: HTMLCanvasElement | null = null;

    try {
      placements = await findImagePlacements(page);
      if (placements.length === 0) continue;

      const textContent = await page.getTextContent();
      textItemsPixel = pdfTextItemsToPixels(textContent.items, viewport);

      pageCanvas = document.createElement("canvas");
      pageCanvas.width = Math.ceil(viewport.width);
      pageCanvas.height = Math.ceil(viewport.height);
      const pageCtx = pageCanvas.getContext("2d")!;
      await page.render({ canvasContext: pageCtx, viewport, canvas: pageCanvas }).promise;
    } catch (err: any) {
      photos.push(
        buildFailedPhoto(file.name, pageNum, err?.message ?? "페이지 렌더링 실패")
      );
      continue;
    }

    for (const placement of placements) {
      try {
        const corners = [
          [placement.bboxPdf.x0, placement.bboxPdf.y0],
          [placement.bboxPdf.x1, placement.bboxPdf.y0],
          [placement.bboxPdf.x0, placement.bboxPdf.y1],
          [placement.bboxPdf.x1, placement.bboxPdf.y1],
        ].map(([x, y]) => viewport.convertToViewportPoint(x, y));
        const xs = corners.map((c) => c[0]);
        const ys = corners.map((c) => c[1]);
        const x0 = Math.max(0, Math.min(...xs));
        const y0 = Math.max(0, Math.min(...ys));
        const x1 = Math.min(pageCanvas!.width, Math.max(...xs));
        const y1 = Math.min(pageCanvas!.height, Math.max(...ys));
        const w = Math.round(x1 - x0);
        const h = Math.round(y1 - y0);
        if (w < 20 || h < 20) continue; // 장식용 아이콘/구분선 등 지나치게 작은 요소 제외

        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = w;
        cropCanvas.height = h;
        const cropCtx = cropCanvas.getContext("2d")!;
        cropCtx.drawImage(pageCanvas!, x0, y0, w, h, 0, 0, w, h);
        const dataUrl = cropCanvas.toDataURL("image/png");
        const hash = computeGrayscaleHash(cropCtx, w, h);

        const nearbyText = nearbyTextFor({ x0, y0, x1, y1 }, textItemsPixel) || null;
        const photoNo = parsePhotoNo(nearbyText);
        const caption = nearbyText; // 문서마다 캡션 위치가 달라 주변 텍스트 전체를 캡션 후보로 보존
        const location = parseLocationFromText(nearbyText);
        const damageName = parseDamageNameFromText(nearbyText);
        const subPartInfo = parseSubPartFromText(nearbyText);
        const pageAreaRatio = (w * h) / (pageCanvas!.width * pageCanvas!.height);

        let ocrText: string | null = null;
        let ocrConfidence: number | null = null;
        const damageRelatedGuess = classifyDamageRelated(caption, nearbyText, photoNo);
        if (!caption && !photoNo) {
          try {
            const ocr = await runOcr(dataUrl);
            if (ocr.text) {
              ocrText = ocr.text;
              ocrConfidence = ocr.confidence;
            }
          } catch {
            // OCR 실패는 사진 자체의 추출 실패로 취급하지 않는다 — ocrText만 비워둔다.
          }
        }

        const sourceRef: PhotoSourceRef = {
          page: pageNum,
          quote: nearbyText ?? undefined,
          boundingBox: { x: x0, y: y0, width: w, height: h },
        };

        const photo: ExtractedPhoto = {
          id: nextPhotoId(),
          sourceFile: file.name,
          page: pageNum,
          photoNo,
          caption,
          section: null,
          part: subPartInfo?.part ?? null,
          subPart: subPartInfo?.subPart ?? null,
          location: location ?? parseLocationFromText(ocrText),
          damageName: damageName ?? parseDamageNameFromText(ocrText),
          image: { dataUrl, width: w, height: h },
          damageRelated: damageRelatedGuess,
          nearbyText,
          ocrText,
          ocrConfidence,
          visionInference: null,
          sourceRef,
          duplicateCandidate: false,
          duplicateOfIds: [],
          matchCandidates: [],
          linkedDamageIds: [],
          status: "review",
          extractionStatus: "ok",
        };
        if (pageAreaRatio > 0.9) {
          photo.error = "페이지 전체를 덮는 이미지로 감지됨 — 스캔 페이지일 수 있으므로 검토가 필요합니다.";
        }
        photos.push(photo);
        (photo as any).__hash = hash;
      } catch (err: any) {
        photos.push(buildFailedPhoto(file.name, pageNum, err?.message ?? "이미지 크롭 실패"));
      }
    }
  }

  applyDuplicateDetection(photos);
  return photos;
}

function buildFailedPhoto(sourceFile: string, page: number, error: string): ExtractedPhoto {
  return {
    id: nextPhotoId(),
    sourceFile,
    page,
    photoNo: null,
    caption: null,
    section: null,
    part: null,
    subPart: null,
    location: null,
    damageName: null,
    image: { dataUrl: "", width: 0, height: 0 },
    damageRelated: "unknown",
    nearbyText: null,
    ocrText: null,
    ocrConfidence: null,
    visionInference: null,
    sourceRef: { page },
    duplicateCandidate: false,
    duplicateOfIds: [],
    matchCandidates: [],
    linkedDamageIds: [],
    status: "failed",
    extractionStatus: "failed",
    error,
  };
}

function applyDuplicateDetection(photos: ExtractedPhoto[]) {
  const hashed = photos.filter((p) => (p as any).__hash).map((p) => ({ id: p.id, hash: (p as any).__hash as string }));
  const dupMap = detectDuplicateCandidates(hashed);
  for (const p of photos) {
    const dups = dupMap.get(p.id) ?? [];
    if (dups.length > 0) {
      p.duplicateCandidate = true;
      p.duplicateOfIds = dups;
    }
    delete (p as any).__hash;
  }
}
