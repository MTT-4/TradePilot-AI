"use client";

import { useEffect, useState } from "react";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";
import {
  clearRecentQuestions,
  loadRecentQuestions,
  pushRecentQuestion,
} from "@/app/_lib/qa-history";

type TechAssistantResponse = {
  answer: string;
  source_files: string[];
  commands: string[];
  caveats: string[];
};

const SAMPLE_GROUPS = [
  {
    title: "架构 / 目录",
    questions: [
      "这个项目的主要目录和职责怎么分？",
      "本项目的多租户隔离在哪几层实现？",
    ],
  },
  {
    title: "开发 / 扩展",
    questions: [
      "如果我要新增一个 skill，应该放哪些文件？",
      "如果我要新增一个页面入口，应该优先复用哪些结构？",
    ],
  },
  {
    title: "启动 / 验收",
    questions: [
      "本项目的本地启动、测试和验收命令有哪些？",
      "本地 Qwen 和 bge-m3 端点不在线时，应该怎么排查？",
    ],
  },
] as const;

const RECENT_STORAGE_KEY = "tradepilot:tech-assistant:recent-questions";

async function askTechAssistant(tenantId: string, question: string) {
  const response = await fetch("/api/skills/tech-assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Id": tenantId,
    },
    body: JSON.stringify({ question }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "技术问答失败。");
  }

  return (await response.json()) as TechAssistantResponse;
}

