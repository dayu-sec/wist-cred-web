import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { initLocale, useLocale } from "./i18n";
import "./index.css";

initLocale();

/** 语言一变就整棵树重挂载（`key`）：组件里的 `t()` 都会按新语言重新求值。 */
function Root() {
  const locale = useLocale();
  return <App key={locale} />;
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root not found");
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
