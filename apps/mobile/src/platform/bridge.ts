/**
 * Desktop→mobile bridge.
 *
 * The desktop renderer talks to the Electron main process through `window.electron`, whose
 * surface is 155 methods defined in the desktop `preload.js`. Rather than edit every ported
 * page, this module installs a compatible `window.electron` backed by Tauri `invoke`, so the
 * porting loop stays: copy the page, fix imports, adapt the few APIs with no mobile analogue.
 *
 * Outside the native shell (plain `vite dev` in a browser) it installs inert stubs, so layout
 * and UI work can happen in a desktop browser without a device attached.
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type Platform = "android" | "ios" | "web";

/** True when we are running inside the Tauri shell (a real device or desktop Tauri build). */
export function isNative(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function platform(): Platform {
  if (!isNative()) return "web";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  return "web";
}

/** Call a native command, or throw a clear error when running without the shell. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isNative()) {
    throw new Error(`native command "${cmd}" is unavailable outside the app shell`);
  }
  return await tauriInvoke<T>(cmd, args);
}

/**
 * Methods the desktop exposes that have no mobile equivalent. Listed explicitly so the gap is
 * visible in code rather than discovered as a runtime crash: the UI should hide these paths.
 */
export const DESKTOP_ONLY = [
  "downloadAndInstallUpdate",
  "cancelUpdate",
  "detectUpdateFormat",
  "castConnect",
  "castDisconnect",
  "castLoad",
  "castPlay",
  "castPause",
  "castSeek",
  "castSetVolume",
  "castSetMute",
  "castListDevices",
  "castStartDiscovery",
  "castStopDiscovery",
  "castGetStatus",
  "getPipWebContentsId",
  "closePipWindow",
  "getYtBridgeStatus",
  "getYtBridgeStartup",
  "checkYtDlpUpdate",
  "checkDownloader",
] as const;

const desktopOnly = new Set<string>(DESKTOP_ONLY);

/**
 * Install `window.electron`. Methods are routed to a same-named Tauri command; a desktop-only
 * method rejects with a stable marker so a ported page can branch on it, and anything not yet
 * implemented rejects the same way instead of failing silently.
 */
export function installBridge(): void {
  if (typeof window === "undefined") return;

  const existing = (window as unknown as { electron?: Record<string, unknown> }).electron;
  if (existing && !(existing as { __shim?: boolean }).__shim) return; // never clobber the real one

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === "__shim") return true;
      if (prop === "isNative") return isNative;
      if (prop === "platform") return platform();

      return async (...args: unknown[]) => {
        if (desktopOnly.has(prop)) {
          const err = new Error(`${prop} is desktop-only`);
          (err as Error & { code?: string }).code = "DESKTOP_ONLY";
          throw err;
        }
        return await invoke(prop, { args });
      };
    },
  };

  (window as unknown as { electron: unknown }).electron = new Proxy({}, handler);
}
