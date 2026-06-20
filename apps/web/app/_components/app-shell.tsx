"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchCurrentMe, type MeResponse } from "@/app/_lib/auth-client";

type NotificationItem = {
  id: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  createdAt: string;
  readAt: string | null;
};

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badgeKey?: "notifications";
};

type NavGroup = {
  label?: string;
  items: NavItem[];
};

const ROUTES_WITHOUT_SHELL = ["/login", "/site/"];

function icon(path: React.ReactNode) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      {path}
    </svg>
  );
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      {
        href: "/",
        label: "工作台",
        icon: icon(<path d="M3 13h8V3H3zM13 21h8V8h-8zM3 21h8v-5H3z" />),
      },
    ],
  },
  {
    label: "获客",
    items: [
      {
        href: "/kb/reviews",
        label: "知识库",
        icon: icon(
          <>
            <path d="M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 0-2 0z" />
            <path d="M8 7h7M8 11h7" />
          </>,
        ),
      },
      {
        href: "/sites",
        label: "AI 建站 / 站点",
        icon: icon(
          <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18" />
          </>,
        ),
      },
      {
        href: "/design",
        label: "AI 设计 / 内容包",
        icon: icon(<path d="M12 3l2.4 5.4L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-.6z" />),
      },
    ],
  },
  {
    label: "询盘",
    items: [
      {
        href: "/crm",
        label: "CRM 管道",
        icon: icon(<path d="M4 5h4v14H4zM10 5h4v14h-4zM16 5h4v14h-4z" />),
      },
      {
        href: "/replies",
        label: "AI 首响审批",
        icon: icon(<path d="M4 4h16v12H5.2L4 18z" />),
      },
    ],
  },
  {
    label: "治理",
    items: [
      {
        href: "/notifications",
        label: "通知中心",
        badgeKey: "notifications",
        icon: icon(
          <>
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </>,
        ),
      },
      {
        href: "/publish-checklist",
        label: "发布清单",
        icon: icon(
          <>
            <path d="M9 6h11" />
            <path d="M9 12h11" />
            <path d="M9 18h11" />
            <path d="m4 6 1.5 1.5L7.5 5" />
            <path d="m4 12 1.5 1.5L7.5 11" />
            <path d="m4 18 1.5 1.5L7.5 17" />
          </>,
        ),
      },
      {
        href: "/settings",
        label: "设置 / 治理",
        icon: icon(
          <>
            <path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z" />
            <path d="M9.5 12.5 11 14l4-4" />
          </>,
        ),
      },
    ],
  },
];

const TITLE_BY_PREFIX: Array<[string, string]> = [
  ["/kb", "知识库"],
  ["/sites", "AI 建站 / 站点"],
  ["/design", "AI 设计 / 内容包"],
  ["/content-packs", "内容包"],
  ["/crm", "CRM 管道"],
  ["/replies", "AI 首响审批"],
  ["/hitl", "人工把关 · 审批中心"],
  ["/notifications", "通知中心"],
  ["/publish-checklist", "发布清单"],
  ["/settings", "设置 / 治理"],
];

