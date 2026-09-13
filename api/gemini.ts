import { handleGeminiRequest, type GeminiRequestBody } from "../server/geminiCore.js";

/**
 * Vercel Serverless Function — POST /api/gemini
 * Gemini API Key는 여기(서버 측)에서만 사용된다. 프론트엔드 번들에는 이 파일이 포함되지
 * 않으므로(Vercel이 /api를 별도 함수로 배포), Gemini Key가 브라우저로 전달되지 않는다.
 */
export default async function handler(req: { method?: string; body?: unknown }, res: {
  status: (code: number) => { json: (body: unknown) => void };
}) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "허용되지 않는 메서드입니다." });
    return;
  }

  const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as GeminiRequestBody;
  const result = await handleGeminiRequest(body);
  res.status(result.status).json(result.body);
}
