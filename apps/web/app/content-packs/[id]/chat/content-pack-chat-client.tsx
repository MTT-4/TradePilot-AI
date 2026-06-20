"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { statusLabel } from "@/app/_lib/labels";

type MeResponse = {
  currentTenant: {
    tenantId: string;
    tenantName: string;
    role: string;
  } | null;
};

type RuleResponse = {
  items: Array<{
    platform: string;
    displayName: string;
    mediaType: string;
    rules: {
      ratio: string;
      dimensions: string;
      copyLimit: number;
      hashtagLimit: number;
      recommendedWindow: string;
      coverStyle: string;
      durationSeconds: number | null;
    };
  }>;
};

type PackResponse = {
  pack: {
    id: string;
    title: string;
    topic: string;
    market: string | null;
    locales: string[];
    status: string;
    campaign: {
      id: string;
      name: string;
      status: string;
    } | null;
    brandKit: {
      companyName: string;
      primaryColor: string | null;
      secondaryColor: string | null;
    } | null;
  };
  items: Array<{
    id: string;
    platform: string;
    mediaType: string;
    title: string;
    body: string;
    hashtags: string[];
    coverHeadline: string;
    notes: string[];
    publishStatus: string;
    plannedAt: string | null;
    publishedAt: string | null;
    trackingLink: {
      slug: string;
      resolvedUrl: string;
    } | null;
    spec: {
      ratio?: string;
      dimensions?: string;
      visualDirection?: string;
      imagePrompt?: string;
      storyboard?: string[];
      script?: string[];
      durationSeconds?: number;
      generatedAssets?: Array<{
        id: string;
        fileId: string;
        variant: string;
        previewUrl: string;
        mimeType: string;
        width: number;
        height: number;
      }>;
    };
  }>;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ImageGenerationDraft = {
  mode: "text_to_image" | "image_to_image" | "background_swap";
  backgroundStyle: string;
  referenceLabel: string;
  referenceFile: File | null;
};

function platformGradient(platform: string) {
  switch (platform) {
    case "linkedin":
      return "linear-gradient(140deg,#0A66C2,#08498C)";
    case "facebook":
      return "linear-gradient(140deg,#1877F2,#0F5BD1)";
    case "instagram":
      return "linear-gradient(140deg,#C13584,#F77737)";
    case "reels":
      return "linear-gradient(140deg,#5851DB,#E1306C)";
    case "tiktok":
      return "linear-gradient(140deg,#111,#00C2B8)";
    case "youtube":
      return "linear-gradient(140deg,#FF0000,#B80000)";
    case "shorts":
      return "linear-gradient(140deg,#FF4D4D,#CC0000)";
    case "vk":
      return "linear-gradient(140deg,#0077FF,#0048B3)";
    case "rutube":
      return "linear-gradient(140deg,#23173F,#000)";
    default:
      return "linear-gradient(140deg,#0C5C56,#072F2B)";
  }
}

function formatPublishStatus(status: string) {
  return status === "published"
    ? "published"
    : status === "pending"
      ? "pending"
      : status === "approved"
        ? "approved"
        : status === "draft"
          ? "draft"
          : "offline";
}

export function ContentPackChatClient({ packId }: { packId: string }) {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>("");
  const [pack, setPack] = useState<PackResponse | null>(null);
  const [rules, setRules] = useState<RuleResponse["items"]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftBodies, setDraftBodies] = useState<Record<string, string>>({});
  const [imageDrafts, setImageDrafts] = useState<Record<string, ImageGenerationDraft>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const meResponse = await fetch("/api/me");

        if (!meResponse.ok) {
          throw new Error("无法加载当前登录状态。");
        }

        const me = (await meResponse.json()) as MeResponse;

        if (!me.currentTenant) {
          throw new Error("当前账号没有可用租户。");
        }

        const nextTenantId = me.currentTenant.tenantId;
        const headers = {
          "x-tenant-id": nextTenantId,
        };
        const [packResponse, ruleResponse] = await Promise.all([
          fetch(`/api/content-packs/${packId}`, { headers }),
          fetch("/api/platform-rules", { headers }),
        ]);

        if (!packResponse.ok) {
          throw new Error("内容包加载失败。");
        }

        if (!ruleResponse.ok) {
          throw new Error("平台规则加载失败。");
        }

        const nextPack = (await packResponse.json()) as PackResponse;
        const nextRules = (await ruleResponse.json()) as RuleResponse;

        if (!cancelled) {
          setTenantId(nextTenantId);
          setTenantName(me.currentTenant.tenantName);
          setPack(nextPack);
          setRules(nextRules.items);
          setMessages([
            {
              role: "assistant",
              content: "内容包已加载。你可以直接按平台调整文案、规格或发布时间。",
            },
          ]);
          setDraftBodies(
            Object.fromEntries(
              nextPack.items.map((item) => [item.id, item.body]),
            ),
          );
          setImageDrafts(
            Object.fromEntries(
              nextPack.items.map((item) => [
                item.id,
                {
                  mode: "text_to_image",
                  backgroundStyle: "",
                  referenceLabel: "",
                  referenceFile: null,
                },
              ]),
            ),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载失败。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [packId]);

  const rulesByPlatform = useMemo(
    () => new Map(rules.map((item) => [item.platform, item])),
    [rules],
  );
  const qualityNotes = useMemo(() => {
    if (!pack) {
      return [];
    }

    const notes = [
      {
        tone: "ok",
        title: "每条内容都已绑定追踪链路",
        detail: pack.items.every((item) => item.trackingLink)
          ? "当前内容项都带追踪链接，可回流到平台 → 内容 → 询盘。"
          : "部分内容项还缺追踪链接，发布前需要补齐。",
      },
    ];

    const videoItems = pack.items.filter((item) => item.mediaType === "video_script");
    if (videoItems.length > 0) {
      notes.push({
        tone: "ok",
        title: "视频平台按脚本 / 分镜模式交付",
        detail: "当前只生成脚本、分镜、封面与规格校验，不生成成片，符合 V1.0 范围约束。",
      });
    }

    const longDurationRule = rules.find(
      (item) => item.mediaType === "video_script" && item.rules.durationSeconds,
    );
    if (longDurationRule?.rules.durationSeconds) {
      notes.push({
        tone: "warn",
        title: "短视频时长需要继续盯规则上限",
        detail: `当前规则库包含 ${longDurationRule.rules.durationSeconds}s 上限，改稿时不要把脚本扩过平台阈值。`,
      });
    }

    notes.push({
      tone: "ok",
      title: "文案与规格会同步编辑",
      detail: "你在右侧改正文、图像模式、背景说明后，保存与生成动作都会直接作用于真实内容项。",
    });

    return notes.slice(0, 4);
  }, [pack, rules]);

  async function submitChat() {
    if (!tenantId || !messageInput.trim()) {
      return;
    }

    const content = messageInput.trim();
    setSubmitting(true);
    setError(null);
    setMessages((current) => [...current, { role: "user", content }]);
    setMessageInput("");

    try {
      const response = await fetch(`/api/content-packs/${packId}/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": tenantId,
        },
        body: JSON.stringify({
          message: content,
        }),
      });

      if (!response.ok) {
        throw new Error("AI 调整失败。");
      }

      const nextPack = (await response.json()) as PackResponse;
      setPack(nextPack);
      setDraftBodies(
        Object.fromEntries(nextPack.items.map((item) => [item.id, item.body])),
      );
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: "已按你的要求更新右侧内容包。",
        },
      ]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "AI 调整失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveItemBody(itemId: string) {
    if (!tenantId) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/content-items/${itemId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": tenantId,
        },
        body: JSON.stringify({
          body: draftBodies[itemId] ?? "",
        }),
      });

      if (!response.ok) {
        throw new Error("保存文案失败。");
      }

      const nextPack = (await response.json()) as PackResponse;
      setPack(nextPack);
      setDraftBodies(
        Object.fromEntries(nextPack.items.map((item) => [item.id, item.body])),
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存文案失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function togglePublished(itemId: string, published: boolean) {
    if (!tenantId) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        published
          ? `/api/content-items/${itemId}/unmark`
          : `/api/content-items/${itemId}/publish-request`,
        {
          method: "POST",
          headers: {
            "x-tenant-id": tenantId,
          },
        },
      );

      if (!response.ok) {
        throw new Error(published ? "更新发布状态失败。" : "提交发布审批失败。");
      }

      if (published) {
        const nextPack = (await response.json()) as PackResponse;
        setPack(nextPack);
      } else {
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: "已发起内容发布审批，可在设计队列或 HITL 中继续处理。",
          },
        ]);
      }
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : published
            ? "更新发布状态失败。"
            : "提交发布审批失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function generateItemImages(itemId: string) {
    if (!tenantId) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const draft = imageDrafts[itemId] ?? {
        mode: "text_to_image" as const,
        backgroundStyle: "",
        referenceLabel: "",
        referenceFile: null,
      };
      const useMultipart =
        draft.referenceFile instanceof File ||
        draft.mode !== "text_to_image" ||
        draft.backgroundStyle.trim() ||
        draft.referenceLabel.trim();
      const response = await fetch(`/api/content-items/${itemId}/generate-image`, {
        method: "POST",
        headers: {
          "x-tenant-id": tenantId,
        },
        body: useMultipart
          ? (() => {
              const formData = new FormData();
              formData.set("mode", draft.mode);
              if (draft.backgroundStyle.trim()) {
                formData.set("backgroundStyle", draft.backgroundStyle.trim());
              }
              if (draft.referenceLabel.trim()) {
                formData.set("referenceLabel", draft.referenceLabel.trim());
              }
              if (draft.referenceFile instanceof File) {
                formData.set("referenceFile", draft.referenceFile);
              }
              return formData;
            })()
          : JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error("生成图像失败。");
      }

      const nextPack = (await response.json()) as PackResponse;
      setPack(nextPack);
      setImageDrafts((current) => ({
        ...current,
        [itemId]: {
          ...current[itemId],
          referenceFile: null,
        },
      }));
    } catch (generationError) {
      setError(
        generationError instanceof Error ? generationError.message : "生成图像失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: 24 }}>
        正在加载内容包…
      </div>
    );
  }

  if (error && !pack) {
    return (
      <div className="card" style={{ padding: 24 }}>
        {error}
      </div>
    );
  }

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">AI 设计 / 内容包</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            {pack?.pack.title}
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            租户：{tenantName} · 选题：{pack?.pack.topic} · 市场：{pack?.pack.market ?? "全球"} · 状态：{statusLabel(pack?.pack.status)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn ghost sm" href={`/api/content-packs/${packId}/export?fmt=csv`} target="_blank" rel="noreferrer">
            导出 CSV
          </a>
          <a className="btn ghost sm" href={`/api/content-packs/${packId}/export?fmt=md`} target="_blank" rel="noreferrer">
            导出 Markdown
          </a>
          <a className="btn ghost sm" href={`/api/content-packs/${packId}/export?fmt=zip`} target="_blank" rel="noreferrer">
            导出 ZIP
          </a>
        </div>
      </div>

      {pack?.pack.brandKit ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          <span className="badge line">品牌：{pack.pack.brandKit.companyName}</span>
          <span className="badge line">主色：{pack.pack.brandKit.primaryColor ?? "未设置"}</span>
          <span className="badge line">辅色：{pack.pack.brandKit.secondaryColor ?? "未设置"}</span>
        </div>
      ) : null}

      {error ? (
        <div
          className="card"
          style={{
            padding: "12px 16px",
            marginBottom: 18,
            borderColor: "var(--warn-soft)",
            background: "var(--warn-soft)",
            color: "var(--warn)",
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="split">
        <div className="card chat split-chat">
          <div className="chat-head">
            <div className="ai">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 3l2.4 5.4L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-.6z" />
              </svg>
            </div>
            <div>
              <b>设计师</b>
              <br />
              <span>人 + AI 协作 · 取知识库</span>
            </div>
          </div>

          <div className="chat-body">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`msg ${message.role === "assistant" ? "a" : "u"}`}
              >
                {message.content}
              </div>
            ))}
          </div>

          <div className="chat-compose">
            <textarea
              className="chat-textarea"
              placeholder="例如：把 LinkedIn 调成更技术型，把 TikTok 的开头钩子更短，把 Instagram 改成 4 张轮播。"
              value={messageInput}
              onChange={(event) => setMessageInput(event.target.value)}
            />
            <div className="chat-compose-meta">
              <span className="sub">右侧内容项会按你的要求实时更新，继续保留平台规则与追踪链接。</span>
              <button
                className="btn primary"
                onClick={() => void submitChat()}
                disabled={submitting || !messageInput.trim()}
              >
                {submitting ? "处理中…" : "应用到内容包"}
              </button>
            </div>
          </div>
        </div>

        <div>
          <div className="rules">
            <div className="ric">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
                <circle cx="12" cy="12" r="4" />
              </svg>
            </div>
            <div>
              <div className="rt">已按各平台规则适配 · GPT 实时校正</div>
              <div className="rs">
                尺寸 / 时长 / 文案 / 标签逐项对齐；视频平台输出脚本 + 分镜 + 封面，不做成片。
              </div>
            </div>
            <span className="upd">规则 · 2026-06</span>
          </div>

          <div className="pack-grid" style={{ marginTop: 14 }}>
            {pack?.items.map((item) => {
              const rule = rulesByPlatform.get(item.platform);
              const published = item.publishStatus === "published";

              return (
                <article className="pk" key={item.id} style={{ overflow: "hidden" }}>
                  <div className="pk-top" style={{ background: platformGradient(item.platform) }}>
                    <span className="ratio">
                      {item.spec.ratio ?? "-"}
                      {item.spec.dimensions ? ` · ${item.spec.dimensions}` : ""}
                    </span>
                    <span className="plat">{rule?.displayName ?? item.platform}</span>
                    <span className="kind">
                      {item.mediaType === "video_script" ? "脚本+分镜+封面" : item.mediaType}
                    </span>
                  </div>

                  <div className="pk-body">
                    <div className="head-row" style={{ marginBottom: 10 }}>
                      <div>
                        <div className="pk-spec">{item.title}</div>
                        <div className="sub" style={{ marginTop: 4 }}>
                          Cover: {item.coverHeadline}
                        </div>
                      </div>
                      <span className={`st ${formatPublishStatus(item.publishStatus)}`}>
                        {statusLabel(item.publishStatus)}
                      </span>
                    </div>

                    <div className="pk-cap">{draftBodies[item.id] ?? item.body}</div>

                    <div className="pk-tags">
                      {item.hashtags.length ? item.hashtags.join(" ") : "无标签"}
                    </div>

                    {item.trackingLink ? (
                      <div className="pk-link">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
                        </svg>
                        {item.trackingLink.slug}
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(item.trackingLink?.resolvedUrl ?? "")}
                        >
                          复制
                        </button>
                      </div>
                    ) : (
                      <div className="pk-link">追踪链接缺失</div>
                    )}

                    <textarea
                      className="chat-textarea"
                      style={{ marginTop: 12, minHeight: 132 }}
                      value={draftBodies[item.id] ?? item.body}
                      onChange={(event) =>
                        setDraftBodies((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                    />

                    <div className="grid-2" style={{ marginTop: 12 }}>
                      <div className="pv-note">
                        <b>规格 / 发布时间</b>
                        <p>
                          {rule?.rules.dimensions ?? item.spec.dimensions ?? "-"} · 建议窗口：{rule?.rules.recommendedWindow ?? "-"}
                          {item.spec.durationSeconds ? ` · ${item.spec.durationSeconds}s` : ""}
                        </p>
                      </div>
                      <div className="pv-note">
                        <b>{item.mediaType === "video_script" ? "脚本 / 分镜" : "视觉方向"}</b>
                        <p>
                          {item.mediaType === "video_script"
                            ? [ ...(item.spec.script ?? []).slice(0, 2), ...(item.spec.storyboard ?? []).slice(0, 1) ].join(" / ") || "未提供"
                            : item.spec.visualDirection ?? item.spec.imagePrompt ?? "未提供"}
                        </p>
                      </div>
                    </div>

                    {item.mediaType !== "video_script" ? (
                      <div
                        className="card"
                        style={{
                          padding: 14,
                          marginTop: 12,
                          display: "grid",
                          gap: 10,
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        }}
                      >
                        <label className="sub" style={{ color: "var(--ink-2)" }}>
                          图像模式
                          <select
                            className="btn ghost sm"
                            style={{ width: "100%", marginTop: 6, justifyContent: "space-between" }}
                            value={imageDrafts[item.id]?.mode ?? "text_to_image"}
                            onChange={(event) =>
                              setImageDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...(current[item.id] ?? {
                                    mode: "text_to_image",
                                    backgroundStyle: "",
                                    referenceLabel: "",
                                    referenceFile: null,
                                  }),
                                  mode: event.target.value as ImageGenerationDraft["mode"],
                                },
                              }))
                            }
                          >
                            <option value="text_to_image">文生图</option>
                            <option value="image_to_image">图生图</option>
                            <option value="background_swap">换背景</option>
                          </select>
                        </label>
                        <label className="sub" style={{ color: "var(--ink-2)" }}>
                          背景风格
                          <input
                            className="chat-textarea"
                            style={{ marginTop: 6, minHeight: 44, height: 44, paddingTop: 10, paddingBottom: 10 }}
                            placeholder="展会展台 / 仓储场景"
                            value={imageDrafts[item.id]?.backgroundStyle ?? ""}
                            onChange={(event) =>
                              setImageDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...(current[item.id] ?? {
                                    mode: "text_to_image",
                                    backgroundStyle: "",
                                    referenceLabel: "",
                                    referenceFile: null,
                                  }),
                                  backgroundStyle: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <label className="sub" style={{ color: "var(--ink-2)", gridColumn: "1 / -1" }}>
                          参考图说明
                          <input
                            className="chat-textarea"
                            style={{ marginTop: 6, minHeight: 44, height: 44, paddingTop: 10, paddingBottom: 10 }}
                            placeholder="保留产品角度，只换成中东展会背景"
                            value={imageDrafts[item.id]?.referenceLabel ?? ""}
                            onChange={(event) =>
                              setImageDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...(current[item.id] ?? {
                                    mode: "text_to_image",
                                    backgroundStyle: "",
                                    referenceLabel: "",
                                    referenceFile: null,
                                  }),
                                  referenceLabel: event.target.value,
                                },
                              }))
                            }
                          />
                          <input
                            className="sub"
                            style={{ display: "block", width: "100%", marginTop: 8 }}
                            type="file"
                            accept="image/*"
                            onChange={(event) =>
                              setImageDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...(current[item.id] ?? {
                                    mode: "text_to_image",
                                    backgroundStyle: "",
                                    referenceLabel: "",
                                    referenceFile: null,
                                  }),
                                  referenceFile: event.target.files?.[0] ?? null,
                                },
                              }))
                            }
                          />
                        </label>
                      </div>
                    ) : null}

                    {item.mediaType !== "video_script" &&
                    item.spec.generatedAssets &&
                    item.spec.generatedAssets.length > 0 ? (
                      <div className="pv-grid" style={{ marginTop: 12 }}>
                        {item.spec.generatedAssets.map((asset) => (
                          <div className="pv-card" key={asset.id} style={{ overflow: "hidden", padding: 0 }}>
                            <Image
                              src={asset.previewUrl}
                              alt={`${item.title} ${asset.variant}`}
                              width={asset.width}
                              height={asset.height}
                              unoptimized
                              className="h-48 w-full object-cover"
                            />
                            <div style={{ padding: 12, fontSize: 12.5, color: "var(--ink-2)" }}>
                              {asset.variant} · {asset.width}×{asset.height}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {item.notes.length > 0 ? (
                      <div className="pv-note" style={{ marginTop: 12 }}>
                        <b>备注</b>
                        <p>{item.notes.join(" · ")}</p>
                      </div>
                    ) : null}

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                      {item.mediaType !== "video_script" ? (
                        <button
                          className="btn ghost sm"
                          onClick={() => void generateItemImages(item.id)}
                          disabled={submitting}
                        >
                          {item.spec.generatedAssets?.length ? "重新生成图像" : "生成图像"}
                        </button>
                      ) : null}
                      <button
                        className="btn ghost sm"
                        onClick={() => void saveItemBody(item.id)}
                        disabled={submitting}
                      >
                        保存当前文案
                      </button>
                      <button
                        className={`btn sm ${published ? "ghost" : "primary"}`}
                        onClick={() => void togglePublished(item.id, published)}
                        disabled={submitting}
                      >
                        {published ? "撤回已发" : "发起发布审批"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="card fixes" style={{ marginTop: 14 }}>
            <div className="head-row" style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth={2} style={{ width: 17, height: 17 }}>
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <h3 style={{ fontSize: 14 }}>GPT 校正建议</h3>
              </div>
              <span className="badge cloud">OpenAI · 最新规则</span>
            </div>
            {qualityNotes.map((note) => (
              <div className="fix" key={note.title}>
                <span className={`fi ${note.tone === "warn" ? "warn" : "ok"}`}>
                  {note.tone === "warn" ? "!" : "✓"}
                </span>
                <div>
                  <b>{note.title}</b>
                  <span className="fd">{note.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
