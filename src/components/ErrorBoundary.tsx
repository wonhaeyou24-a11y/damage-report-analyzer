import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 렌더링 중 예기치 못한 오류가 발생해도 화면이 완전히 흰 화면(white screen)으로 사라지지
 * 않도록 하는 최상위 안전망. 실제 원인 진단을 위해 콘솔에 스택을 남기고, 화면에는 사용자가
 * 알아볼 수 있는 오류 메시지와 새로고침 버튼을 보여준다. STEP1~10 데이터는 브라우저 상태에만
 * 있으므로 이 경계 자체가 데이터를 보호하지는 않는다 — 오류 원인을 눈에 보이게 하는 것이 목적.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] 렌더링 중 오류:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "sans-serif" }}>
          <h2>화면 렌더링 중 오류가 발생했습니다.</h2>
          <p style={{ color: "#b91c1c" }}>{this.state.error.message}</p>
          <p>브라우저 개발자 도구(F12) 콘솔에서 자세한 내용을 확인할 수 있습니다.</p>
          <button onClick={() => window.location.reload()}>새로고침</button>
        </div>
      );
    }
    return this.props.children;
  }
}
