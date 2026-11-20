const $ = id => document.getElementById(id), api = window.api;
let S, V = [], viewer, skin = null, rig = [], inited = false;
const T = window.skinview3d.THREE || window.THREE, idx = () => +$('inst').value;
const NAMES = { horns: 'Toxic horns', halo: 'Halo', orbs: 'Orbs', wings: 'Wings', ears: 'Cat ears' };
const guard = async f => { try { return await f(); } catch (e) { alert(String(e.message).replace(/^Error invoking remote method '.*?': (Error: )?/, '')); } };
api.onLog(m => { const l = $('log'); l.textContent += m + '\n'; l.scrollTop = l.scrollHeight; });

async function init() {
  S = await api.invoke('state'); V = await api.invoke('versions'); renderInst(); acct();
}
function acct() { const a = S.account; $('acct').textContent = a ? a.name + (a.type === 'ms' ? ' · Microsoft' : ' · offline') : 'Not logged in'; $('acct').className = 'pill' + (a && a.type === 'ms' ? ' ms' : ''); }
function renderInst() { $('inst').innerHTML = S.instances.map((x, i) => `<option value="${i}">${x.name.replace(/</g, '&lt;')}</option>`).join(''); showInst(); }
function fillVer(k) { $('ver').innerHTML = V.filter(v => v.type === 'release' || $('snap').checked).map(v => `<option>${v.id}</option>`).join(''); if (k) $('ver').value = k; }
function showInst() { const x = S.instances[idx()]; fillVer(x.version); $('loader').value = x.loader; $('ram').value = x.ram; }
const persist = () => { const x = S.instances[idx()]; x.version = $('ver').value; x.loader = $('loader').value; x.ram = +$('ram').value; api.invoke('set-instances', S.instances); };
$('inst').onchange = showInst; $('snap').onchange = () => fillVer($('ver').value); ['ver', 'loader', 'ram'].forEach(k => $(k).onchange = persist);

document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button,section').forEach(e => e.classList.remove('on')); b.classList.add('on'); $(b.dataset.t).classList.add('on');
  if (b.dataset.t === 'mods') haveMods(); if (b.dataset.t === 'avatar') avatarTab();
});
const haveMods = () => guard(async () => { $('have').innerHTML = (await api.invoke('mods-list', idx())).map(f => `<div class="item">${f.replace(/</g, '&lt;')}</div>`).join('') || 'None yet'; });

const ACT = {
  ms: () => guard(async () => { await api.invoke('login-ms'); S = await api.invoke('state'); acct(); }),
  offline: () => guard(async () => { if ($('off').value) { await api.invoke('login-offline', $('off').value); S = await api.invoke('state'); acct(); } }),
  logout: async () => { await api.invoke('logout'); S = await api.invoke('state'); skin = null; acct(); },
  new: () => { const n = prompt('Instance name'); if (!n) return; S.instances.push({ name: n, version: '1.21.1', loader: 'fabric', ram: 4 }); guard(async () => { await api.invoke('set-instances', S.instances); renderInst(); $('inst').value = S.instances.length - 1; showInst(); }); },
  folder: () => api.invoke('open-folder', idx()),
  play: () => guard(() => api.invoke('launch', idx())),
  search: () => guard(async () => { const r = await api.invoke('mods-search', $('q').value, idx()); $('res').hidden = false;
    $('res').innerHTML = r.map(m => `<div class="item"><div>${esc(m.title)}<small>${esc(m.desc)}</small></div><button class="b" data-act="install" data-id="${esc(m.id)}">Install</button></div>`).join('') || 'No matches for this version and loader'; }),
  install: (b) => guard(async () => { b.textContent = '…'; await api.invoke('mod-install', b.dataset.id, idx()); b.textContent = 'Installed'; haveMods(); }),
  prism: () => guard(async () => { alert((await api.invoke('import-prism', idx())) + ' mods imported'); haveMods(); }),
  skin: () => guard(async () => { const s = await api.invoke('pick-skin'); if (s) { skin = s; viewer.loadSkin(skin, { model: $('model').value }); } }),
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && ACT[b.dataset.act]) ACT[b.dataset.act](b); });

