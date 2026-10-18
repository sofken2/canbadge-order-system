import "@canbadge/editor/styles.css";
import "@canbadge/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { moveDiscordReturnToOrder } from "./discord-return";

moveDiscordReturnToOrder(window.location, window.history);

const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
