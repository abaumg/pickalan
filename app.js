import { $, esc, byNumber, rpc, store, toast, shareUrl, copyText, dupBlocksHtml } from './common.js';

const state = {
  code: null,
  me: null,            // { display_name, share_token }
  campaigns: [],
  campaignId: null,
  stickers: [],        // { sticker_id, number, name, qty }
  filter: 'all',
  search: '',
};
const saveQueue = new Map(); // sticker_id -> Promise (Speichern pro Sticker der Reihe nach)

// ---------- Anmeldung ----------
async function tryLogin(code) {
  state.me = await rpc('player_login', { p_code: code });
  state.code = code;
  store.set('pickale_code', code);
  store.set('pickale_token', state.me.share_token);
}

const isUnknownCode = err => /Unbekannter Code/.test(err?.message ?? '');

function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#code').focus();
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  try {
    await tryLogin($('#code').value);
    await startApp();
  } catch (err) {
    toast(isUnknownCode(err) ? 'Diesen Code kenne ich nicht 🤔' : 'Fehler: ' + err.message, true);
  } finally {
    btn.disabled = false;
  }
});

$('#logout-btn').addEventListener('click', () => {
  store.del('pickale_code');
  store.del('pickale_token');
  location.reload();
});

// ---------- Name ändern ----------
$('#rename-btn').addEventListener('click', () => {
  $('#rename-input').value = state.me.display_name;
  $('#rename-dialog').showModal();
});

$('#rename-dialog').addEventListener('close', async () => {
  if ($('#rename-dialog').returnValue !== 'ok') return;
  const name = $('#rename-input').value.trim();
  if (!name || name === state.me.display_name) return;
  try {
    await rpc('set_display_name', { p_code: state.code, p_name: name });
    state.me.display_name = name;
    $('#my-name').textContent = name;
    toast('Name gespeichert');
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- App ----------
async function startApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#my-name').textContent = state.me.display_name;

  state.campaigns = await rpc('list_campaigns');
  const noCampaign = state.campaigns.length === 0;
  $('#no-campaign').classList.toggle('hidden', !noCampaign);
  $('#campaign-area').classList.toggle('hidden', noCampaign);
  if (noCampaign) return;

  const sel = $('#campaign-select');
  sel.innerHTML = state.campaigns.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  sel.classList.toggle('hidden', state.campaigns.length < 2);
  const remembered = Number(store.get('pickale_campaign'));
  state.campaignId = state.campaigns.some(c => c.id === remembered) ? remembered : state.campaigns[0].id;
  sel.value = state.campaignId;
  await loadStickers();
}

$('#campaign-select').addEventListener('change', async e => {
  state.campaignId = Number(e.target.value);
  store.set('pickale_campaign', state.campaignId);
  await loadStickers();
});

async function loadStickers() {
  const data = await rpc('my_stickers', { p_code: state.code, p_campaign_id: state.campaignId });
  state.stickers = data.sort(byNumber);
  renderGrid();
  renderDups();
}

// ---------- Tabs & Filter ----------
document.querySelectorAll('.tabs button').forEach(btn =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b === btn));
    $('#tab-collection').classList.toggle('hidden', btn.dataset.tab !== 'collection');
    $('#tab-dups').classList.toggle('hidden', btn.dataset.tab !== 'dups');
    if (btn.dataset.tab === 'dups') renderDups();
    else renderGrid();
  }));

