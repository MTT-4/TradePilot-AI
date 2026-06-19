"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  badgeKey?: "leads" | "reply";
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
        href: "/hitl",
        label: "AI 首响审批",
        badgeKey: "reply",
        icon: icon(<path d="M4 4h16v12H5.2L4 18z" />),
      },
    ],
  },
  {
    label: "治理",
    items: [
      {
        href: "/settings",
        label: "合规 / 权限",
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
  ["/hitl", "人工把关 · 审批中心"],
  ["/settings", "合规与权限"],
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
  const bare = ROUTES_WITHOUT_SHELL.some((prefix) => pathname.startsWith(prefix));

  const [me, setMe] = useState<MeResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

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
                  item.badgeKey === "reply" && unread > 0 ? unread : undefined;
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
                </div>
              ) : null}
            </div>
            <div className="avatar">{avatarInitial}</div>
          </div>
        </header>

        <div className="content fade-in">{children}</div>
      </div>
    </div>
  );
}
