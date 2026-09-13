import type { VisionInference } from "../types";

const MODEL = "claude-sonnet-5";

/**
 * STEP 6 — 선택적 Vision 분석. 성능 방침(저비용 분석을 먼저 수행하고, 필요한 사진에만
 * 고비용 AI 분석을 적용)에 따라 자동 일괄 호출하지 않고, 사용자가 화면에서 사진 단위로
 * 요청했을 때만 호출한다. 결과는 반드시 visionInference로 분리 저장하며 보고서 원문
 * 사실(documentEvidence)과 동일하게 취급하지 않는다.
 */
export async function analyzePhotoWithVision(
  apiKey: string,
  imageDataUrl: string,
  contextText: string
): Promise<VisionInference> {
  const [, mediaType, base64] = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/) ?? [];
  if (!base64) throw new Error("이미지 데이터 URL 형식이 올바르지 않습니다.");

  const prompt = `이 이미지는 시설물 점검 보고서에서 추출한 사진입니다. 주변 문맥: "${contextText}".
이 사진이 실제 손상사진인지, 어떤 종류의 손상(damageType)과 어떤 시설 부위(facility)로 보이는지 추정하라.
반드시 다음 JSON 형식으로만 답하라. 확신이 없으면 confidence를 낮게 잡아라.
{"damageType": "추정 손상 유형 또는 null", "facility": "추정 시설 부위 또는 null", "confidence": 0.0}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Vision API 호출 실패 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text: string = data?.content?.[0]?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Vision 응답에서 JSON을 찾지 못했습니다.");
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    damageType: parsed.damageType ?? undefined,
    facility: parsed.facility ?? undefined,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
  };
}