$('#filters').addEventListener('click', e => {
  const f = e.target.closest('[data-filter]')?.dataset.filter;
  if (!f) return;
  state.filter = f;
  document.querySelectorAll('#filters [data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
  renderGrid();
});

$('#search').addEventListener('input', e => {
  state.search = e.target.value.trim().toLowerCase();
  renderGrid();
});

// ---------- Sammlung ----------
function cardHtml(s) {
  const cls = ['card', s.qty > 0 ? 'have' : 'missing', s.qty > 1 ? 'dup' : ''].join(' ');
  return `<div class="${cls}" data-id="${s.sticker_id}">
    <button class="main" data-act="toggle"><span class="num">${esc(s.number)}</span><span class="name">${esc(s.name)}</span></button>
    ${s.qty > 1 ? `<span class="dup-badge" title="${s.qty - 1} doppelt">+${s.qty - 1}</span>` : ''}
    <div class="dupctl">
      <button data-act="plus" aria-label="Ein Doppelter mehr">+</button>
      <button data-act="minus" aria-label="Ein Doppelter weniger" ${s.qty <= 1 ? 'disabled' : ''}>−</button>
    </div>
  </div>`;
}

function visible(s) {
  if (state.filter === 'missing' && s.qty > 0) return false;
  if (state.filter === 'have' && s.qty === 0) return false;
  if (state.filter === 'dup' && s.qty < 2) return false;
  if (state.search && !`${s.number} ${s.name}`.toLowerCase().includes(state.search)) return false;
  return true;
}

function renderGrid() {
  const list = state.stickers.filter(visible);
  $('#grid').innerHTML = list.length ? list.map(cardHtml).join('') : '<p class="muted">Keine Sticker gefunden.</p>';
  renderProgress();
}

function renderProgress() {
  const total = state.stickers.length;
  const have = state.stickers.filter(s => s.qty > 0).length;
  const dups = state.stickers.reduce((n, s) => n + Math.max(0, s.qty - 1), 0);
  $('#progress-bar').style.width = total ? `${(100 * have) / total}%` : '0';
  $('#progress-text').textContent = `${have} von ${total} eingeklebt · ${total - have} fehlen · ${dups} Doppelte`;
  const counts = { all: total, missing: total - have, have, dup: state.stickers.filter(s => s.qty > 1).length };
  document.querySelectorAll('#filters [data-count]').forEach(el => (el.textContent = counts[el.dataset.count]));
}

$('#grid').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = Number(btn.closest('.card').dataset.id);
  const s = state.stickers.find(x => x.sticker_id === id);
  const act = btn.dataset.act;
  if (act === 'toggle') {
    if (s.qty > 1 && !confirm(`Nr. ${s.number} wirklich als fehlend markieren? Deine ${s.qty - 1} Doppelten werden auch gelöscht.`)) return;
    setQty(s, s.qty > 0 ? 0 : 1);
  } else if (act === 'plus') {
    setQty(s, Math.min(99, s.qty + 1));
  } else if (act === 'minus') {
    setQty(s, Math.max(1, s.qty - 1));
  }
});

function setQty(s, qty) {
  const old = s.qty;
  if (qty === old) return;
  s.qty = qty;
  updateCard(s);

  const prev = saveQueue.get(s.sticker_id) ?? Promise.resolve();
  const next = prev
    .then(() => rpc('set_sticker_qty', { p_code: state.code, p_sticker_id: s.sticker_id, p_qty: qty }))
    .catch(err => {
      if (s.qty === qty) { s.qty = old; updateCard(s); }
      toast('Speichern hat nicht geklappt: ' + err.message, true);
    });
  saveQueue.set(s.sticker_id, next);
}

function updateCard(s) {
  const el = $(`#grid .card[data-id="${s.sticker_id}"]`);
  if (el) el.outerHTML = cardHtml(s);
  renderProgress();
}

// ---------- Doppelte ----------
function dupList() {
  return state.stickers.filter(s => s.qty > 1);
}

function renderDups() {
  const list = dupList();
  const total = list.reduce((n, s) => n + s.qty - 1, 0);
  $('#dups-summary').textContent = list.length
    ? `${total} Doppelte von ${list.length} verschiedenen Stickern`
    : 'Du hast noch keine Doppelten. Zähle sie in der Sammlung mit +.';
  $('#dups-list').innerHTML = dupBlocksHtml(list.map(s => ({ ...s, extra: s.qty - 1 })));
}

$('#copy-list-btn').addEventListener('click', () => {
  const campaign = state.campaigns.find(c => c.id === state.campaignId)?.name ?? '';
  const items = dupList().map(s => (s.qty > 2 ? `${s.number} (${s.qty - 1}×)` : s.number));
  copyText(`Meine Doppelten – ${campaign}: ${items.join(', ') || 'keine'}`);
});

$('#share-btn').addEventListener('click', async () => {
  const url = shareUrl(state.me.share_token);
  if (navigator.share) {
    try { await navigator.share({ title: `Doppelte von ${state.me.display_name}`, url }); return; } catch { /* abgebrochen */ }
  }
  copyText(url);
});

// ---------- Start ----------
(async () => {
  // Login-Link: index.html?code=Tiger-Banane-27
  const params = new URLSearchParams(location.search);
  const code = params.get('code') || store.get('pickale_code');
  if (params.has('code')) history.replaceState(null, '', location.pathname);
  if (!code) return showLogin();
  try {
    await tryLogin(code);
    await startApp();
  } catch (err) {
    if (isUnknownCode(err)) store.del('pickale_code');
    else toast('Fehler: ' + err.message, true);
    showLogin();
  }
})();
