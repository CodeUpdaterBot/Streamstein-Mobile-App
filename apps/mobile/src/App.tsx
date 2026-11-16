import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke, isNative, platform } from "./platform/bridge";

/**
 * Streamstein mobile — a local content app.
 *
 * Two ways to find your videos, tried in this order:
 *
 *  1. MediaStore — Android's own media index, the one the Photos app uses. One runtime
 *     permission dialog, sees every video on the device, and plays through content:// URIs that
 *     need no filesystem access at all. This is the correct way on modern Android.
 *  2. A direct folder scan, for anything the media scanner has not indexed, and for desktop.
 *
 * Nothing is uploaded or moved. No streaming and no downloading: the desktop downloader needs
 * yt-dlp/ffmpeg, which do not exist on Android.
 */

type MediaVideo = {
  id: number;
  uri: string;
  name: string;
  duration_ms: number;
  size_bytes: number;
  date_added_s: number;
  path: string;
  folder: string;
};

type MediaAccess = { granted: boolean; permission: string; sdk: number };

type FolderVideo = {
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
  videos: FolderVideo[];
  total: number;
  truncated: boolean;
  unreadable: boolean;
};

type CandidateRoot = { path: string; video_count: number };
type Settings = { library_root: string | null };
type SortKey = "recent" | "title" | "largest";

type StorageDiagnosis = {
  can_list_shared_storage: boolean;
  roots: { path: string; exists: boolean; readable: boolean; video_count: number }[];
  candidate_count: number;
};

/** One shape for the UI, whichever source produced it. */
type LibraryItem = {
  key: string;
  title: string;
  /** What to hand the player: a content:// URI or an asset-protocol URL. */
  playSrc: string;
  folder: string;
  ext: string;
  size: number;
  modified: number | null;
  durationMs: number | null;
  transcript: string | null;
  comments: string | null;
  source: "mediastore" | "folder";
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

const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};

/** The folder above the file, from a path or a media folder name. */
const parentName = (folder: string) => {
  const parts = folder.split("/").filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
};

/**
 * A tile renders its video element only while near the viewport: Android's WebView exhausts
 * video decoders long before memory, so one live element per library entry freezes a real
 * library on device. Rendering on demand still yields a true thumbnail.
 */
