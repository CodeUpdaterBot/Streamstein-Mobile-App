import { useEffect, useState } from "react";

/**
 * Streamstein mobile shell.
 *
 * Stage 1 deliberately does the smallest thing that is worth putting on a phone: it proves
 * the Tauri/Android pipeline end to end (build -> install -> launch -> talk to the native
 * side) on the shell proven by apps/readest-app. The video library, transcript search and
 * spiral dial land on top of this, wired to packages/search-core.
 */

type NativeInfo = {
  platform: string;
  arch: string;
  version: string;
  executable?: string;
};

export default function App() {
  const [info, setInfo] = useState<NativeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<NativeInfo>("native_info");
        if (!cancelled) setInfo(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          Stream<span>stein</span>
        </div>
        <div className="pill">
          {info ? `${info.platform}/${info.arch}` : "connecting…"}
        </div>
      </header>

      <div className="body">
        {error ? (
          <div className="empty">
            <h2>Native bridge unavailable</h2>
            <p>{error}</p>
          </div>
        ) : (
          <>
            <div className="empty" style={{ marginTop: "8vh" }}>
              <h2>No library on this device yet</h2>
              <p>
                This build proves the Android shell. Folder scanning, video tiles and
                spiral search over transcripts come next.
              </p>
            </div>
            <div className="grid" style={{ marginTop: 24 }}>
              {["Video tiles", "VTT transcripts", "Spiral search"].map((label) => (
                <div className="tile" key={label}>
                  {label}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
