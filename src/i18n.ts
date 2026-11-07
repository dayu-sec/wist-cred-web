import { useSyncExternalStore } from "react";

/**
 * 界面语言：中文（源语言）/ English。
 *
 * 与 `wist-gateway-web` 同一套约定（那边把共享口径放在 `@dayu-sec/wist-web-core/i18n`，
 * 这个页面只有应用层文案，所以自带一份精简版）：
 *
 * ```tsx
 * import { t } from "../i18n";
 * <span>{t("已接入", "Enrolled")}</span>
 * <span>{t("已选 {n} 台", "{n} selected", { n: 3 })}</span>
 * ```
 *
 * **中文原文写在第一个参数上**：它既是中文界面的文案，也是这段文案的「身份」—— 不另立 key 表，
 * 免得文案一改就要同步两张表。
 *
 * ⚠️ `t()` 必须在**渲染期**求值（组件体内、JSX 里、渲染期调用的函数里）。模块顶层的常量对象里
 * 不要放 `t(...)`：那只会求值一次，切语言时不会变。
 *
 * 切语言会整棵树重挂载（`main.tsx` 里 `<App key={locale} />`）：这样任何组件里的 `t()` 都会在
 * 新语言下重新求值，不必给每个组件挂订阅。代价是页面内的局部状态（展开的面板、输入到一半的
 * 表单）会重置 —— 数据在服务端，重挂载后会重新拉。
 */

export type Locale = "zh" | "en";

const STORAGE_KEY = "wistCredWeb.locale";

const listeners = new Set<() => void>();

/** 当前语言（模块级）。初始 zh；`initLocale()` 会按存储值设一次。 */
let current: Locale = "zh";

/** 读存储的偏好；没有 / 读不出 → `zh`（默认中文，与加入切换之前一致）。 */
function readStored(): Locale {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

function apply(next: Locale, persist: boolean): void {
  current = next;
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, current);
    } catch {
      // 隐私模式 / 存储被禁：语言本次会话内仍然生效，只是记不住。
    }
  }
  document.documentElement.lang = current === "en" ? "en" : "zh-CN";
  document.title = current === "en" ? "WistCred · Credential service" : "WistCred · 凭据服务";
  listeners.forEach((notify) => notify());
}

/** 启动时调一次（`main.tsx`）：把存储的语言装上。 */
export function initLocale(): void {
  apply(readStored(), false);
}

/** 切换语言（顶栏那颗 中文 / EN 按钮调它）。 */
export function setAppLocale(next: Locale): void {
  apply(next, true);
}

/** 当前语言；组件订阅它（切语言时重渲染）。 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** 取词：`zh` 是中文原文（也是这段文案的身份），`en` 是英文；`params` 填 `{name}` 占位符。 */
export function t(zh: string, en: string, params?: Record<string, string | number>): string {
  const template = current === "en" ? en : zh;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in params ? String(params[key]) : whole,
  );
}

/**
 * `Intl` / `toLocaleString` 用的语言标签：日期时间也跟界面语言走
 * （英文界面还按 `zh-CN` 格式化会得到 `2026/11/6 21:40` 这种中式写法）。
 */
export function dateLocale(): string {
  return current === "en" ? "en-US" : "zh-CN";
}