function Tile({ item, onOpen }: { item: LibraryItem; onOpen: (v: LibraryItem) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [duration, setDuration] = useState<number | null>(
    item.durationMs ? item.durationMs / 1000 : null,
  );

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
    <div className="tile" ref={ref} onClick={() => onOpen(item)}>
      <div className="thumb">
        {visible ? (
          <video
            src={item.playSrc}
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
        <div className="title" title={item.title}>
          {item.title}
        </div>
        <div className="sub">
          {[fmtDate(item.modified), fmtSize(item.size)].filter(Boolean).join(" · ")}
        </div>
        <div className="marks">
          {item.ext && <span className="chip">{item.ext.toUpperCase()}</span>}
          {item.transcript && <span className="chip chip-on">Transcript</span>}
          {item.comments && <span className="chip chip-on">Comments</span>}
          {item.source === "mediastore" && parentName(item.folder) && (
            <span className="chip">{parentName(item.folder)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [source, setSource] = useState<"mediastore" | "folder" | null>(null);
  const [access, setAccess] = useState<MediaAccess | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [roots, setRoots] = useState<CandidateRoot[]>([]);
  const [diag, setDiag] = useState<StorageDiagnosis | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [playing, setPlaying] = useState<LibraryItem | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  /** MediaStore first. Returns null when it is unavailable or not permitted. */
  const loadFromMediaStore = useCallback(async (): Promise<LibraryItem[] | null> => {
    try {
      const a = await invoke<MediaAccess>("mediastore_access");
      setAccess(a);
      if (!a.granted) return null;
      const res = await invoke<{ videos: MediaVideo[] }>("mediastore_videos");
      return (res.videos ?? []).map<LibraryItem>((v) => ({
        key: `ms:${v.id}`,
        title: (v.name || "").replace(/\.[^.]+$/, "") || v.folder || "Untitled",
        playSrc: v.uri,
        folder: v.folder || parentName(v.path || ""),
        ext: extOf(v.name || ""),
        size: v.size_bytes || 0,
        modified: v.date_added_s ? v.date_added_s * 1000 : null,
        durationMs: v.duration_ms || null,
        transcript: null,
        comments: null,
        source: "mediastore",
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const loadFromFolder = useCallback(async (root: string): Promise<LibraryItem[]> => {
    const res = await invoke<ScanResult>("scan_videos", { root });
    setScan(res);
    return res.videos.map<LibraryItem>((v) => ({
      key: `f:${v.path}`,
      title: v.title,
      playSrc: convertFileSrc(v.path),
      folder: v.dir,
      ext: v.ext,
      size: v.size_bytes,
      modified: v.modified_ms,
      durationMs: null,
      transcript: v.transcript,
      comments: v.comments,
      source: "folder",
    }));
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const fromStore = await loadFromMediaStore();
      if (fromStore && fromStore.length > 0) {
        setItems(fromStore);
        setSource("mediastore");
        setShowSetup(false);
        return;
      }

      // Fall back to scanning folders directly.
      const s = await invoke<Settings>("get_settings");
      setSettings(s);
      if (s.library_root) {
        setItems(await loadFromFolder(s.library_root));
        setSource("folder");
        setShowSetup(false);
        return;
      }

      const cands = await invoke<CandidateRoot[]>("candidate_roots");
      setRoots(cands);
      if (cands.length === 0) {
        setDiag(await invoke<StorageDiagnosis>("storage_diagnosis"));
      }
      setItems([]);
      setSource(null);
      setShowSetup(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [loadFromFolder, loadFromMediaStore]);

  useEffect(() => {
    if (!isNative()) {
      setError("Run this inside the app — a browser cannot read local files.");
      return;
    }
    void refresh();
  }, [refresh]);

  /** Ask for the MediaStore permission, then poll: the OS answers asynchronously. */
  const grantAccess = useCallback(async () => {
    try {
      await invoke("mediastore_request_access");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const a = await invoke<MediaAccess>("mediastore_access");
        setAccess(a);
        if (a.granted) {
          await refresh();
          return;
        }
      } catch {
        /* keep polling */
      }
    }
    setError("Permission not granted yet. Android Settings → Apps → Streamstein → Permissions.");
  }, [refresh]);

  const chooseRoot = useCallback(
    async (root: string) => {
      try {
        const s = await invoke<Settings>("set_library_root", { root });
        setSettings(s);
        setShowSetup(false);
        setItems(await loadFromFolder(root));
        setSource("folder");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [loadFromFolder],
  );

  const visible = useMemo(() => {
    const list = items ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (v) => v.title.toLowerCase().includes(q) || v.folder.toLowerCase().includes(q),
        )
      : list;
    const sorted = [...filtered];
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "largest") sorted.sort((a, b) => b.size - a.size);
    return sorted;
  }, [items, query, sort]);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          Stream<span>stein</span>
        </div>
        {items && items.length > 0 && <div className="pill">{items.length} videos</div>}
        <button
          className="icon-btn"
          onClick={() => setShowSetup(true)}
          aria-label="Library source"
        >
          Gear
        </button>
      </header>

      {error && (
        <div className="notice">
          {error}
          <button onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {items && items.length > 0 && (
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
        {busy && items === null && <div className="empty">Loading your library…</div>}

        {items && items.length === 0 && !showSetup && (
          <div className="empty">
            <h2>Nothing to show yet</h2>
            <p>Open the gear to choose where your videos live.</p>
          </div>
        )}

        {items && items.length > 0 && visible.length === 0 && (
          <div className="empty">
            <h2>No matches</h2>
            <p>Nothing in your library matches that search.</p>
          </div>
        )}

        {visible.length > 0 && (
          <div className="grid">
            {visible.map((v) => (
              <Tile key={v.key} item={v} onOpen={setPlaying} />
            ))}
          </div>
        )}

        {scan?.truncated && (
          <div className="foot">
            Showing the first {scan.total} entries — that folder holds more.
          </div>
        )}
      </div>

      {showSetup && (
        <div className="sheet">
          <div className="sheet-card">
            <h2>Your video library</h2>

            {access && !access.granted ? (
              <>
                <p className="sheet-sub">
                  Streamstein can list every video on this device through Android&apos;s own media
                  index — the same one your Photos app uses. It needs a single permission.
                  Nothing is uploaded or moved.
                </p>
                <button className="primary" onClick={grantAccess}>
                  Allow access to my videos
                </button>
                <p className="sheet-hint">
                  No dialog? Enable it manually: Settings, then Apps, then Streamstein, then
                  Permissions, then Photos and videos.
                </p>
              </>
            ) : (
              <>
                <p className="sheet-sub">
                  Android&apos;s media index returned no videos, so pick a folder to scan
                  directly. Streamstein reads it in place.
                </p>

                {roots.length > 0 ? (
                  <div className="root-list">
                    {roots.map((r) => (
                      <button key={r.path} className="root" onClick={() => chooseRoot(r.path)}>
                        <span className="root-path">{r.path}</span>
                        <span className="root-count">{r.video_count} videos</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="diag">
                    <h3>Nothing indexed, and no folder held a video</h3>
                    <p className="sheet-sub">
                      Every folder checked is listed below with what it found, so this says where
                      your videos are not.
                    </p>
                    {diag && diag.roots.length > 0 && (
                      <div className="diag-list">
                        {diag.roots.map((r) => (
                          <div className="diag-row" key={r.path}>
                            <span className="root-path">{r.path}</span>
                            <span className="root-count">
                              {r.readable ? r.video_count + " videos" : "not readable"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button className="ghost" onClick={refresh}>
                  Scan again
                </button>
              </>
            )}

            {items && items.length > 0 && (
              <button className="ghost" onClick={() => setShowSetup(false)}>
                Back to library
              </button>
            )}
          </div>
        </div>
      )}

      {playing && (
        <div className="player">
          <video
            src={playing.playSrc}
            controls
            autoPlay
            playsInline
            onError={() =>
              setError(
                `This device cannot decode ${
                  playing.ext.toUpperCase() || "this file"
                }. MP4 (H.264) plays everywhere; MKV and AVI support varies.`,
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
            {[playing.ext.toUpperCase(), fmtSize(playing.size), playing.folder]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      )}

      <div className="platform">
        {platform()}
        {source ? ` · ${source}` : ""}
      </div>
    </div>
  );
}
