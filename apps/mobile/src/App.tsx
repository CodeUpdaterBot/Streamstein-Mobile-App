import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke, isNative, platform } from "./platform/bridge";

/**
 * Streamstein mobile — a local content app.
 *
 * Point it at the folder you copied media into, and it shows your library as tiles you can
 * scroll and tap to play. No streaming, no downloading: yt-dlp/ffmpeg cannot exist on Android
 * and a broken button is worse than no button.
 *
 * The Rust `scan_videos` command is the source of truth for what exists; this file decides how
 * it looks and what you can do with an entry.
 */

type VideoEntry = {
  path: string;
  name: string;
  title: string;
  dir: string;
  ext: string;
  size_bytes: number;
  modified_ms: number | null;
  transcript: string | null;
  comments: string | null;
};

type ScanResult = {
  root: string;
  videos: VideoEntry[];
  total: number;
  truncated: boolean;
  unreadable: boolean;
};

type CandidateRoot = { path: string; video_count: number };
type Settings = { library_root: string | null };
type SortKey = "recent" | "title" | "largest";

type StorageDiagnosis = {
  /** False when the app cannot even list the top of shared storage — the permission signal. */
  can_list_shared_storage: boolean;
  roots: { path: string; exists: boolean; readable: boolean; video_count: number }[];
  candidate_count: number;
};

