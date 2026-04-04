import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design.css";
import App from "./App.jsx";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
