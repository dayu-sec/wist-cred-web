/**
 * 钥匙徽标（与 `public/favicon.svg` 同一套几何）。
 *
 * 家族规矩：20×20 圆角徽章 + 白色线稿，渐变从共用的紫罗兰 `#8b5cf6` 出发。
 * 中心是三格蜂巢、网关是单格立方体、接收服务是漏斗 —— 凭据服务用一把**钥匙**：
 * 它是这一层唯一“发出去的东西”，轮廓与前三个都不同，16px 并排也分得开。
 *
 * 背景渐变放在 CSS（`.brand-mark`）而不是 SVG 里：一个徽标两处使用（顶栏 / 登录卡片），
 * 内联 `<defs>` 的 id 会重复。色尾跟 favicon 保持一致。
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 20 20" width={size * 0.72} height={size * 0.72}>
        <g
          fill="none"
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="10" cy="6.2" r="2.9" />
          <path d="M10 9.1v7.1" />
          <path d="M10 12.4h3" />
          <path d="M10 14.9h2.2" />
        </g>
      </svg>
    </span>
  );
}
