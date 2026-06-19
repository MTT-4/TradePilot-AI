"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { buildLoginHref, fetchCurrentMe } from "@/app/_lib/auth-client";

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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#f8efd8_0%,#efe3cf_38%,#e6d8c2_100%)] px-4 py-8 md:px-8">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[36px] border border-[#d7ccb5] bg-white/88 p-7 shadow-[0_30px_120px_rgba(56,42,16,0.12)] backdrop-blur">
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-[#2f6f58]">
            Trade Pilot / Access
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#1f241f] md:text-5xl">
            登录工作台
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-[#645d50]">
            使用账号密码进入第一步，再输入 2FA 验证码建立会话。登录后会自动返回你刚才访问的页面。
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-[24px] border border-[#e5dcc8] bg-[#fffaf1] p-4">
              <div className="text-xs uppercase tracking-[0.22em] text-[#7a725f]">Step 1</div>
              <div className="mt-2 text-lg font-semibold text-[#1f241f]">账号校验</div>
              <div className="mt-2 text-sm text-[#645d50]">邮箱 + 密码触发登录挑战。</div>
            </div>
            <div className="rounded-[24px] border border-[#e5dcc8] bg-[#fffaf1] p-4">
              <div className="text-xs uppercase tracking-[0.22em] text-[#7a725f]">Step 2</div>
              <div className="mt-2 text-lg font-semibold text-[#1f241f]">2FA 验证</div>
              <div className="mt-2 text-sm text-[#645d50]">输入 6 位验证码建立当前浏览器会话。</div>
            </div>
            <div className="rounded-[24px] border border-[#e5dcc8] bg-[#fffaf1] p-4">
              <div className="text-xs uppercase tracking-[0.22em] text-[#7a725f]">Next</div>
              <div className="mt-2 text-lg font-semibold text-[#1f241f]">返回原页面</div>
              <div className="mt-2 text-sm text-[#645d50]">成功后回到 `{nextPath}`。</div>
            </div>
          </div>
        </section>

        <section className="rounded-[36px] border border-[#d7ccb5] bg-[#fffdf8] p-6 shadow-[0_30px_120px_rgba(56,42,16,0.12)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-[#7a725f]">
                {challengeId ? "2FA Verification" : "Credentials"}
              </div>
              <h2 className="mt-2 text-2xl font-semibold text-[#1f241f]">
                {challengeId ? "输入验证码" : "输入登录信息"}
              </h2>
            </div>
            <a
              href={buildLoginHref("/")}
              className="rounded-full border border-[#ddd3bd] px-4 py-2 text-sm text-[#1f241f]"
            >
              返回首页
            </a>
          </div>

          {error ? (
            <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {checkingSession ? (
            <div className="mt-8 rounded-[28px] border border-[#e5dcc8] bg-white p-5 text-sm text-[#645d50]">
              正在检查当前会话…
            </div>
          ) : challengeId ? (
            <form className="mt-8 space-y-5" onSubmit={handleCodeSubmit}>
              <label className="block">
                <div className="mb-2 text-sm font-medium text-[#1f241f]">6 位验证码</div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                  }}
                  className="w-full rounded-[22px] border border-[#d9cfb8] bg-white px-4 py-3 text-lg tracking-[0.2em] text-[#1f241f] outline-none transition focus:border-[#2f6f58]"
                  placeholder="123456"
                  autoFocus
                />
              </label>

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="rounded-full bg-[#1f241f] px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "验证中…" : "完成登录"}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setChallengeId(null);
                    setCode("");
                    setError(null);
                  }}
                  className="rounded-full border border-[#d9cfb8] px-5 py-3 text-sm text-[#1f241f] disabled:opacity-50"
                >
                  返回上一步
                </button>
              </div>
            </form>
          ) : (
            <form className="mt-8 space-y-5" onSubmit={handlePasswordSubmit}>
              <label className="block">
                <div className="mb-2 text-sm font-medium text-[#1f241f]">邮箱</div>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-[22px] border border-[#d9cfb8] bg-white px-4 py-3 text-[#1f241f] outline-none transition focus:border-[#2f6f58]"
                  placeholder="name@example.com"
                  autoComplete="email"
                />
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-medium text-[#1f241f]">密码</div>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-[22px] border border-[#d9cfb8] bg-white px-4 py-3 text-[#1f241f] outline-none transition focus:border-[#2f6f58]"
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
              </label>

              <button
                type="submit"
                disabled={loading || !email || !password}
                className="rounded-full bg-[#1f241f] px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "提交中…" : "进入 2FA"}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
