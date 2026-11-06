import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  /** 确认按钮的字（默认「确认删除」）。 */
  confirmLabel?: string;
  /** 请求进行中：两个按钮都禁用，防连点。 */
  busy?: boolean;
  /**
   * 要求原样输入这串文字才能确认（GitHub 式的"输入仓库名删除"）。
   * 不给就是普通确认；给了，确认按钮在输入匹配前一直禁用。
   */
  requireText?: string;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}

/**
 * 破坏性操作的二次确认框。
 *
 * 用原生 `<dialog>` + `showModal()`：焦点陷阱、Esc 关闭、`::backdrop` 都由浏览器提供，
 * 不用自己拉遮罩层再处理"点了外面但没点中"这类边界。
 *
 * 关闭一律走 React 的 state（`open`）：Esc 与点遮罩都只回调 `onCancel`，不直接 `close()`，
 * 否则会出现"框关了、状态还开着"。
 */
export function ConfirmDialog({
  open,
  title,
  confirmLabel = "确认删除",
  busy = false,
  requireText,
  onCancel,
  onConfirm,
  children,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");

  // 每次打开都从空开始：上一次输入的名字不能成为下一次的"快捷通过"。
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  // 只比 trim 后的原值（区分大小写）：名字就是身份，别做模糊匹配。
  const matched = requireText === undefined || typed.trim() === requireText;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(event) => {
        // 点遮罩时事件目标是 dialog 本身（内容区里的点击目标是它的子节点）。
        if (event.target === ref.current && !busy) onCancel();
      }}
    >
      <h3 id="confirm-title">{title}</h3>
      <div className="confirm-body">{children}</div>
      {requireText !== undefined && (
        <label className="confirm-typed">
          <span>
            输入 <span className="mono">{requireText}</span> 确认
          </span>
          <input
            autoFocus
            className="mono"
            value={typed}
            placeholder={requireText}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && matched && !busy) onConfirm();
            }}
          />
        </label>
      )}
      <div className="confirm-actions">
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button
          type="button"
          className="danger-solid"
          onClick={onConfirm}
          disabled={busy || !matched}
        >
          {busy ? "处理中…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
