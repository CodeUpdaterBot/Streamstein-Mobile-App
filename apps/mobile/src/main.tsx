import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { installBridge } from "./platform/bridge";

// Install the desktop-compatible window.electron shim BEFORE any page renders: ported
// desktop pages read window.electron during their first render, not after mount.
installBridge();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
