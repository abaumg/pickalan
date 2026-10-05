import { sb, $, esc, byNumber, rpc, toast, shareUrl, copyText } from './common.js';

// ---------- Codes erzeugen ----------
// Kindgerechte Wörter ohne Umlaute, damit sie leicht zu tippen sind.
const ANIMALS = ['Tiger', 'Pinguin', 'Elefant', 'Giraffe', 'Zebra', 'Affe', 'Panda', 'Koala', 'Delfin', 'Hai',
  'Wal', 'Krokodil', 'Frosch', 'Eule', 'Adler', 'Papagei', 'Igel', 'Hase', 'Fuchs', 'Wolf', 'Pferd', 'Esel',
  'Kamel', 'Lama', 'Schaf', 'Ziege', 'Kuh', 'Schwein', 'Katze', 'Hund', 'Maus', 'Biber', 'Otter', 'Robbe',
  'Qualle', 'Krake', 'Biene', 'Ameise', 'Schnecke', 'Raupe', 'Dino', 'Drache', 'Einhorn', 'Nashorn',
  'Flamingo', 'Storch', 'Rabe', 'Specht', 'Gecko', 'Kolibri', 'Hamster', 'Pony', 'Ente', 'Huhn'];
const THINGS = ['Apfel', 'Banane', 'Birne', 'Kirsche', 'Erdbeere', 'Melone', 'Zitrone', 'Kiwi', 'Mango', 'Pizza',
  'Nudel', 'Brezel', 'Keks', 'Kuchen', 'Waffel', 'Rakete', 'Ball', 'Stern', 'Mond', 'Sonne', 'Wolke', 'Blitz',
  'Schnee', 'Berg', 'Insel', 'Schiff', 'Zug', 'Auto', 'Roller', 'Trommel', 'Gitarre', 'Krone', 'Schatz', 'Pirat',
  'Ritter', 'Burg', 'Kerze', 'Schaukel', 'Rutsche', 'Muschel', 'Feder', 'Socke', 'Hut', 'Laterne', 'Anker',
  'Kaktus', 'Tulpe', 'Pilz', 'Nuss', 'Karotte', 'Tomate', 'Gurke', 'Popcorn', 'Kompass'];

function randomInt(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
function generateCode() {
  return `${ANIMALS[randomInt(ANIMALS.length)]} ${THINGS[randomInt(THINGS.length)]} ${10 + randomInt(90)}`;
}

// Mehrere Versuche, falls der Code zufällig schon vergeben ist
async function withUniqueCode(fn) {
  for (let i = 0; i < 5; i++) {
    const { error } = await fn(generateCode());
    if (!error) return;
    if (error.code !== '23505') throw error; // 23505 = unique_violation
  }
  throw new Error('Kein freier Code gefunden – bitte nochmal versuchen');
}

// ---------- Anmeldung ----------
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  if (!(await rpc('is_admin'))) {
    toast('Dieses Konto ist kein Admin.', true);
    await sb.auth.signOut();
    return showLogin();
  }
  $('#admin-login').classList.add('hidden');
  $('#admin-app').classList.remove('hidden');
  await Promise.all([loadCampaigns(), loadPlayers()]);
}

function showLogin() {
  $('#admin-app').classList.add('hidden');
  $('#admin-login').classList.remove('hidden');
}

$('#admin-login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: $('#email').value, password: $('#password').value });
  if (error) return toast('Anmeldung fehlgeschlagen: ' + error.message, true);
  init();
});

$('#admin-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

document.querySelectorAll('.tabs button').forEach(btn =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b === btn));
    $('#tab-campaigns').classList.toggle('hidden', btn.dataset.tab !== 'campaigns');
    $('#tab-players').classList.toggle('hidden', btn.dataset.tab !== 'players');
  }));

// Kleiner Helfer: Supabase-Fehler als Toast anzeigen
async function run(promise, okMsg) {
  const { data, error } = await promise;
  if (error) { toast(error.message, true); throw error; }
  if (okMsg) toast(okMsg);
  return data;
}

// ---------- Tauschaktionen ----------
let campaigns = [];
let editing = null; // aktuell bearbeitete Aktion

