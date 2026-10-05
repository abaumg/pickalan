import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

export const $ = (sel, el = document) => el.querySelector(sel);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Natürliche Sortierung: 2 vor 10, "A1" vor "A2"
export const byNumber = (a, b) => String(a.number).localeCompare(String(b.number), 'de', { numeric: true });

export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

// localStorage kann in privaten Fenstern fehlen – deshalb abgesichert
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* egal */ } },
};

let toastTimer;
export function toast(msg, isError = false) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2500);
}

export function shareUrl(token) {
  return new URL(`share.html?t=${token}`, location.href).href;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Kopiert!');
  } catch {
    window.prompt('Zum Kopieren:', text);
  }
}

// Doppelte als Liste, gruppiert in 10er-Blöcken (1–10, 11–20, ...).
// items: [{ number, name, extra }], need: optional Set von sticker_ids, die dem Betrachter fehlen
export function dupBlocksHtml(items, need = null) {
  const blocks = new Map();
  for (const s of [...items].sort(byNumber)) {
    const n = parseInt(s.number, 10);
    const key = Number.isFinite(n) && n > 0 ? Math.floor((n - 1) / 10) : -1;
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(s);
  }
  return [...blocks]
    .sort(([a], [b]) => (a === -1) - (b === -1) || a - b)
    .map(([key, list]) => {
      const title = key === -1 ? 'Sonstige' : `${key * 10 + 1}–${key * 10 + 10}`;
      const sum = list.reduce((n, s) => n + s.extra, 0);
      const rows = list.map(s => {
        const needed = need?.has(s.sticker_id);
        return `<li${needed ? ' class="need"' : ''}>
          <span class="num">${esc(s.number)}</span>
          <span class="name">${esc(s.name)}${needed ? '<span class="need-tag">fehlt dir</span>' : ''}</span>
          <span class="qty">${s.extra}×</span>
        </li>`;
      }).join('');
      return `<section class="dup-block"><h3>${title}<span>${sum} Stk.</span></h3><ul>${rows}</ul></section>`;
    })
    .join('');
}
