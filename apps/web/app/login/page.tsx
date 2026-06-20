import { Suspense } from "react";
import { LoginClient } from "./login-client";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="login-wrap">
          <div className="login-card">
            <div className="brand">
              <div className="logo">智</div>
              <div className="nm">
                TradePilot AI<span>智拓出海 · 外贸营销获客</span>
              </div>
            </div>
            <div className="sub" style={{ padding: "18px 0" }}>
              正在检查当前会话…
            </div>
          </div>
        </div>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
