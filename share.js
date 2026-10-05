import { $, esc, rpc, store, dupBlocksHtml } from './common.js';

const token = new URLSearchParams(location.search).get('t');
let data = null;
let missingByMe = null; // Set der sticker_ids, die der angemeldete Betrachter noch braucht
let onlyNeeded = false;

async function load() {
  if (!token) return ($('#info').textContent = 'Ungültiger Link.');
  try {
    data = await rpc('shared_duplicates', { p_token: token });
  } catch {
    data = null;
  }
  if (!data) return ($('#info').textContent = 'Diesen Link gibt es nicht (mehr).');

  document.title = `Doppelte von ${data.display_name}`;
  $('#title').textContent = `Doppelte von ${data.display_name}`;

  // Ist der Betrachter selbst angemeldet (und nicht der Besitzer)? Dann markieren wir, was ihm fehlt.
  const myCode = store.get('pickale_code');
  if (myCode && store.get('pickale_token') !== token) {
    try {
      missingByMe = new Set();
      for (const c of data.campaigns) {
        const mine = await rpc('my_stickers', { p_code: myCode, p_campaign_id: c.id });
        mine.filter(s => s.qty === 0).forEach(s => missingByMe.add(s.sticker_id));
      }
      $('#need-filter').classList.remove('hidden');
    } catch {
      missingByMe = null;
    }
  }
  render();
}

function render() {
  const total = data.campaigns.reduce((n, c) => n + c.stickers.reduce((m, s) => m + s.extra, 0), 0);
  $('#info').textContent = total
    ? `${total} Sticker zum Tauschen.` + (missingByMe ? ' Grün = fehlt dir noch!' : '')
    : 'Zurzeit keine Doppelten.';

  $('#content').innerHTML = data.campaigns
    .filter(c => c.stickers.length)
    .map(c => {
      const list = c.stickers.filter(s => !onlyNeeded || missingByMe?.has(s.sticker_id));
      return `<h2>${esc(c.name)}</h2>` + (list.length
        ? `<div class="dup-blocks">${dupBlocksHtml(list, missingByMe)}</div>`
        : '<p class="muted">Nichts dabei, was dir fehlt.</p>');
    })
    .join('');
}

$('#need-filter').addEventListener('click', e => {
  const v = e.target.closest('[data-need]')?.dataset.need;
  if (!v) return;
  onlyNeeded = v === 'need';
  document.querySelectorAll('#need-filter button').forEach(b => b.classList.toggle('active', b.dataset.need === v));
  render();
});

load();