const fmtSize = (b: number) => {
  if (!b) return "";
  const gb = b / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.max(1, Math.round(b / 1024 ** 2))} MB`;
};

const fmtDate = (ms: number | null) => {
  if (!ms) return "";
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const fmtClock = (s: number) => {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

/**
 * A tile renders a <video> only while it is near the viewport. Android's WebView runs out of
 * video decoders long before it runs out of memory, so one live element per library entry
 * freezes the list on a real device — but rendering on demand still yields a true thumbnail and
 * the duration, which is what makes a media library feel like one.
 */
function Tile({ video, onOpen }: { video: VideoEntry; onOpen: (v: VideoEntry) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: "300px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="tile" ref={ref} onClick={() => onOpen(video)}>
      <div className="thumb">
        {visible ? (
          <video
            src={convertFileSrc(video.path)}
            preload="metadata"
            muted
            playsInline
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d)) setDuration(d);
            }}
          />
        ) : (
          <div className="thumb-placeholder" />
        )}
        {duration != null && <span className="badge-time">{fmtClock(duration)}</span>}
      </div>
      <div className="meta">
        <div className="title" title={video.title}>
          {video.title}
        </div>
        <div className="sub">
          {[fmtDate(video.modified_ms), fmtSize(video.size_bytes)].filter(Boolean).join(" · ")}
        </div>
        <div className="marks">
          <span className="chip">{video.ext.toUpperCase()}</span>
          {video.transcript && <span className="chip chip-on">Transcript</span>}
          {video.comments && <span className="chip chip-on">Comments</span>}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [roots, setRoots] = useState<CandidateRoot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [playing, setPlaying] = useState<VideoEntry | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  // Only fetched when the usual folders come back empty, so a healthy launch pays nothing.
  const [diag, setDiag] = useState<StorageDiagnosis | null>(null);

  const runScan = useCallback(async (root: string) => {
    setBusy(true);
    setError(null);
    try {
      setScan(await invoke<ScanResult>("scan_videos", { root }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // Boot: restore the chosen folder, or offer candidates when nothing is set yet.
  useEffect(() => {
    if (!isNative()) {
      setError("Run this inside the app — a browser has no filesystem access.");
      return;
    }
    (async () => {
      try {
        const s = await invoke<Settings>("get_settings");
        setSettings(s);
        if (s.library_root) {
          await runScan(s.library_root);
        } else {
          setRoots(await invoke<CandidateRoot[]>("candidate_roots"));
          setDiag(await invoke<StorageDiagnosis>("storage_diagnosis"));
          setShowSetup(true);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [runScan]);

  const chooseRoot = useCallback(
    async (root: string) => {
      try {
        const s = await invoke<Settings>("set_library_root", { root });
        setSettings(s);
        setShowSetup(false);
        await runScan(root);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [runScan],
  );

  const videos = useMemo(() => {
    const list = scan?.videos ?? [];
    const q = query.trim().toLowerCase();
    // Match the folder too: "Tim Dillon" should find a whole channel copied as a folder.
    const filtered = q
      ? list.filter((v) => v.title.toLowerCase().includes(q) || v.dir.toLowerCase().includes(q))
      : list;
    const sorted = [...filtered];
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "largest") sorted.sort((a, b) => b.size_bytes - a.size_bytes);
    // "recent" is already the order the scan returns.
    return sorted;
  }, [scan, query, sort]);

  const reopen = useCallback(async () => {
    try {
      setRoots(await invoke<CandidateRoot[]>("candidate_roots"));
      setDiag(await invoke<StorageDiagnosis>("storage_diagnosis"));
    } catch {
      /* keep whatever list we had */
    }
    setShowSetup(true);
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          Stream<span>stein</span>
        </div>
        {scan && <div className="pill">{scan.total} videos</div>}
        <button className="icon-btn" onClick={reopen} aria-label="Library folder">
          ⚙
        </button>
      </header>

      {error && (
        <div className="notice">
          {error}
          <button onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {scan?.unreadable && (
        <div className="notice">
          Couldn&apos;t read <code>{scan.root}</code>. On Android this needs “All files access”
          for Streamstein (Settings → Apps → Streamstein → Permissions).
        </div>
      )}

      {scan && scan.total > 0 && (
        <div className="toolbar">
          <input
            className="search"
            placeholder="Search your library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            inputMode="search"
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="recent">Recent</option>
            <option value="title">Title</option>
            <option value="largest">Largest</option>
          </select>
        </div>
      )}

      <div className="body">
        {busy && !scan && <div className="empty">Scanning…</div>}

        {scan && scan.total === 0 && !scan.unreadable && (
          <div className="empty">
            <h2>No videos in this folder</h2>
            <p>
              <code>{scan.root}</code> has no playable video files. Pick a different folder with
              the ⚙ button.
            </p>
          </div>
        )}

        {scan && scan.total > 0 && videos.length === 0 && (
          <div className="empty">
            <h2>No matches</h2>
            <p>Nothing in your library matches “{query}”.</p>
          </div>
        )}

        {videos.length > 0 && (
          <div className="grid">
            {videos.map((v) => (
              <Tile key={v.path} video={v} onOpen={setPlaying} />
            ))}
          </div>
        )}

        {scan?.truncated && (
          <div className="foot">Showing the first {scan.total} entries — the folder holds more.</div>
        )}
      </div>

      {showSetup && (
        <div className="sheet">
          <div className="sheet-card">
            <h2>Where is your library?</h2>
            <p className="sheet-sub">
              Pick the folder you copy videos into. Streamstein reads it directly — nothing is
              uploaded or moved.
            </p>

            {roots.length === 0 ? (
              <div className="diag">
                {diag && !diag.can_list_shared_storage ? (
                  <>
                    <h3>Streamstein can&apos;t read your files yet</h3>
                    <p className="sheet-sub">
                      Android blocks apps from reading shared storage until you grant it. Nothing
                      is wrong with your videos or where you put them.
                    </p>
                    <ol className="steps">
                      <li>
                        Open <strong>Settings &rarr; Apps &rarr; Streamstein</strong>
                      </li>
                      <li>
                        Tap <strong>Permissions</strong>, then allow{" "}
                        <strong>Files and media / Photos and videos</strong>
                      </li>
                      <li>
                        Still in Settings, open <strong>Special app access &rarr; All files
                        access</strong> and allow <strong>Streamstein</strong> (Android 11+ keeps
                        this switch there, not under Permissions)
                      </li>
                      <li>
                        Come back here and tap <strong>Rescan</strong>
                      </li>
                    </ol>
                  </>
                ) : (
                  <>
                    <h3>No videos found in the usual places</h3>
                    <p className="sheet-sub">
                      {diag && diag.roots.length > 0
                        ? "Streamstein can read those folders, but none hold a playable video file."
                        : "None of the standard media folders exist on this device yet."}{" "}
                      Copy some videos into <code>Movies</code> or <code>Download</code>, then
                      tap Rescan.
                    </p>
                  </>
                )}

                {diag && diag.roots.length > 0 && (
                  <div className="diag-list">
                    {diag.roots.slice(0, 6).map((r) => (
                      <div className="diag-row" key={r.path}>
                        <span className="root-path">{r.path}</span>
                        <span className="root-count">
                          {r.readable ? r.video_count + " videos" : "not readable"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <button className="ghost" onClick={reopen}>
                  Rescan
                </button>
              </div>
            ) : (
              <div className="root-list">
                {roots.map((r) => (
                  <button key={r.path} className="root" onClick={() => chooseRoot(r.path)}>
                    <span className="root-path">{r.path}</span>
                    <span className="root-count">{r.video_count} videos</span>
                  </button>
                ))}
              </div>
            )}

            {settings?.library_root && (
              <button className="ghost" onClick={() => setShowSetup(false)}>
                Keep using {settings.library_root}
              </button>
            )}
          </div>
        </div>
      )}

      {playing && (
        <div className="player">
          <video
            src={convertFileSrc(playing.path)}
            controls
            autoPlay
            playsInline
            onError={() =>
              setError(
                `This device's WebView can't decode ${playing.ext.toUpperCase()}. MP4 (H.264) plays everywhere; MKV/AVI support varies.`,
              )
            }
          />
          <div className="player-bar">
            <div className="player-title">{playing.title}</div>
            <button className="close" onClick={() => setPlaying(null)}>
              Close
            </button>
          </div>
          <div className="player-sub">
            {[playing.ext.toUpperCase(), fmtSize(playing.size_bytes), playing.dir]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      )}

      <div className="platform">{platform()}</div>
    </div>
  );
}