// ---------- Avatar ----------
async function avatarTab() {
  const ms = S.account && S.account.type === 'ms'; $('lock').hidden = ms; $('studio').hidden = !ms; if (!ms) return;
  if (!inited) {
    inited = true; skin = await api.invoke('get-skin');
    viewer = new skinview3d.SkinViewer({ canvas: $('cv'), width: 320, height: 440 }); viewer.autoRotate = true; viewer.autoRotateSpeed = 0.6; viewer.zoom = 0.8;
    $('col').value = S.avatar.color; $('chips').innerHTML = Object.entries(NAMES).map(([k, n]) => `<button class="chip ${S.avatar.items.includes(k) ? 'on' : ''}" data-k="${k}">${n}</button>`).join('');
    $('chips').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; c.classList.toggle('on'); save(); build(); };
    $('col').oninput = () => { glow.set($('col').value); save(); };
    $('anim').onchange = anim; $('model').onchange = () => viewer.loadSkin(skin, { model: $('model').value });
    glow.set(S.avatar.color); viewer.loadSkin(skin, { model: 'default' }); anim(); build(); loop();
  }
}
const anim = () => { viewer.animation = new skinview3d[$('anim').value + 'Animation'](); };
const save = () => { S.avatar = { items: [...document.querySelectorAll('.chip.on')].map(c => c.dataset.k), color: $('col').value }; api.invoke('set-avatar', S.avatar); };
const glow = new T.Color('#b6ff3c'), violet = new T.Color('#c04bf0');
const M = () => new T.MeshBasicMaterial({ color: glow.clone() });
function cone(r, h, x, y, rz, mats) { const m = new T.Mesh(new T.ConeGeometry(r, h, 10), M()); m.position.set(x, y, 0); m.rotation.z = rz; mats.push(m.material); return m; }
const BUILD = {
  horns(p) { const g = new T.Group(), mats = [];
    for (const s of [-1, 1]) { const h = new T.Group(); h.position.set(s * 2.6, 4, 0); for (let i = 0; i < 3; i++) h.add(cone(1.2 - i * .3, 2.4, s * i * .55, i * 1.7 + 1, -s * (.2 + i * .28), mats)); g.add(h); }
    p.head.add(g); return { g, p: p.head, up: t => { g.children.forEach((h, k) => h.rotation.z = Math.sin(t * 2 + k) * .06); mats.forEach((m, i) => m.color.copy(glow).lerp(violet, .5 + .5 * Math.sin(t * 3 + i))); } }; },
  ears(p) { const g = new T.Group(), mats = []; for (const s of [-1, 1]) g.add(cone(1.5, 3, s * 2.8, 5.4, -s * .25, mats)); p.head.add(g); return { g, p: p.head, up: t => g.children.forEach((e, k) => e.rotation.z = (k ? .25 : -.25) + Math.sin(t * 5 + k) * .04) }; },
  halo(p) { const g = new T.Group(), m = new T.Mesh(new T.TorusGeometry(3.6, .3, 8, 32), M()); m.rotation.x = Math.PI / 2; g.add(m); g.position.y = 7; p.head.add(g); return { g, p: p.head, up: t => { g.position.y = 7 + Math.sin(t * 2) * .4; m.rotation.z = t; m.material.color.copy(glow); } }; },
  orbs(p) { const g = new T.Group(); for (let i = 0; i < 4; i++) g.add(new T.Mesh(new T.SphereGeometry(.9, 12, 12), M())); p.root.add(g); return { g, p: p.root, up: t => g.children.forEach((o, i) => { const a = t * 1.6 + i * Math.PI / 2; o.position.set(Math.cos(a) * 12, 4 + Math.sin(t * 2 + i) * 4, Math.sin(a) * 12); o.material.color.copy(glow).lerp(violet, .5 + .5 * Math.sin(t + i)); }) }; },
  wings(p) { const g = new T.Group(); for (const s of [-1, 1]) { const w = new T.Group(); w.position.set(s * 1.5, 3, -2.6); const m = new T.Mesh(new T.BoxGeometry(8, .5, 12), M()); m.position.set(s * 4, 0, -3); w.add(m); g.add(w); } p.body.add(g);
    return { g, p: p.body, up: t => g.children.forEach((w, k) => { w.rotation.y = (k ? -1 : 1) * (.5 + Math.sin(t * 4) * .35); w.children[0].material.color.copy(glow).lerp(violet, .5 + .5 * Math.sin(t)); }) }; },
};
function build() {
  rig.forEach(r => r.p.remove(r.g)); rig = []; const sk = viewer.playerObject.skin, parts = { head: sk.head, body: sk.body, root: viewer.playerObject };
  document.querySelectorAll('.chip.on').forEach(c => rig.push(BUILD[c.dataset.k](parts)));
}
function loop() { const t = performance.now() / 1000; rig.forEach(r => r.up(t)); requestAnimationFrame(loop); }
init();
