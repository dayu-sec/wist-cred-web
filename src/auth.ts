/**
 * 页面口令的**存取**（与 `wist-gateway-web` 的 admin token 同一套做法）。
 *
 * 为什么不让入口 nginx 做 basic auth：
 * 那是浏览器原生弹窗 —— 没有登录框、没有登出、改不了提示，也不是产品的一部分。
 * 产品自己的做法是：页面上输口令 → 存本标签页 → 请求带 `Authorization: Bearer`，
 * 由 `wist-cred` 自己验（`server.mode = "token"`）。
 *
 * 存在 `sessionStorage`：本标签页有效、关掉即没；不落 localStorage（那是“永久登录”）。
 */

const STORAGE_KEY = "wistCredAdminPassword";

/** 口令变更时在 `window` 上派发，供页面重新拉取 / 显示登录态。 */
export const AUTH_CHANGED_EVENT = "wistCredAuthChanged";

/** 当前口令；未设置则 `null`。 */
export function getPassword(): string | null {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    // 隐私模式 / 被策略禁掉 storage：当作没设过，页面会退回登录框。
    return null;
  }
}

/** 设口令（去首尾空白；空串 = 退出登录）。 */
export function setPassword(password: string): void {
  const value = password.trim();
  try {
    if (value) {
      window.sessionStorage.setItem(STORAGE_KEY, value);
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // 存不进去也不拦着用：本次会话里页面自己会再问一次。
  }
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

/** 退出登录：清掉本地口令并通知页面。 */
export function clearPassword(): void {
  setPassword("");
}
