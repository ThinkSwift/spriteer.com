// Web events — the `web` place of the funnel (founder.md §계측). Same names as the app's Usage events.
// The id is a random number per browser session: no cookie, no IP kept, nothing personal.
const SITE = "spriteer.com";
const ENDPOINT = "https://claude-proxy-web.ilbulyori.workers.dev/events";
const once = new Set();

function sid() {
  try {
    const k = "sw_sid";
    let v = sessionStorage.getItem(k);
    if (!v) { v = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2); sessionStorage.setItem(k, v); }
    return v;
  } catch { return "anon"; }
}

export function track(name, props = {}, { onlyOnce = false } = {}) {
  if (onlyOnce) { if (once.has(name)) return; once.add(name); }
  try {
    fetch(ENDPOINT, {
      method: "POST", keepalive: true,
      headers: { "content-type": "application/json", "x-device-id": sid() },
      body: JSON.stringify({
        meta: { app: SITE, build: "web", os: "web", locale: (navigator.language || "").slice(0, 8) },
        events: [{ name, ts: Date.now() / 1000, props: { site: SITE, path: location.pathname.slice(0, 64), ...props } }],
      }),
    }).catch(() => {});
  } catch {}
}

// App Store clicks anywhere on the page.
document.addEventListener("click", (e) => {
  const a = e.target?.closest?.('a[href*="apps.apple.com"]');
  if (!a) return;
  const m = a.href.match(/id(\d+)/), ct = a.href.match(/ct=([\w-]+)/);
  track("appstore_click", { app: m ? m[1] : "", ct: ct ? ct[1] : "" });
}, true);
