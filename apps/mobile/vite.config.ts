import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri serves the dev server on a fixed port, so strictPort matters: a silent fallback to
// another port would leave the native shell pointing at nothing.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    // Android System WebView on the target devices handles es2021 comfortably.
    target: "es2021",
    outDir: "dist",
  },
});
