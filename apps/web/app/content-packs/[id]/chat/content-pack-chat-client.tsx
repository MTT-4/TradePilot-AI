"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

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
          : `/api/content-items/${itemId}/mark-published`,
        {
          method: "POST",
          headers: {
            "x-tenant-id": tenantId,
          },
        },
      );

      if (!response.ok) {
        throw new Error("更新发布状态失败。");
      }

      const nextPack = (await response.json()) as PackResponse;
      setPack(nextPack);
    } catch (toggleError) {
      setError(
        toggleError instanceof Error ? toggleError.message : "更新发布状态失败。",
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
      <main className="min-h-screen bg-[#f6f1e6] px-6 py-10 text-[#1f241f]">
        <div className="mx-auto max-w-6xl rounded-[28px] border border-[#d9d0bb] bg-white/70 p-8">
          正在加载内容包…
        </div>
      </main>
    );
  }

  if (error && !pack) {
    return (
      <main className="min-h-screen bg-[#f6f1e6] px-6 py-10 text-[#1f241f]">
        <div className="mx-auto max-w-4xl rounded-[28px] border border-[#d9d0bb] bg-white/80 p-8">
          {error}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(12,92,86,0.18),_transparent_38%),linear-gradient(180deg,#f8f4ea_0%,#efe5d0_100%)] px-4 py-6 text-[#1f241f] md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[30px] border border-[#d9d0bb] bg-[#fffdf7]/90 p-6 shadow-[0_24px_80px_rgba(61,53,31,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-[#7b745f]">
                AI 设计 / 内容包
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-[#1f241f]">
                {pack?.pack.title}
              </h1>
              <p className="mt-2 text-sm leading-7 text-[#5f594c]">
                租户：{tenantName} · 选题：{pack?.pack.topic} · 市场：
                {pack?.pack.market ?? "Global"} · 状态：{pack?.pack.status}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                className="rounded-full border border-[#d4cab5] px-4 py-2 text-sm text-[#31463b]"
                href={`/api/content-packs/${packId}/export?fmt=csv`}
                target="_blank"
                rel="noreferrer"
              >
                导出 CSV
              </a>
              <a
                className="rounded-full border border-[#d4cab5] px-4 py-2 text-sm text-[#31463b]"
                href={`/api/content-packs/${packId}/export?fmt=md`}
                target="_blank"
                rel="noreferrer"
              >
                导出 Markdown
              </a>
              <a
                className="rounded-full border border-[#d4cab5] px-4 py-2 text-sm text-[#31463b]"
                href={`/api/content-packs/${packId}/export?fmt=zip`}
                target="_blank"
                rel="noreferrer"
              >
                导出 ZIP
              </a>
            </div>
          </div>

          {pack?.pack.brandKit ? (
            <div className="mt-5 flex flex-wrap gap-3 text-sm text-[#405045]">
              <span className="rounded-full bg-[#f4efe1] px-3 py-1">
                品牌：{pack.pack.brandKit.companyName}
              </span>
              <span className="rounded-full bg-[#f4efe1] px-3 py-1">
                主色：{pack.pack.brandKit.primaryColor ?? "未设置"}
              </span>
              <span className="rounded-full bg-[#f4efe1] px-3 py-1">
                辅色：{pack.pack.brandKit.secondaryColor ?? "未设置"}
              </span>
            </div>
          ) : null}
        </section>

        {error ? (
          <div className="rounded-[22px] border border-[#d9c4ad] bg-[#fff1e6] px-5 py-4 text-sm text-[#8b4d26]">
            {error}
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="rounded-[30px] border border-[#d9d0bb] bg-[#fffdf7]/95 p-5">
            <div className="text-xs uppercase tracking-[0.28em] text-[#7b745f]">
              人 + AI 对话
            </div>
            <div className="mt-4 space-y-3">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`rounded-[24px] px-4 py-3 text-sm leading-7 ${
                    message.role === "assistant"
                      ? "bg-[#eef5f0] text-[#214735]"
                      : "bg-[#1f241f] text-[#f7f3ea]"
                  }`}
                >
                  {message.content}
                </div>
              ))}
            </div>
            <textarea
              className="mt-4 min-h-36 w-full rounded-[24px] border border-[#d8cfba] bg-white px-4 py-3 text-sm leading-7 outline-none focus:border-[#23604b]"
              placeholder="例如：把 LinkedIn 调成更技术型，把 TikTok 的开头钩子更短，把 Instagram 改成 4 张轮播。"
              value={messageInput}
              onChange={(event) => setMessageInput(event.target.value)}
            />
            <button
              className="mt-4 w-full rounded-full bg-[#214735] px-5 py-3 text-sm font-medium text-[#f7f3ea] disabled:opacity-50"
              onClick={() => void submitChat()}
              disabled={submitting || !messageInput.trim()}
            >
              {submitting ? "处理中…" : "应用到内容包"}
            </button>
          </div>

          <div className="space-y-5">
            <div className="grid gap-4 xl:grid-cols-2">
              {pack?.items.map((item) => {
                const rule = rulesByPlatform.get(item.platform);
                const published = item.publishStatus === "published";

                return (
                  <article
                    key={item.id}
                    className="rounded-[28px] border border-[#d9d0bb] bg-[#fffdf7]/95 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.24em] text-[#7b745f]">
                          {rule?.displayName ?? item.platform}
                        </div>
                        <h2 className="mt-2 text-xl font-semibold text-[#1f241f]">
                          {item.title}
                        </h2>
                        <p className="mt-2 text-sm text-[#5f594c]">
                          {item.mediaType} · {item.publishStatus}
                        </p>
                      </div>
                      <button
                        className={`rounded-full px-4 py-2 text-xs font-medium ${
                          published
                            ? "bg-[#efe2d6] text-[#8a5430]"
                            : "bg-[#214735] text-[#f7f3ea]"
                        }`}
                        onClick={() => void togglePublished(item.id, published)}
                        disabled={submitting}
                      >
                        {published ? "撤回已发" : "标记已发"}
                      </button>
                    </div>

                    <div className="mt-4 rounded-[24px] bg-[#f4efe1] p-4 text-sm leading-7 text-[#4d4a43]">
                      <div>Cover: {item.coverHeadline}</div>
                      <div>
                        Spec: {item.spec.ratio ?? "-"} · {item.spec.dimensions ?? "-"}
                        {item.spec.durationSeconds
                          ? ` · ${item.spec.durationSeconds}s`
                          : ""}
                      </div>
                      <div>建议发布时间：{rule?.rules.recommendedWindow ?? "-"}</div>
                      {item.trackingLink ? (
                        <div className="break-all">
                          追踪链接：{item.trackingLink.resolvedUrl}
                        </div>
                      ) : (
                        <div className="text-[#9a5e10]">追踪链接缺失</div>
                      )}
                    </div>

                    <textarea
                      className="mt-4 min-h-32 w-full rounded-[22px] border border-[#d8cfba] bg-white px-4 py-3 text-sm leading-7 outline-none focus:border-[#23604b]"
                      value={draftBodies[item.id] ?? item.body}
                      onChange={(event) =>
                        setDraftBodies((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                    />

                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.hashtags.map((hashtag) => (
                        <span
                          key={hashtag}
                          className="rounded-full bg-[#eef5f0] px-3 py-1 text-xs text-[#214735]"
                        >
                          {hashtag}
                        </span>
                      ))}
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-[20px] border border-[#ece2cd] bg-white/80 p-4 text-sm text-[#4f4a40]">
                        <div className="font-medium text-[#1f241f]">视觉方向</div>
                        <p className="mt-2 leading-7">
                          {item.spec.visualDirection ?? "未提供"}
                        </p>
                      </div>
                      <div className="rounded-[20px] border border-[#ece2cd] bg-white/80 p-4 text-sm text-[#4f4a40]">
                        <div className="font-medium text-[#1f241f]">
                          {item.mediaType === "video_script" ? "脚本 / 分镜" : "图像提示"}
                        </div>
                        {item.mediaType === "video_script" ? (
                          <ul className="mt-2 space-y-2 leading-7">
                            {(item.spec.script ?? []).slice(0, 4).map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                            {(item.spec.storyboard ?? []).slice(0, 3).map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 leading-7">
                            {item.spec.imagePrompt ?? "未提供"}
                          </p>
                        )}
                      </div>
                    </div>

                    {item.mediaType !== "video_script" ? (
                      <div className="mt-4 grid gap-3 rounded-[20px] border border-[#ece2cd] bg-white/85 p-4 md:grid-cols-2">
                        <label className="text-sm text-[#4f4a40]">
                          <div className="font-medium text-[#1f241f]">图像模式</div>
                          <select
                            className="mt-2 w-full rounded-2xl border border-[#d8cfba] bg-white px-3 py-2 text-sm"
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
                        <label className="text-sm text-[#4f4a40]">
                          <div className="font-medium text-[#1f241f]">背景风格</div>
                          <input
                            className="mt-2 w-full rounded-2xl border border-[#d8cfba] bg-white px-3 py-2 text-sm"
                            placeholder="如：展会展台 / 仓储场景"
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
                        <label className="text-sm text-[#4f4a40] md:col-span-2">
                          <div className="font-medium text-[#1f241f]">参考图说明 / 文件</div>
                          <input
                            className="mt-2 w-full rounded-2xl border border-[#d8cfba] bg-white px-3 py-2 text-sm"
                            placeholder="如：保留产品角度，只换成中东展会背景"
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
                            className="mt-2 block w-full text-sm text-[#4f4a40]"
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
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {item.spec.generatedAssets.map((asset) => (
                          <div
                            key={asset.id}
                            className="overflow-hidden rounded-[20px] border border-[#ece2cd] bg-white/90"
                          >
                            <Image
                              src={asset.previewUrl}
                              alt={`${item.title} ${asset.variant}`}
                              width={asset.width}
                              height={asset.height}
                              unoptimized
                              className="h-48 w-full object-cover"
                            />
                            <div className="px-4 py-3 text-xs text-[#5b5649]">
                              {asset.variant} · {asset.width}×{asset.height}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {item.notes.length > 0 ? (
                      <div className="mt-4 rounded-[20px] bg-[#faf6eb] p-4 text-sm leading-7 text-[#5b5649]">
                        {item.notes.join(" · ")}
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-3">
                      {item.mediaType !== "video_script" ? (
                        <button
                          className="rounded-full border border-[#cfc3aa] px-4 py-2 text-sm text-[#31463b]"
                          onClick={() => void generateItemImages(item.id)}
                          disabled={submitting}
                        >
                          {item.spec.generatedAssets?.length ? "重新生成图像" : "生成图像"}
                        </button>
                      ) : null}
                      <button
                        className="rounded-full border border-[#cfc3aa] px-4 py-2 text-sm text-[#31463b]"
                        onClick={() => void saveItemBody(item.id)}
                        disabled={submitting}
                      >
                        保存当前文案
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
