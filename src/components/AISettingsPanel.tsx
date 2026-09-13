import { useState } from "react";
import { listGeminiModels } from "../lib/ai/geminiClient";
import { createGeminiProvider } from "../lib/ai/geminiProvider";
import {
  FALLBACK_GEMINI_MODELS,
  clearGeminiApiKey,
  getActiveProviderId,
  getGeminiApiKey,
  getGeminiModel,
  setActiveProviderId,
  setGeminiApiKey,
  setGeminiModel,
} from "../lib/ai/settings";
import type { ProviderId } from "../lib/ai/types";

/**
 * STEP 12-1 — AI 설정 화면. 기존 UploadPanel의 "Claude API 키" 입력은 그대로 두고
 * (Provider=Claude일 때 계속 사용됨, 스펙 23번 "기존 기능을 가리지 않는다"), 이 패널은
 * Provider 선택과 Gemini 전용 설정만 담당한다.
 */
export default function AISettingsPanel() {
  const [provider, setProvider] = useState<ProviderId>(getActiveProviderId());
  const [geminiKey, setGeminiKeyState] = useState(getGeminiApiKey());
  const [model, setModel] = useState(getGeminiModel());
  const [models, setModels] = useState<string[]>(FALLBACK_GEMINI_MODELS);
  const [testState, setTestState] = useState<"idle" | "testing" | "success" | "fail">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);

  const changeProvider = (id: ProviderId) => {
    setProvider(id);
    setActiveProviderId(id);
    setTestState("idle");
  };

  const changeGeminiKey = (value: string) => {
    setGeminiKeyState(value);
    setGeminiApiKey(value);
    setTestState("idle");
  };

  const resetGeminiKey = () => {
    clearGeminiApiKey();
    setGeminiKeyState("");
    setTestState("idle");
  };

  const changeModel = (value: string) => {
    setModel(value);
    setGeminiModel(value);
    setTestState("idle");
  };

  const loadModels = async () => {
    if (!geminiKey) {
      setTestMessage("Gemini API Key를 먼저 입력하세요.");
      setTestState("fail");
      return;
    }
    setLoadingModels(true);
    try {
      const fetched = await listGeminiModels(geminiKey);
      if (fetched.length > 0) {
        setModels(fetched);
        if (!model || !fetched.includes(model)) {
          changeModel(fetched[0]);
        }
      }
    } catch (err) {
      setTestMessage(err instanceof Error ? err.message : "모델 목록을 조회하지 못했습니다.");
      setTestState("fail");
    } finally {
      setLoadingModels(false);
    }
  };

  const testConnection = async () => {
    if (!geminiKey) {
      setTestState("fail");
      setTestMessage("Gemini API Key를 먼저 입력하세요.");
      return;
    }
    if (!model) {
      setTestState("fail");
      setTestMessage("Model을 먼저 선택하세요.");
      return;
    }
    setTestState("testing");
    setTestMessage("연결 테스트 중...");
    const result = await createGeminiProvider(geminiKey, model).testConnection();
    setTestState(result.ok ? "success" : "fail");
    setTestMessage(result.message);
  };

  return (
    <div className="upload-panel ai-settings-panel">
      <h3 style={{ margin: "0 0 8px" }}>AI 설정</h3>
      {/* 사용자 요청: 한 줄에 다 펼치면 항목 사이가 너무 벌어짐 — 입력 항목(1행)과
          버튼(2행)을 나눠 공간을 효율적으로 쓴다. */}
      <div className="upload-row ai-settings-row">
        <label>
          Provider
          <select value={provider} onChange={(e) => changeProvider(e.target.value as ProviderId)}>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>

        {provider === "gemini" && (
          <>
            <label>
              Gemini API Key
              <input type="password" value={geminiKey} onChange={(e) => changeGeminiKey(e.target.value)} placeholder="AIza..." />
            </label>
            <label>
              Model
              <select value={model} onChange={(e) => changeModel(e.target.value)} onFocus={loadModels}>
                <option value="">모델 선택</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      {provider === "gemini" && (
        <div className="upload-row ai-settings-row ai-settings-actions">
          <button onClick={loadModels} disabled={loadingModels} className="secondary" type="button">
            {loadingModels ? "모델 조회 중..." : "모델 목록 새로고침"}
          </button>
          <button onClick={testConnection} disabled={testState === "testing"} type="button">
            {testState === "testing" ? "연결 테스트 중..." : "연결 테스트"}
          </button>
          <button onClick={resetGeminiKey} className="secondary" type="button">
            API Key 초기화
          </button>
        </div>
      )}

      {provider === "gemini" && (
        <p className="status-line">
          연결 상태: {testState === "success" && "● 연결됨"}
          {testState === "fail" && "○ 연결 안 됨"}
          {testState === "idle" && "○ 미확인 (연결 테스트를 실행하세요)"}
          {testState === "testing" && "연결 테스트 중..."}
          {testMessage && ` — ${testMessage}`}
        </p>
      )}
      {provider === "claude" && <p className="hint">Claude는 기존과 동일하게 아래 "보고서 PDF" 업로드 영역의 API 키 입력을 사용합니다.</p>}
    </div>
  );
}
