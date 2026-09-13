import { afterEach, describe, expect, it, vi } from "vitest";
import { handleGeminiRequest } from "./geminiCore.js";

const originalFetch = global.fetch;
const originalEnvKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  global.fetch = originalFetch;
  process.env.GEMINI_API_KEY = originalEnvKey;
  vi.restoreAllMocks();
});

describe("handleGeminiRequest", () => {
  it("TEST 2 — API Key 없음: crash 없이 400과 명확한 오류를 반환한다", async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await handleGeminiRequest({ action: "generateText", model: "gemini-2.5-flash", prompt: "hi" });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toContain("API Key");
  });

  it("TEST 3 — 잘못된 API Key: 실제 fetch를 호출하고 인증 실패를 사용자 메시지로 변환한다(crash 없음)", async () => {
    beforeEachMockFetch(401);
    const result = await handleGeminiRequest({ action: "generateText", apiKey: "bad-key", model: "gemini-2.5-flash", prompt: "hi" });
    expect(result.status).toBe(401);
    expect((result.body as { error: string }).error).toBe("Gemini 인증에 실패했습니다. API Key를 확인해주세요.");
  });

  it("모델 미지정 시 400을 반환한다", async () => {
    const result = await handleGeminiRequest({ action: "generateText", apiKey: "key", model: "", prompt: "hi" } as any);
    expect(result.status).toBe(400);
  });

  it("TEST 4 상당 — 정상 응답을 relay하고 텍스트/토큰 사용량을 그대로 반환한다", async () => {
    beforeEachMockFetch(200, {
      candidates: [{ content: { parts: [{ text: "OK" }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
    });
    const result = await handleGeminiRequest({ action: "generateText", apiKey: "good-key", model: "gemini-2.5-flash", prompt: "ping" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ text: "OK", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } });
  });

  it("응답에 usageMetadata가 없으면 토큰 사용량을 임의로 만들지 않고 null로 남긴다", async () => {
    beforeEachMockFetch(200, { candidates: [{ content: { parts: [{ text: "OK" }] } }] });
    const result = await handleGeminiRequest({ action: "generateText", apiKey: "good-key", model: "gemini-2.5-flash", prompt: "ping" });
    expect((result.body as any).usage).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
  });

  it("listModels는 generateContent를 지원하는 모델만 반환한다", async () => {
    beforeEachMockFetch(200, {
      models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
      ],
    });
    const result = await handleGeminiRequest({ action: "listModels", apiKey: "good-key" });
    expect(result.status).toBe(200);
    expect((result.body as any).models).toEqual(["gemini-2.5-flash"]);
  });

  it("네트워크 오류가 발생해도 crash하지 않고 502와 사용자 메시지를 반환한다", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await handleGeminiRequest({ action: "generateText", apiKey: "good-key", model: "gemini-2.5-flash", prompt: "hi" });
    expect(result.status).toBe(502);
    expect((result.body as { error: string }).error).not.toContain("good-key");
  });

  it("환경변수 GEMINI_API_KEY가 있으면 body에 apiKey가 없어도 fallback으로 사용한다", async () => {
    process.env.GEMINI_API_KEY = "env-key";
    beforeEachMockFetch(200, { candidates: [{ content: { parts: [{ text: "OK" }] } }] });
    const result = await handleGeminiRequest({ action: "generateText", model: "gemini-2.5-flash", prompt: "hi" });
    expect(result.status).toBe(200);
  });
});

function beforeEachMockFetch(status: number, jsonBody: unknown = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => jsonBody,
    text: async () => JSON.stringify(jsonBody),
  }) as unknown as typeof fetch;
}
