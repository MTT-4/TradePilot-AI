"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { fetchCurrentMe } from "@/app/_lib/auth-client";

type LoginResponse = {
  status: "2fa_required";
  challengeId: string;
};

type ApiErrorPayload = {
  error?: {
    message?: string;
  };
};

type VerifyResponse = {
  status: "ok";
};

function normalizeNext(nextValue: string | null) {
  if (!nextValue || !nextValue.startsWith("/") || nextValue.startsWith("//")) {
    return "/";
  }

  return nextValue === "/login" ? "/" : nextValue;
}

function getApiErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }

  const error = payload.error;

  if (!error || typeof error !== "object" || !("message" in error)) {
    return null;
  }

  return typeof error.message === "string" ? error.message : null;
}

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => normalizeNext(searchParams.get("next")), [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void fetchCurrentMe()
      .then(() => {
        if (active) {
          router.replace(nextPath);
        }
      })
      .catch(() => {
        if (active) {
          setCheckingSession(false);
        }
      });

    return () => {
      active = false;
    };
  }, [nextPath, router]);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const payload = (await response.json().catch(() => null)) as
        | LoginResponse
        | ApiErrorPayload
        | null;

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload) ?? "登录失败。");
      }

      setChallengeId((payload as LoginResponse).challengeId);
      setCode("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "登录失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!challengeId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ challengeId, code }),
      });

      const payload = (await response.json().catch(() => null)) as
        | VerifyResponse
        | ApiErrorPayload
        | null;

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload) ?? "2FA 验证失败。");
      }

      if (!payload || !("status" in payload) || payload.status !== "ok") {
        throw new Error("2FA 验证失败。");
      }

      router.replace(nextPath);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "2FA 验证失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <div className="logo">智</div>
          <div className="nm">
            TradePilot AI<span>智拓出海 · 外贸营销获客</span>
          </div>
        </div>

        {error ? (
          <div
            className="st failed"
            style={{ width: "100%", marginBottom: 14, padding: "8px 12px" }}
          >
            {error}
          </div>
        ) : null}

        {checkingSession ? (
          <div className="sub" style={{ padding: "18px 0" }}>
            正在检查当前会话…
          </div>
        ) : challengeId ? (
          <form onSubmit={handleCodeSubmit}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              两步验证
            </div>
            <div className="sub" style={{ marginBottom: 16 }}>
              输入验证器 App 上的 6 位动态码
            </div>
            <div className="field">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                }}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 20,
                  letterSpacing: "0.3em",
                  textAlign: "center",
                }}
                placeholder="------"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="btn primary"
              disabled={loading || code.length !== 6}
              style={{ width: "100%", justifyContent: "center", marginTop: 12 }}
            >
              {loading ? "验证中…" : "验证并进入"}
            </button>
            <div
              className="login-foot"
              style={{ cursor: "pointer" }}
              onClick={() => {
                if (loading) {
                  return;
                }
                setChallengeId(null);
                setCode("");
                setError(null);
              }}
            >
              ← 返回
            </div>
          </form>
        ) : (
          <form onSubmit={handlePasswordSubmit}>
            <div className="field">
              <label>邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
              />
            </div>
            <div className="field">
              <label>密码</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              className="btn primary"
              disabled={loading || !email || !password}
              style={{ width: "100%", justifyContent: "center", marginTop: 6 }}
            >
              {loading ? "提交中…" : "登录"}
            </button>
            <div className="login-foot">
              <span className="dot local" />
              数据本地处理 · 客户隐私不出境
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
