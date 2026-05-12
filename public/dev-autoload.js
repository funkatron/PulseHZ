/**
 * Dev-only: `?autoload=` query and loopback startup demo clips.
 * @module dev-autoload
 */

/** How many layers to fill from `manifest.json` on loopback when `autoload` is omitted. */
export const DEV_STARTUP_DEMO_LAYERS = 3;

/**
 * Base URL for resolving dev autoload paths (`demo-clips/...`) so it works when the
 * page is `/app` (no trailing slash) — relative URLs must not drop the `/app/` prefix.
 * @returns {URL}
 */
export function devAutoloadAppDirectoryBase() {
  const u = new URL(window.location.href);
  let path = u.pathname;
  if (!path.endsWith("/")) {
    const parts = path.split("/").filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : "";
    if (last && last.includes(".")) {
      parts.pop();
    }
    path = `/${parts.join("/")}`;
    if (path !== "/") {
      path = `${path}/`;
    }
  }
  u.pathname = path || "/";
  return u;
}

/**
 * Safe filename for a demo WebM (manifest entries and demo-clips/ children).
 * @param {string} name
 */
export function assertSafeDemoWebmFilename(name) {
  if (typeof name !== "string" || !name || name.length > 200) {
    throw new Error("invalid clip filename");
  }
  if (name !== name.trim() || name.includes("/") || name.includes("\\")) {
    throw new Error("invalid clip filename");
  }
  if (!/^[\w.-]+\.webm$/.test(name)) {
    throw new Error("invalid clip filename");
  }
}

/**
 * Resolve a dev-only autoload path to a same-origin URL + safe filename.
 * @param {string} rawPath
 * @returns {{ url: URL, filename: string }}
 */
export function resolveAutoloadWebmPath(rawPath) {
  const trimmed = rawPath.trim();
  if (!trimmed.endsWith(".webm")) {
    throw new Error("autoload path must end with .webm");
  }
  if (trimmed.includes("://") || trimmed.startsWith("//")) {
    throw new Error("autoload path must be relative (no URL scheme)");
  }
  const forward = trimmed.replace(/\\/g, "/");
  if (forward.includes("../") || forward.split("/").includes("..")) {
    throw new Error("path traversal is not allowed");
  }
  let decoded;
  try {
    decoded = decodeURIComponent(forward);
  } catch {
    throw new Error("invalid path encoding");
  }
  if (decoded.includes("../") || decoded.split("/").includes("..")) {
    throw new Error("path traversal is not allowed");
  }
  const url = new URL(decoded, devAutoloadAppDirectoryBase());
  if (url.origin !== window.location.origin) {
    throw new Error("cross-origin autoload is not allowed");
  }
  if (url.pathname.includes("/../") || url.pathname.includes("/..")) {
    throw new Error("invalid path");
  }

  const p = url.pathname;
  const demo = /\/demo-clips\/([^/]+)$/.exec(p);
  if (demo) {
    assertSafeDemoWebmFilename(demo[1]);
    return { url, filename: demo[1] };
  }
  if (/\/fixture-debug\.webm$/.test(p)) {
    return { url, filename: "fixture-debug.webm" };
  }
  throw new Error("autoload path must be demo-clips/<name>.webm or fixture-debug.webm");
}

/** Same-origin `demo-clips/manifest.json` clip list (throws if missing or empty). */
export async function fetchDemoClipsManifestEntries() {
  const manifestUrl = new URL("demo-clips/manifest.json", devAutoloadAppDirectoryBase());
  const manRes = await fetch(manifestUrl);
  if (!manRes.ok) {
    throw new Error(
      `No ${manifestUrl.pathname} (${manRes.status}). Run: bash scripts/generate-demo-clips.sh`,
    );
  }
  const manifest = await manRes.json();
  const clips = Array.isArray(manifest) ? manifest : manifest.clips;
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error("demo-clips/manifest.json has no clips");
  }
  return clips;
}

