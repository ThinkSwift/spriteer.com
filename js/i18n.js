// Web copy in the apps' 19 UI locales (founder.md §로케일: UI 19). Same file on spriteer.com and pythoneer.io/night.
// The language comes from ?lang=, the home page's pick, or the browser; anything else falls back to English.
import { STRINGS } from "./strings.js";

const SUPPORTED = Object.keys(STRINGS);

function pick() {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q && SUPPORTED.includes(q)) return q;
    // The language picked on the site's home page (pythoneer.io keeps it as site_lang; "pt" there is pt-BR here).
    const saved = localStorage.getItem("site_lang");
    const mapped = saved === "pt" ? "pt-BR" : saved;
    if (mapped && SUPPORTED.includes(mapped)) return mapped;
  } catch {}
  for (const raw of navigator.languages || [navigator.language || "en"]) {
    const l = String(raw).toLowerCase();
    if (l.startsWith("zh")) return /hant|tw|hk|mo/.test(l) ? "zh-Hant" : "zh-Hans";
    if (l.startsWith("pt")) return "pt-BR";
    const hit = SUPPORTED.find((s) => s.toLowerCase() === l.split("-")[0]);
    if (hit) return hit;
  }
  return "en";
}

export const LANG = pick();
const table = STRINGS[LANG] || STRINGS.en;
const plural = (() => { try { return new Intl.PluralRules(LANG); } catch { return { select: () => "other" }; } })();

/** A string by key, `{name}` placeholders filled from `vars`. */
export function t(key, vars = {}) {
  const s = table[key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}
/** A plural string: `key_one`, `key_few`, … by the language's rules, falling back to `key_other`. */
export function tn(key, n, vars = {}) {
  const cat = plural.select(n);
  const k = table[`${key}_${cat}`] !== undefined ? `${key}_${cat}` : `${key}_other`;
  return t(k, { n, ...vars });
}

/** Fills `data-i18n` (text), `data-i18n-html` (our own markup), `data-i18n-aria` (labels) and the title. */
export function applyI18n(titleKey) {
  const root = document.documentElement;
  root.lang = LANG;
  if (LANG === "ar") root.dir = "rtl";
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  if (titleKey) document.title = t(titleKey);
}
