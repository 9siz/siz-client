const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, session } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const RPC = require('discord-rpc');

const DISCORD_CLIENT_ID = 'YOUR_DISCORD_APP_ID'; // discord.com/developers -> New Application; upload icon.png as art asset "siz"
const data = app.getPath('userData'), root = path.join(data, 'minecraft'), cfgFile = path.join(data, 'config.json');
let cfg = { instances: [{ name: 'Main', version: '1.21.1', loader: 'vanilla', ram: 4 }], skin: null, avatar: { items: ['horns'], color: '#b6ff3c' } };
let account = null; // tokens live ONLY in this process; never sent to the renderer
try {
  const raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  const enc = raw.accountEnc; delete raw.accountEnc; cfg = { ...cfg, ...raw };
  if (enc && safeStorage.isEncryptionAvailable()) account = JSON.parse(safeStorage.decryptString(Buffer.from(enc, 'base64')));
} catch {}
const save = () => {
  const out = { ...cfg };
  if (account && safeStorage.isEncryptionAvailable()) out.accountEnc = safeStorage.encryptString(JSON.stringify(account)).toString('base64'); // OS keychain; no keychain = not persisted
  fs.writeFileSync(cfgFile, JSON.stringify(out, null, 1), { mode: 0o600 });
};
const safeName = (s) => { if (!/^[\w -]{1,32}$/.test(s)) throw new Error('Bad name'); return s; };
const instDir = (i) => path.join(data, 'instances', safeName(i.name).replace(/ /g, '_'));
const modsDir = (i) => { const d = path.join(instDir(i), 'mods'); fs.mkdirSync(d, { recursive: true }); return d; };
const J = async (u) => { const r = await fetch(u, { headers: { 'User-Agent': 'siz-client/0.2' } }); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
let win; const log = (m) => win && win.webContents.send('log', String(m));
const H = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!win || e.sender !== win.webContents || !e.senderFrame.url.startsWith('file://')) throw new Error('blocked'); return fn(...a); });
const inst = (i) => { const x = cfg.instances[i]; if (!x) throw new Error('No instance'); return x; };

// Discord Rich Presence
let rpc, since = Date.now();
const presence = (a) => rpc && rpc.setActivity({ largeImageKey: 'siz', largeImageText: 'Siz Client', startTimestamp: since, ...a }).catch(() => {});
if (/^\d{17,20}$/.test(DISCORD_CLIENT_ID)) {
  rpc = new RPC.Client({ transport: 'ipc' });
  rpc.on('ready', () => presence({ details: 'In the launcher', state: 'Picking a vibe' }));
  rpc.login({ clientId: DISCORD_CLIENT_ID }).catch(() => { rpc = null; });
}

async function ensureFabric(mc) {
  const ls = await J(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`);
  if (!ls.length) throw new Error('Fabric does not support ' + mc);
  const p = await J(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}/${ls[0].loader.version}/profile/json`);
  const d = path.join(root, 'versions', p.id); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, p.id + '.json'), JSON.stringify(p)); return p.id;
}

