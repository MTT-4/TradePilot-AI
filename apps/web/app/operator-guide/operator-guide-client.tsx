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

type OperatorGuideResponse = {
  answer: string;
  next_actions: string[];
  suggested_questions: string[];
  source_files: string[];
};

const SAMPLE_GROUPS = [
  {
    title: "CRM / 首响",
    questions: [
      "我想从询盘到首响审批，完整操作路径是什么？",
      "首响草稿被拒绝后，下一步怎么处理？",
    ],
  },
  {
    title: "发布 / 站点",
    questions: [
      "发布内容前，我应该先检查哪几个页面？",
      "站点上线审批一般要看哪几个入口？",
    ],
  },
  {
    title: "知识库 / 资料",
    questions: [
      "如果我要补产品资料，应该去哪里上传和审核？",
      "内部资料和公开资料在操作上有什么区别？",
    ],
  },
] as const;

const RECENT_STORAGE_KEY = "tradepilot:operator-guide:recent-questions";

async function askOperatorGuide(tenantId: string, question: string) {
  const response = await fetch("/api/skills/operator-guide", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Id": tenantId,
    },
    body: JSON.stringify({ question }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "操作指导问答失败。");
  }

  return (await response.json()) as OperatorGuideResponse;
}

export function OperatorGuideClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [question, setQuestion] = useState<string>(
    SAMPLE_GROUPS[0]?.questions[0] ?? "",
  );
  const [answer, setAnswer] = useState<OperatorGuideResponse | null>(null);
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
          redirectToLogin("/operator-guide");
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
      const result = await askOperatorGuide(tenantId, trimmed);
      setAnswer(result);
      setAnsweredAt(
        new Date().toLocaleString("zh-CN", {
          hour12: false,
        }),
      );
      setCopied(false);
      setRecentQuestions(pushRecentQuestion(RECENT_STORAGE_KEY, trimmed));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "操作指导问答失败。");
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
    return <div className="page-body"><div className="card" style={{ padding: 24 }}>加载中…</div></div>;
  }

  return (
    <div className="page-body">
      <div className="head-row">
        <div>
          <div className="eyebrow">操作指导</div>
          <h2 className="sec">操作指导智能体</h2>
          <p className="sub">回答平台怎么用、去哪操作、流程先后顺序和注意事项。</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className="badge local">本地问答</span>
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
                <path d="M12 8v4" />
                <path d="M8 12h8" />
                <path d="M6 18h12" />
                <rect x="4" y="3" width="16" height="15" rx="4" />
              </svg>
            </div>
            <div>
              <b>操作指导智能体</b>
              <span>只答平台操作与流程，不代替审批与人工确认</span>
            </div>
          </div>

          <div className="chat-body">
            <div className="msg a">
              可以直接问“去哪上传资料”“怎么从 CRM 进入首响审批”“发布前先看哪里”。
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
              placeholder="例如：我想把一个线索从 CRM 推进到首响发送审批，应该怎么操作？"
            />
            <div className="chat-compose-meta">
              <span className="sub">支持运营 / 销售 / 管理角色，按当前租户上下文回答。</span>
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
              <h3 style={{ fontSize: 16 }}>回答结果</h3>
              <p className="sub">结果会尽量给出页面路径和操作顺序。</p>
            </div>
          </div>

          {!answer ? (
            <p className="sub">提交问题后，这里会显示操作建议、下一步动作和参考来源。</p>
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
                  <div className="eyebrow">建议下一步</div>
                  <ul style={{ margin: "10px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
                    {answer.next_actions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="card" style={{ padding: 16 }}>
                  <div className="eyebrow">延伸可问</div>
                  <ul style={{ margin: "10px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
                    {answer.suggested_questions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div className="eyebrow">参考来源</div>
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