function resolveTitle(pathname: string) {
  if (pathname === "/") {
    return "工作台";
  }

  const match = TITLE_BY_PREFIX.find(([prefix]) => pathname.startsWith(prefix));
  return match ? match[1] : "TradePilot AI";
}

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const bare = ROUTES_WITHOUT_SHELL.some((prefix) => pathname.startsWith(prefix));
  const [tabs, setTabs] = useState<Array<{ href: string; title: string }>>([]);

  useEffect(() => {
    if (bare) {
      return;
    }
    const title = resolveTitle(pathname);
    // 把访问过的页面累积为可切换标签；已存在则不重复加
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTabs((prev) =>
      prev.some((tab) => tab.href === pathname)
        ? prev
        : [...prev, { href: pathname, title }],
    );
  }, [pathname, bare]);

  function closeTab(href: string) {
    const next = tabs.filter((tab) => tab.href !== href);
    setTabs(next);
    if (href === pathname) {
      router.push(next[next.length - 1]?.href ?? "/");
    }
  }

  const [me, setMe] = useState<MeResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 即使请求失败也跳回登录页
    }
    window.location.assign("/login");
  }

  useEffect(() => {
    if (bare) {
      return;
    }

    let active = true;

    async function load() {
      try {
        const profile = await fetchCurrentMe();
        if (!active) {
          return;
        }
        setMe(profile);

        const tenantId =
          profile.currentTenant?.tenantId ?? profile.memberships[0]?.tenantId;
        if (!tenantId) {
          return;
        }

        const response = await fetch("/api/notifications", {
          headers: { "X-Tenant-Id": tenantId },
        });
        if (!response.ok || !active) {
          return;
        }

        const payload = (await response.json()) as {
          unreadCount: number;
          items: NotificationItem[];
        };
        setUnread(payload.unreadCount ?? 0);
        setNotifications(payload.items ?? []);
      } catch {
        // Shell stays usable even if the profile/notifications fail to load.
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [bare, pathname]);

  const avatarInitial = useMemo(() => {
    const source = me?.user.name?.trim() || me?.user.email?.trim() || "海";
    return source.charAt(0).toUpperCase();
  }, [me]);

  if (bare) {
    return <>{children}</>;
  }

  const tenantName = me?.currentTenant?.tenantName ?? me?.memberships[0]?.tenantName;

  return (
    <div className="layout">
      <aside className="side">
        <div className="brand">
          <div className="logo">智</div>
          <div className="nm">
            TradePilot
            <span>{tenantName ?? "本地服务器"}</span>
          </div>
        </div>

        <nav className="nav">
          {NAV_GROUPS.map((group, groupIndex) => (
            <div key={group.label ?? `group-${groupIndex}`}>
              {group.label ? <div className="nav-label">{group.label}</div> : null}
              {group.items.map((item) => {
                const badge =
                  item.badgeKey === "notifications" && unread > 0 ? unread : undefined;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={isActive(pathname, item.href) ? "on" : undefined}
                  >
                    {item.icon}
                    {item.label}
                    {badge ? <span className="nb">{badge}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          本地服务器 · <b>Mac</b>
          <br />
          Qwen + bge-m3 隐私在线
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{resolveTitle(pathname)}</h1>
          <div className="tb-right">
            <span className="pill">
              市场 <b>中东 · 拉美 · 独联体</b>
            </span>
            <span className="pill">
              <span className="dot local" />
              数据本地 · 隐私在线
            </span>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="bell"
                onClick={() => setNotifOpen((open) => !open)}
                aria-label="通知"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                </svg>
                {unread > 0 ? <span className="nb">{unread}</span> : null}
              </button>
              {notifOpen ? (
                <div className="notif">
                  <div className="nh">
                    <b>待处理</b>
                    <span onClick={() => setNotifOpen(false)}>关闭</span>
                  </div>
                  {notifications.slice(0, 6).map((item) => (
                    <Link
                      key={item.id}
                      href={item.linkUrl ?? "/hitl"}
                      className="ni"
                      onClick={() => setNotifOpen(false)}
                    >
                      <div className="grow">
                        <div className="nt">{item.title}</div>
                        <div className="ns">{item.body ?? "点击查看详情"}</div>
                      </div>
                      {!item.readAt ? <span className="nd" /> : null}
                    </Link>
                  ))}
                  {notifications.length === 0 ? (
                    <div className="ni">
                      <div className="grow">
                        <div className="ns">暂无通知。</div>
                      </div>
                    </div>
                  ) : null}
                  <Link
                    href="/notifications"
                    className="ni"
                    onClick={() => setNotifOpen(false)}
                  >
                    <div className="grow">
                      <div className="nt">查看全部通知</div>
                      <div className="ns">进入通知中心查看完整待办与审计提示。</div>
                    </div>
                  </Link>
                </div>
              ) : null}
            </div>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="avatar"
                onClick={() => setUserOpen((open) => !open)}
                aria-label="个人菜单"
              >
                {avatarInitial}
              </button>
              {userOpen ? (
                <div className="notif" style={{ width: 240 }}>
                  <div className="nh">
                    <b>{me?.user.name?.trim() || "当前用户"}</b>
                  </div>
                  <div className="ni" style={{ cursor: "default" }}>
                    <div className="grow">
                      <div className="ns">{me?.user.email ?? "未登录"}</div>
                      <div className="ns" style={{ marginTop: 2 }}>
                        {tenantName ?? "本地服务器"}
                      </div>
                    </div>
                  </div>
                  <Link href="/settings" className="ni" onClick={() => setUserOpen(false)}>
                    <div className="grow">
                      <div className="nt">设置 / 治理</div>
                    </div>
                  </Link>
                  <button
                    type="button"
                    className="ni"
                    style={{ width: "100%", textAlign: "left" }}
                    onClick={() => {
                      setUserOpen(false);
                      void handleLogout();
                    }}
                  >
                    <div className="grow">
                      <div className="nt" style={{ color: "var(--warn)" }}>退出登录</div>
                    </div>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {tabs.length > 0 ? (
          <div className="tabbar">
            {tabs.map((tab) => (
              <div
                key={tab.href}
                className={`tab ${tab.href === pathname ? "on" : ""}`}
                onClick={() => router.push(tab.href)}
              >
                <span className="label">{tab.title}</span>
                <span
                  className="x"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.href);
                  }}
                >
                  ×
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="content fade-in">{children}</div>
      </div>
    </div>
  );
}