H('state', () => ({ instances: cfg.instances, avatar: cfg.avatar, account: account && { name: account.name, type: account.type } }));
H('set-instances', (l) => { cfg.instances = l.slice(0, 50).map(x => ({ name: safeName(x.name), version: String(x.version), loader: x.loader === 'fabric' ? 'fabric' : 'vanilla', ram: Math.min(32, Math.max(1, +x.ram || 4)) })); save(); });
H('versions', async () => (await J('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).versions.map(v => ({ id: v.id, type: v.type })));
H('login-ms', async () => { const mc = await (await new Auth('select_account').launch('electron')).getMinecraft(); account = { type: 'ms', name: mc.profile.name, auth: mc.mclc() }; save(); return account.name; });
H('login-offline', (n) => { safeName(n); account = { type: 'offline', name: n, auth: { access_token: 'offline', client_token: 'offline', uuid: crypto.createHash('md5').update('OfflinePlayer:' + n).digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'), name: n, user_properties: '{}', meta: { type: 'mojang', demo: false } } }; save(); return n; });
H('logout', () => { account = null; cfg.skin = null; save(); });
H('launch', async (idx) => {
  const i = inst(idx); if (!account) throw new Error('Log in first');
  const version = { number: i.version, type: 'release' };
  if (i.loader === 'fabric') { log('Preparing Fabric…'); version.custom = await ensureFabric(i.version); }
  const l = new Client();
  l.on('debug', log); l.on('data', log); l.on('progress', p => log(`Downloading ${p.type} ${p.task}/${p.total}`));
  l.on('close', c => { log('Game closed (' + c + ')'); presence({ details: 'In the launcher', state: 'Picking a vibe' }); });
  presence({ details: 'Playing Minecraft ' + i.version, state: i.loader === 'fabric' ? 'Fabric · ' + i.name : 'Vanilla · ' + i.name });
  modsDir(i);
  await l.launch({ authorization: account.auth, root, version, memory: { max: i.ram + 'G', min: '1G' }, overrides: { gameDirectory: instDir(i) } });
});
H('mods-list', (i) => fs.readdirSync(modsDir(inst(i))).filter(f => f.endsWith('.jar')));
H('mods-search', async (q, idx) => { const i = inst(idx); const f = [['project_type:mod'], ['versions:' + i.version]]; if (i.loader !== 'vanilla') f.push(['categories:' + i.loader]);
  return (await J(`https://api.modrinth.com/v2/search?limit=20&query=${encodeURIComponent(q)}&facets=${encodeURIComponent(JSON.stringify(f))}`)).hits.map(h => ({ id: h.project_id, title: h.title, desc: h.description })); });
H('mod-install', async (id, idx) => {
  const i = inst(idx); if (!/^[\w-]{4,16}$/.test(id)) throw new Error('Bad id');
  const v = (await J(`https://api.modrinth.com/v2/project/${id}/version?loaders=${encodeURIComponent(JSON.stringify([i.loader]))}&game_versions=${encodeURIComponent(JSON.stringify([i.version]))}`))[0];
  if (!v) throw new Error('No compatible file');
  const f = v.files.find(x => x.primary) || v.files[0], name = path.basename(f.filename);
  if (!name.endsWith('.jar') || !f.url.startsWith('https://cdn.modrinth.com/')) throw new Error('Refusing suspicious file');
  const buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
  if (crypto.createHash('sha512').update(buf).digest('hex') !== f.hashes.sha512) throw new Error('Hash mismatch, download discarded');
  fs.writeFileSync(path.join(modsDir(i), name), buf); return name;
});
H('import-prism', async (idx) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); if (r.canceled) return 0;
  const src = ['minecraft/mods', '.minecraft/mods', 'mods'].map(p => path.join(r.filePaths[0], p)).find(fs.existsSync);
  if (!src) throw new Error('No mods folder found'); let n = 0;
  for (const f of fs.readdirSync(src)) if (f.endsWith('.jar')) { fs.copyFileSync(path.join(src, f), path.join(modsDir(inst(idx)), f)); n++; }
  return n;
});
H('open-folder', (i) => shell.openPath(instDir(inst(i))));
// Avatar: Microsoft accounts only, stored locally, never uploaded anywhere
const needMs = () => { if (!account || account.type !== 'ms') throw new Error('Microsoft login required'); };
H('get-skin', () => { needMs(); return cfg.skin; });
H('pick-skin', async () => {
  needMs(); const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Skin PNG', extensions: ['png'] }], properties: ['openFile'] }); if (r.canceled) return null;
  const b = fs.readFileSync(r.filePaths[0]);
  if (b.length > 262144 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(16) !== 64 || ![32, 64].includes(b.readUInt32BE(20))) throw new Error('Skin must be a 64x64 or 64x32 PNG');
  cfg.skin = 'data:image/png;base64,' + b.toString('base64'); save(); return cfg.skin;
});
H('set-avatar', (a) => { needMs(); cfg.avatar = { items: (a.items || []).filter(x => ['horns', 'halo', 'orbs', 'wings', 'ears'].includes(x)), color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : '#b6ff3c' }; save(); });

app.setName('Siz Client');
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  win = new BrowserWindow({ width: 1080, height: 700, minWidth: 900, minHeight: 600, title: 'Siz Client', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#140a24',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile('index.html');
});
app.on('window-all-closed', () => { if (rpc) rpc.destroy().catch(() => {}); app.quit(); });
