"use client";

import { useEffect } from "react";

const TEXT_REPLACEMENTS = new Map<string, string>([
  ["Route", "路由"],
  ["Static", "静态"],
  ["Dynamic", "动态"],
  ["Bundler", "打包器"],
  ["Route Info", "路由信息"],
  ["Preferences", "偏好设置"],
  ["Loading...", "加载中..."],
  ["Issues", "问题"],
  ["Theme", "主题"],
  ["Position", "位置"],
  ["Size", "尺寸"],
  ["Hide", "隐藏"],
  ["Restart", "重启"],
  ["Reset Cache", "重置缓存"],
  ["Bottom Left", "左下"],
  ["Bottom Right", "右下"],
  ["Top Left", "左上"],
  ["Top Right", "右上"],
  ["System", "跟随系统"],
  ["Light", "浅色"],
  ["Dark", "深色"],
  ["Hide Dev Tools for this session", "本次会话隐藏开发工具"],
  [
    "Hide Dev Tools until you restart your dev server, or 1 day.",
    "隐藏开发工具，直到你重启开发服务器，或最多持续 1 天。",
  ],
  ["Hide Dev Tools shortcut", "隐藏开发工具快捷键"],
  [
    "Set a custom keyboard shortcut to toggle visibility.",
    "设置自定义键盘快捷键，用于切换显示状态。",
  ],
  ["Record Shortcut", "录制快捷键"],
  ["Disable Dev Tools for this project", "为此项目禁用开发工具"],
  [
    "To disable this UI completely, set",
    "如需彻底禁用这个界面，请在",
  ],
  ["in your", "中设置"],
  ["file.", "。"],
  ["Restart Dev Server", "重启开发服务器"],
  [
    "Restarts the development server without needing to leave the browser.",
    "无需离开浏览器即可重启开发服务器。",
  ],
  ["Reset Bundler Cache", "重置打包缓存"],
  [
    "Clears the bundler cache and restarts the dev server.",
    "清空打包缓存并重启开发服务器。",
  ],
  [
    "Helpful if you are seeing stale errors or changes are not appearing.",
    "适用于遇到陈旧报错或修改未生效的情况。",
  ],
]);

function replaceText(value: string) {
  const trimmed = value.trim();
  const translated = TEXT_REPLACEMENTS.get(trimmed);

  if (!translated) {
    return value;
  }

  const prefixLength = value.indexOf(trimmed);
  const prefix = prefixLength > 0 ? value.slice(0, prefixLength) : "";
  const suffixStart = prefixLength + trimmed.length;
  const suffix = suffixStart < value.length ? value.slice(suffixStart) : "";

  return `${prefix}${translated}${suffix}`;
}

function translateShadowRoot(root: ShadowRoot) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();

  while (current) {
    const next = walker.nextNode();
    if (current.nodeValue) {
      const translated = replaceText(current.nodeValue);
      if (translated !== current.nodeValue) {
        current.nodeValue = translated;
      }
    }
    current = next;
  }
}

export function NextDevtoolsZh() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    const observedRoots = new WeakSet<ShadowRoot>();
    const shadowObservers: MutationObserver[] = [];

    function attach(root: ShadowRoot) {
      if (observedRoots.has(root)) {
        translateShadowRoot(root);
        return;
      }

      observedRoots.add(root);
      translateShadowRoot(root);

      const shadowObserver = new MutationObserver(() => {
        translateShadowRoot(root);
      });

      shadowObserver.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      shadowObservers.push(shadowObserver);
    }

    function scan() {
      document.querySelectorAll("nextjs-portal").forEach((element) => {
        if (element.shadowRoot) {
          attach(element.shadowRoot);
        }
      });
    }

    scan();

    const documentObserver = new MutationObserver(() => {
      scan();
    });

    documentObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      documentObserver.disconnect();
      shadowObservers.forEach((observer) => observer.disconnect());
    };
  }, []);

  return null;
}
