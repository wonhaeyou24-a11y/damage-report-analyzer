import type { RawDamageGroup } from "../types";
import { buildExtractionPrompt } from "./aiPrompt";

export const MODEL = "claude-sonnet-5";

/**
 * 브라우저에서 직접 Claude API(Messages)를 호출하여 보고서 텍스트로부터
 * 손상 그룹 배열(RawDamageGroup[])을 추출한다. API 키는 사용자가 화면에서
 * 입력하며, 로컬 브라우저 저장소에만 보관한다(서버 전송 없음).
 */
export async function extractDamageGroupsWithClaude(
  apiKey: string,
  reportText: string
): Promise<RawDamageGroup[]> {
  const prompt = buildExtractionPrompt(reportText);

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
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API 호출 실패 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text: string = data?.content?.[0]?.text ?? "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("AI 응답에서 JSON 배열을 찾지 못했습니다. 원문: " + text.slice(0, 500));
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return parsed as RawDamageGroup[];
}