/** True when the app is served over http(s) on a loopback host (dev server only). */
export function isPulseHzLoopbackDevHost() {
  if (window.location.protocol === "file:") {
    return false;
  }
  const h = window.location.hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

/**
 * @param {object} api
 * @param {(url: URL, filename: string, layerId: number, batch?: boolean, demoRelPath?: string) => Promise<void>} api.loadClipFromResolvedUrl
 * @param {(msg: string, opts?: { error?: boolean }) => void} api.setStatus
 * @param {() => boolean} api.tryConsumeDefaultDevAutoloadSkip — if true once, skip startup demo and clear flag
 */
export async function maybeDevAutoload(api) {
  const { loadClipFromResolvedUrl, setStatus, tryConsumeDefaultDevAutoloadSkip } = api;
  const q = new URLSearchParams(window.location.search);
  const raw = q.get("autoload");

  if (raw !== null) {
    const trimmed = raw.trim();
    const kw = trimmed.toLowerCase();
    if (kw === "off" || kw === "none") {
      return;
    }
    if (trimmed === "") {
      return;
    }

    try {
      if (trimmed.endsWith(".webm")) {
        const path = trimmed.replace(/^\//, "");
        const { url, filename } = resolveAutoloadWebmPath(path);
        await loadClipFromResolvedUrl(url, filename, 1, false, path);
        return;
      }

      if (kw === "fixture") {
        const rel = "fixture-debug.webm";
        const { url, filename } = resolveAutoloadWebmPath(rel);
        await loadClipFromResolvedUrl(url, filename, 1, false, rel);
        return;
      }

      const clips = await fetchDemoClipsManifestEntries();

      if (kw === "1" || kw === "first") {
        assertSafeDemoWebmFilename(clips[0]);
        const rel = `demo-clips/${clips[0]}`;
        const { url, filename } = resolveAutoloadWebmPath(rel);
        await loadClipFromResolvedUrl(url, filename, 1, false, rel);
        return;
      }
      if (kw === "random") {
        const pick = clips[Math.floor(Math.random() * clips.length)];
        assertSafeDemoWebmFilename(pick);
        const rel = `demo-clips/${pick}`;
        const { url, filename } = resolveAutoloadWebmPath(rel);
        await loadClipFromResolvedUrl(url, filename, 1, false, rel);
        return;
      }
      if (kw === "all") {
        const n = Math.min(4, clips.length);
        for (let i = 0; i < n; i++) {
          assertSafeDemoWebmFilename(clips[i]);
          const rel = `demo-clips/${clips[i]}`;
          const { url, filename } = resolveAutoloadWebmPath(rel);
          await loadClipFromResolvedUrl(url, filename, i + 1, true, rel);
        }
        setStatus(`Dev autoload: loaded ${n} demo clips into layers 1–${n}.`);
        return;
      }

      setStatus(
        `Unknown autoload=${trimmed}. Use: 1, first, random, all, fixture, off, none, or a path ending in .webm`,
        { error: true },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Dev autoload failed: ${msg}`, { error: true });
    }
    return;
  }

  if (!isPulseHzLoopbackDevHost()) {
    return;
  }

  if (tryConsumeDefaultDevAutoloadSkip()) {
    return;
  }

  try {
    const clips = await fetchDemoClipsManifestEntries();
    const n = Math.min(DEV_STARTUP_DEMO_LAYERS, clips.length);
    for (let i = 0; i < n; i++) {
      assertSafeDemoWebmFilename(clips[i]);
      const rel = `demo-clips/${clips[i]}`;
      const { url, filename } = resolveAutoloadWebmPath(rel);
      await loadClipFromResolvedUrl(url, filename, i + 1, true, rel);
    }
    setStatus(
      n === 1
        ? "Dev startup: loaded 1 demo clip into layer 1 (loopback). Use ?autoload=off to skip."
        : `Dev startup: loaded ${n} demo clips into layers 1–${n} (loopback). Use ?autoload=off to skip.`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(`Dev startup skipped: ${msg}`, { error: true });
  }
}