async function loadCampaigns() {
  campaigns = await run(sb.from('campaigns').select('id, name, active, created_at, stickers(count)').order('created_at', { ascending: false }));
  $('#campaign-rows').innerHTML = campaigns.map(c => `
    <tr data-id="${c.id}">
      <td>${esc(c.name)}</td>
      <td>${c.stickers[0]?.count ?? 0}</td>
      <td><input type="checkbox" data-act="active" ${c.active ? 'checked' : ''} aria-label="Aktiv"></td>
      <td class="row">
        <button class="small" data-act="edit">Sticker</button>
        <button class="small" data-act="rename">Umbenennen</button>
        <button class="small danger" data-act="delete">Löschen</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted">Noch keine Aktion angelegt.</td></tr>';
}

$('#campaign-form').addEventListener('submit', async e => {
  e.preventDefault();
  await run(sb.from('campaigns').insert({ name: $('#campaign-name').value.trim() }), 'Aktion angelegt');
  $('#campaign-name').value = '';
  loadCampaigns();
});

$('#campaign-rows').addEventListener('click', async e => {
  const act = e.target.dataset.act;
  const tr = e.target.closest('tr[data-id]');
  if (!act || !tr) return;
  const c = campaigns.find(x => x.id === Number(tr.dataset.id));

  if (act === 'active') {
    await run(sb.from('campaigns').update({ active: e.target.checked }).eq('id', c.id), e.target.checked ? 'Aktiviert' : 'Deaktiviert');
  } else if (act === 'rename') {
    const name = prompt('Neuer Name:', c.name)?.trim();
    if (!name) return;
    await run(sb.from('campaigns').update({ name }).eq('id', c.id), 'Umbenannt');
    loadCampaigns();
  } else if (act === 'delete') {
    if (!confirm(`Aktion „${c.name}“ mit allen Stickern und Sammlungen der Kinder löschen?`)) return;
    await run(sb.from('campaigns').delete().eq('id', c.id), 'Gelöscht');
    if (editing?.id === c.id) closeEditor();
    loadCampaigns();
  } else if (act === 'edit') {
    editing = c;
    $('#editor-title').textContent = c.name;
    $('#sticker-editor').classList.remove('hidden');
    await loadStickers();
    $('#sticker-editor').scrollIntoView({ behavior: 'smooth' });
  }
});

// ---------- Sticker ----------
let stickers = [];

async function loadStickers() {
  stickers = (await run(sb.from('stickers').select('id, number, name').eq('campaign_id', editing.id))).sort(byNumber);
  $('#sticker-rows').innerHTML = stickers.map(s => `
    <tr data-id="${s.id}">
      <td><b>${esc(s.number)}</b></td>
      <td>${esc(s.name)}</td>
      <td><button class="small danger" data-act="del">✕</button></td>
    </tr>`).join('') || '<tr><td colspan="3" class="muted">Noch keine Sticker.</td></tr>';
}

function parseImport(text) {
  const rows = new Map(); // Nummer -> Name (doppelte Nummern: letzte gewinnt)
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const range = line.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
      if (to - from > 2000) throw new Error('Bereich zu groß');
      for (let n = from; n <= to; n++) if (!rows.has(String(n))) rows.set(String(n), '');
      continue;
    }
    const m = line.match(/^([^\s;,\t]+)\s*[;,\t]?\s*(.*)$/);
    rows.set(m[1], m[2].trim());
  }
  return [...rows].map(([number, name]) => ({ campaign_id: editing.id, number, name }));
}

$('#import-btn').addEventListener('click', async () => {
  let rows;
  try { rows = parseImport($('#sticker-import').value); } catch (err) { return toast(err.message, true); }
  if (!rows.length) return toast('Keine Sticker eingegeben', true);
  await run(sb.from('stickers').upsert(rows, { onConflict: 'campaign_id,number' }), `${rows.length} Sticker übernommen`);
  $('#sticker-import').value = '';
  loadStickers();
  loadCampaigns();
});

$('#sticker-rows').addEventListener('click', async e => {
  if (e.target.dataset.act !== 'del') return;
  const s = stickers.find(x => x.id === Number(e.target.closest('tr').dataset.id));
  if (!confirm(`Sticker ${s.number} löschen?`)) return;
  await run(sb.from('stickers').delete().eq('id', s.id), 'Gelöscht');
  loadStickers();
  loadCampaigns();
});

function closeEditor() {
  editing = null;
  $('#sticker-editor').classList.add('hidden');
}
$('#editor-close').addEventListener('click', closeEditor);

// ---------- Benutzer ----------
let players = [];

function loginUrl(code) {
  return new URL(`index.html?code=${encodeURIComponent(code)}`, location.href).href;
}

async function loadPlayers() {
  players = await run(sb.from('players').select('id, display_name, login_code, share_token').order('display_name'));
  $('#player-count').textContent = `${players.length} Benutzer`;
  $('#player-rows').innerHTML = players.map(p => `
    <tr data-id="${p.id}">
      <td>${esc(p.display_name)}</td>
      <td class="code">${esc(p.login_code)}</td>
      <td class="row">
        <button class="small" data-act="login-link" title="Link, der direkt anmeldet">Login-Link</button>
        <button class="small" data-act="share-link">Doppelte-Link</button>
        <button class="small" data-act="newcode">Neuer Code</button>
        <button class="small danger" data-act="delete">Löschen</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="3" class="muted">Noch keine Benutzer.</td></tr>';

  $('#print-cards').innerHTML = players.map(p => `
    <div class="print-card">
      <div class="pc-name">🃏 Pickale-Tauschbörse – ${esc(p.display_name)}</div>
      <div class="pc-code">${esc(p.login_code)}</div>
      <div>${esc(new URL('index.html', location.href).href)}</div>
    </div>`).join('');
}

$('#player-form').addEventListener('submit', async e => {
  e.preventDefault();
  const display_name = $('#player-name').value.trim();
  try {
    await withUniqueCode(code => sb.from('players').insert({ display_name, login_code: code }));
    toast('Benutzer angelegt');
    $('#player-name').value = '';
    loadPlayers();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#player-rows').addEventListener('click', async e => {
  const act = e.target.dataset.act;
  const tr = e.target.closest('tr[data-id]');
  if (!act || !tr) return;
  const p = players.find(x => x.id === Number(tr.dataset.id));

  if (act === 'login-link') {
    copyText(loginUrl(p.login_code));
  } else if (act === 'share-link') {
    copyText(shareUrl(p.share_token));
  } else if (act === 'newcode') {
    if (!confirm(`Neuen Code für ${p.display_name} erzeugen? Der alte funktioniert dann nicht mehr.`)) return;
    try {
      await withUniqueCode(code => sb.from('players').update({ login_code: code }).eq('id', p.id));
      toast('Neuer Code erzeugt');
      loadPlayers();
    } catch (err) {
      toast(err.message, true);
    }
  } else if (act === 'delete') {
    if (!confirm(`${p.display_name} mit der ganzen Sammlung löschen?`)) return;
    await run(sb.from('players').delete().eq('id', p.id), 'Gelöscht');
    loadPlayers();
  }
});

$('#print-btn').addEventListener('click', () => window.print());

init();