export function TechAssistantClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [question, setQuestion] = useState<string>(
    SAMPLE_GROUPS[0]?.questions[0] ?? "",
  );
  const [answer, setAnswer] = useState<TechAssistantResponse | null>(null);
  const [answeredAt, setAnsweredAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recentQuestions, setRecentQuestions] = useState<string[]>(
    () => loadRecentQuestions(RECENT_STORAGE_KEY),
  );

  useEffect(() => {
    let active = true;

    async function loadMe() {
      try {
        const payload = await fetchCurrentMe();
        if (!active) return;
        setMe(payload);
        setTenantId(payload.currentTenant?.tenantId ?? payload.memberships[0]?.tenantId ?? "");
      } catch (loadError) {
        if (loadError instanceof LoginRequiredError) {
          redirectToLogin("/tech-assistant");
          return;
        }
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载租户信息失败。");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadMe();
    return () => {
      active = false;
    };
  }, []);

  async function submit(nextQuestion?: string) {
    const trimmed = (nextQuestion ?? question).trim();
    if (!trimmed) {
      setError("请输入问题。");
      return;
    }
    if (!tenantId) {
      setError("缺少租户上下文。");
      return;
    }

    setSubmitting(true);
    setError(null);
    if (nextQuestion != null) {
      setQuestion(nextQuestion);
    }

    try {
      const result = await askTechAssistant(tenantId, trimmed);
      setAnswer(result);
      setAnsweredAt(
        new Date().toLocaleString("zh-CN", {
          hour12: false,
        }),
      );
      setCopied(false);
      setRecentQuestions(pushRecentQuestion(RECENT_STORAGE_KEY, trimmed));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "技术问答失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyAnswer() {
    if (!answer?.answer) {
      return;
    }

    await navigator.clipboard.writeText(answer.answer);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function clearHistory() {
    setRecentQuestions(clearRecentQuestions(RECENT_STORAGE_KEY));
  }

  if (loading) {
    return <div className="content"><div className="card" style={{ padding: 24 }}>加载中…</div></div>;
  }

  return (
    <div className="content">
      <div className="head-row">
        <div>
          <div className="eyebrow">技术问答</div>
          <h2 className="sec">技术智能体</h2>
          <p className="sub">回答架构、目录、路由、命令、联调和排障问题。</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className="badge local">本地问答</span>
          <span className="badge manual">技术资料</span>
          <span className="badge line">{me?.currentTenant?.tenantName ?? "当前租户"}</span>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ padding: 16, marginBottom: 18 }}>
          <span className="st failed">错误</span>
          <p className="sub" style={{ marginTop: 8 }}>{error}</p>
        </div>
      ) : null}

      <div className="split">
        <div className="card split-chat chat">
          <div className="chat-head">
            <div className="ai">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M4 19h16" />
                <path d="M7 15V9" />
                <path d="M12 15V5" />
                <path d="M17 15v-3" />
              </svg>
            </div>
            <div>
              <b>技术智能体</b>
              <span>只基于仓库内置资料回答，不替代代码审查与真实运行结果</span>
            </div>
          </div>

          <div className="chat-body">
            <div className="msg a">
              可以直接问目录职责、接口位置、命令、启动步骤、权限链路或 skill 落点。
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {SAMPLE_GROUPS.map((group) => (
                  <div key={group.title}>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>{group.title}</div>
                    <div className="chips">
                      {group.questions.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="chip"
                          onClick={() => void submit(item)}
                          disabled={submitting}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {recentQuestions.length > 0 ? (
                <div className="chips" style={{ marginTop: 10 }}>
                  {recentQuestions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="chip"
                      onClick={() => void submit(item)}
                      disabled={submitting}
                    >
                      最近：{item}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {question.trim() ? <div className="msg u">{question}</div> : null}
            {answer ? <div className="msg a">{answer.answer}</div> : null}
          </div>

          <div className="chat-compose">
            <textarea
              className="chat-textarea"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="例如：本项目的多租户隔离在哪几层实现？新增一个 skill 需要落哪些文件？"
            />
            <div className="chat-compose-meta">
              <span className="sub">默认允许 OPERATOR 及以上角色使用，按当前项目资料答复。</span>
              <button
                type="button"
                className="btn primary"
                onClick={() => void submit()}
                disabled={submitting || !question.trim()}
              >
                {submitting ? "回答中…" : "提交问题"}
              </button>
            </div>
          </div>
        </div>

        <div className="card preview" style={{ padding: 20 }}>
          <div className="head-row" style={{ marginBottom: 12 }}>
            <div>
              <h3 style={{ fontSize: 16 }}>技术答复</h3>
              <p className="sub">会优先给出文件路径、命令和排查顺序。</p>
            </div>
          </div>

          {!answer ? (
            <p className="sub">提交问题后，这里会显示技术说明、命令建议、风险前提和参考文件。</p>
          ) : (
            <div style={{ display: "grid", gap: 16 }}>
              <div className="card" style={{ padding: 16 }}>
                <div className="head-row" style={{ marginBottom: 10 }}>
                  <div>
                    <div className="eyebrow">回答</div>
                    {answeredAt ? <div className="sub" style={{ marginTop: 4 }}>回答时间：{answeredAt}</div> : null}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {copied ? <span className="st ready">复制成功</span> : null}
                    <button type="button" className="btn ghost sm" onClick={() => void copyAnswer()}>
                      {copied ? "已复制回答" : "复制回答"}
                    </button>
                  </div>
                </div>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{answer.answer}</div>
              </div>
              <div className="grid-2">
                <div className="card" style={{ padding: 16 }}>
                  <div className="eyebrow">相关命令</div>
                  <ul style={{ margin: "10px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
                    {answer.commands.map((item) => (
                      <li key={item}><code>{item}</code></li>
                    ))}
                  </ul>
                </div>
                <div className="card" style={{ padding: 16 }}>
                  <div className="eyebrow">前提 / 风险</div>
                  <ul style={{ margin: "10px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
                    {answer.caveats.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div className="eyebrow">参考文件</div>
                <div className="chips">
                  {answer.source_files.map((item) => (
                    <span key={item} className="chip" style={{ cursor: "default" }}>{item}</span>
                  ))}
                </div>
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div className="head-row" style={{ marginBottom: 10 }}>
                  <div className="eyebrow">最近问题</div>
                  {recentQuestions.length > 0 ? (
                    <button type="button" className="btn ghost sm" onClick={clearHistory}>
                      清空历史
                    </button>
                  ) : null}
                </div>
                <div className="chips" style={{ marginTop: 10 }}>
                  {recentQuestions.length > 0 ? recentQuestions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="chip"
                      onClick={() => void submit(item)}
                      disabled={submitting}
                    >
                      {item}
                    </button>
                  )) : <span className="sub">还没有历史问题。</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
