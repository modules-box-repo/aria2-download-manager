// Serves the web UI and manages an aria2 daemon through its JSON-RPC interface
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA = path.join(ROOT, '.data');
const STATE_FILE = path.join(DATA, 'state.json');
const SESSION_FILE = path.join(DATA, 'session.txt');
const MAX_TORRENT = 8 * 1024 * 1024;
const TRACE_RPC = process.env.TRACE_RPC === '1';
const ARIA2_BIN = process.env.ARIA2C || 'aria2c';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || '/sdcard/Download';
const RPC_HOST = process.env.ARIA2_HOST || '127.0.0.1';
const RPC_PORT = Number(process.env.ARIA2_PORT) || 6800;
const RPC_INTERVAL = 800;
const START = Date.now();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const DEFAULT_SETTINGS = {
  downloadDir: DOWNLOAD_DIR,
  maxConcurrent: 3,
  maxConnPerServer: 4,
  split: 4,
  maxDownloadLimit: 0,
  maxOverallDownloadLimit: 0,
  maxUploadLimit: 0,
  maxOverallUploadLimit: 0,
  continue: true,
  autoFileRenaming: true,
  allowOverwrite: false,
  seedRatio: 1,
  listenPort: 0
};

let state = load();
let rpcToken = state.token;
let liveRpcPort = RPC_PORT;
let daemon = null;
let daemonUp = false;
let killIntent = false;
let restartTimer = null;
let effectivePort = 0;
const canceledGids = new Set();

function defaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function load() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    return {
      token: typeof data.token === 'string' ? data.token : crypto.randomBytes(9).toString('hex'),
      settings: Object.assign(defaults(), data.settings || {}),
      completed: Array.isArray(data.completed) ? data.completed : [],
      names: data.names && typeof data.names === 'object' ? data.names : {},
      opts: data.opts && typeof data.opts === 'object' ? data.opts : {}
    };
  } catch (e) {
    return { token: crypto.randomBytes(9).toString('hex'), settings: defaults(), completed: [], names: {}, opts: {} };
  }
}

function rememberOpts(gid, opts) {
  if (!gid) return;
  const merged = Object.assign({}, state.opts[gid], opts);
  state.opts[gid] = merged;
  save();
}

function rememberName(gid, name) {
  if (!gid || !name || name === 'download') return;
  if (state.names[gid] === name) return;
  state.names[gid] = name;
  if (Object.keys(state.names).length > 500) {
    const keys = Object.keys(state.names).slice(-500);
    const keep = {};
    for (const k of keys) keep[k] = state.names[k];
    state.names = keep;
  }
  save();
}

function forgetNames(gids) {
  let changed = false;
  for (const gid of gids) {
    if (state.names[gid]) {
      delete state.names[gid];
      changed = true;
    }
    if (state.opts[gid]) {
      delete state.opts[gid];
      changed = true;
    }
  }
  if (changed) save();
}

function save() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function rpc(method, ...params) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1e9),
    method: 'aria2.' + method,
    params: [`token:${rpcToken}`, ...params]
  });
  if (TRACE_RPC) {
    const preview = JSON.stringify(params).slice(0, 180);
    log('rpc ->', method, 'port', liveRpcPort, 'params', preview);
  }
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: RPC_HOST,
      port: liveRpcPort,
      path: '/jsonrpc',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            if (TRACE_RPC) log('rpc <-', method, 'ERROR', parsed.error.message || 'rpc error', 'code', parsed.error.code);
            reject(new Error(parsed.error.message || 'rpc error'));
          } else {
            if (TRACE_RPC) log('rpc <-', method, 'ok');
            resolve(parsed.result);
          }
        } catch (e) {
          if (TRACE_RPC) log('rpc <-', method, 'bad body', body.slice(0, 200));
          reject(new Error('invalid rpc response'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => req.destroy(new Error('rpc timeout')));
    req.write(payload);
    req.end();
  });
}

function daemonArgs() {
  const s = state.settings;
  const args = [
    '--enable-rpc=true',
    '--rpc-listen-all=false',
    `--rpc-listen-port=${liveRpcPort}`,
    `--rpc-secret=${rpcToken}`,
    `--dir=${s.downloadDir}`,
    `--max-concurrent-downloads=${s.maxConcurrent}`,
    `--max-connection-per-server=${s.maxConnPerServer}`,
    `--split=${s.split}`,
    `--continue=${s.continue ? 'true' : 'false'}`,
    `--auto-file-renaming=${s.autoFileRenaming ? 'true' : 'false'}`,
    `--allow-overwrite=${s.allowOverwrite ? 'true' : 'false'}`,
    `--max-overall-download-limit=${s.maxOverallDownloadLimit ? s.maxOverallDownloadLimit + 'K' : 0}`,
    `--max-download-limit=${s.maxDownloadLimit ? s.maxDownloadLimit + 'K' : 0}`,
    `--max-overall-upload-limit=${s.maxOverallUploadLimit ? s.maxOverallUploadLimit + 'K' : 0}`,
    `--max-upload-limit=${s.maxUploadLimit ? s.maxUploadLimit + 'K' : 0}`,
    `--seed-ratio=${s.seedRatio}`,
    '--file-allocation=none',
    '--summary-interval=0',
    '--save-session-interval=15',
    `--save-session=${SESSION_FILE}`,
    '--no-conf'
  ];
  if (effectivePort) args.push(`--listen-port=${effectivePort}`);
  if (fs.existsSync(SESSION_FILE)) args.push(`--input-file=${SESSION_FILE}`);
  return args;
}

function killDaemon() {
  killIntent = true;
  if (daemon) {
    const d = daemon;
    daemon = null;
    d.kill('SIGTERM');
  }
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.on('error', () => resolve(RPC_PORT));
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function startDaemon(force) {
  clearTimeout(restartTimer);
  fs.mkdirSync(DATA, { recursive: true });
  tryAdoptOrSpawn(force);
}

async function tryAdoptOrSpawn(force) {
  if (!force && daemon === null) {
    try {
      await rpc('getVersion');
      daemonUp = true;
      log('adopting running aria2 engine on port', liveRpcPort);
      return;
    } catch (e) {}
  }
  effectivePort = Number(state.settings.listenPort) || 0;
  if (effectivePort && !(await portFree(effectivePort))) {
    log('listen port', effectivePort, 'is busy, falling back to an automatic port');
    effectivePort = 0;
  }
  log('starting aria2 daemon on port', liveRpcPort, effectivePort ? 'with listen port ' + effectivePort : 'with an automatic listen port');
  killDaemon();
  killIntent = false;
  daemon = spawn(ARIA2_BIN, daemonArgs(), { stdio: 'ignore' });
  daemon.on('error', () => {
    daemonUp = false;
    daemon = null;
  });
  daemon.on('exit', (code, signal) => {
    daemonUp = false;
    daemon = null;
    log('aria2 daemon exited', code, signal);
    if (!killIntent && process.uptime() > 2) restartTimer = setTimeout(startDaemon, 3000);
  });
  let tries = 0;
  const ping = setInterval(async () => {
    try {
      await rpc('getVersion');
      daemonUp = true;
      clearInterval(ping);
      log('aria2 daemon ready on port', liveRpcPort);
    } catch (e) {
      if (e.message === 'Unauthorized') {
        clearInterval(ping);
        const newPort = await freePort();
        if (newPort !== liveRpcPort) {
          liveRpcPort = newPort;
          log('stale rpc engine detected, switching to port', newPort);
        }
        startDaemon(true);
      } else if (++tries > 12) {
        clearInterval(ping);
        log('aria2 daemon did not answer');
      }
    }
  }, RPC_INTERVAL);
}

function shutdownDaemon() {
  killIntent = true;
  if (daemon) daemon.kill('SIGTERM');
}
process.on('exit', shutdownDaemon);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function restartDaemon() {
  killDaemon();
  await sleep(500);
  liveRpcPort = await freePort();
  startDaemon(true);
}

async function recordCompleted() {
  let stopped;
  try {
    stopped = await rpc('tellStopped', 0, 100);
  } catch (e) {
    return;
  }
  for (const item of stopped) {
    if (state.completed.some((c) => c.gid === item.gid)) {
      rpc('removeDownloadResult', item.gid).catch(() => {});
      continue;
    }
    if (canceledGids.has(item.gid)) {
      canceledGids.delete(item.gid);
      rpc('removeDownloadResult', item.gid).catch(() => {});
      continue;
    }
    if (item.status === 'removed') {
      rpc('removeDownloadResult', item.gid).catch(() => {});
      continue;
    }
    const name = canonicalName(item);
    const opts = state.opts[item.gid] || {};
    forgetNames([item.gid]);
    const errors = item.status !== 'complete';
    state.completed.unshift({
      gid: item.gid,
      name,
      isTorrent: !!item.bittorrent,
      infoHash: (item.infoHash && String(item.infoHash).toLowerCase()) || '',
      path: item.dir ? path.join(item.dir, name) : '',
      dir: item.dir || state.settings.downloadDir,
      size: errors ? 0 : Number(item.totalLength) || 0,
      limit: Number(opts.limit) || 0,
      split: Number(opts.split) || Number(state.settings.split) || 0,
      maxConns: Number(opts.conns) || Number(state.settings.maxConnPerServer) || 0,
      uploadLimit: Number(opts.uploadLimit) || 0,
      seedRatio: opts.seedRatio === undefined ? Number(state.settings.seedRatio) || 0 : Number(opts.seedRatio),
      seedTime: opts.seedTime === undefined ? -1 : Number(opts.seedTime),
      peers: Number(opts.peers) || 55,
      dht: opts.dht === undefined ? true : !!opts.dht,
      pex: opts.pex === undefined ? true : !!opts.pex,
sending: opts.sending === undefined ? true : !!opts.sending,
      ul: Number(item.uploadSpeed) || 0,
      uris: itemUris(item),
      message: errors ? item.errorMessage || 'download failed' : '',
      status: errors ? 'failed' : 'ok',
      doneAt: Date.now()
    });
    if (state.completed.length > 200) state.completed = state.completed.slice(0, 200);
    save();
    rpc('removeDownloadResult', item.gid).catch(() => {});
  }
}

async function collectTracked() {
  const out = { active: [], queued: [], paused: [] };
  try {
    const [active, waiting] = await Promise.all([
      rpc('tellActive'),
      rpc('tellWaiting', 0, 100)
    ]);
    for (const item of active) out.active.push(item);
    for (const item of waiting) {
      if (item.status === 'paused') out.paused.push(item);
      else out.queued.push(item);
    }
  } catch (e) {
    log('status poll failed', e.message);
  }
  return out;
}

function mapItem(item) {
  const total = Number(item.totalLength) || 0;
  const done = Number(item.completedLength) || 0;
  const opts = state.opts[item.gid] || {};
  return {
    gid: item.gid,
    status: item.status,
    name: canonicalName(item),
    dir: item.dir || '',
    isTorrent: !!item.bittorrent,
    infoHash: (item.infoHash && String(item.infoHash).toLowerCase()) || '',
    total,
    done,
    pct: total ? Math.round((done / total) * 1000) / 10 : 0,
    dl: Number(item.downloadSpeed) || 0,
    ul: Number(item.uploadSpeed) || 0,
    conns: Number(item.connections) || 0,
    seeds: Number(item.numSeeders) || 0,
    livePeers: Number(item.connections) || 0,
    limit: Number(opts.limit) || 0,
    split: Number(opts.split) || Number(state.settings.split) || 0,
    maxConns: Number(opts.conns) || Number(state.settings.maxConnPerServer) || 0,
    uploadLimit: Number(opts.uploadLimit) || 0,
    seedRatio: opts.seedRatio === undefined ? Number(state.settings.seedRatio) || 0 : Number(opts.seedRatio),
    seedTime: opts.seedTime === undefined ? -1 : Number(opts.seedTime),
    peers: Number(opts.peers) || 55,
    dht: opts.dht === undefined ? true : !!opts.dht,
    pex: opts.pex === undefined ? true : !!opts.pex,
    sending: opts.sending === undefined ? true : !!opts.sending,
    uris: itemUris(item)
  };
}

function insideDownloadDir(p) {
  const target = path.resolve(p);
  const roots = new Set([DOWNLOAD_DIR]);
  try {
    roots.add(state.settings.downloadDir);
  } catch (e) {}
  for (const root of roots) {
    if (!root) continue;
    const base = path.resolve(root);
    if (target === base) continue;
    if (target.startsWith(base + path.sep)) return true;
  }
  log('refused to delete outside download dir:', p);
  return false;
}

function removePath(p) {
  if (!p) return 0;
  if (!insideDownloadDir(p)) return 0;
  let count = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    let st = null;
    try {
      st = fs.lstatSync(cur);
    } catch (e) {
      continue;
    }
    if (st.isDirectory()) {
      let kids = [];
      try {
        kids = fs.readdirSync(cur);
      } catch (e) {}
      for (const k of kids) stack.push(path.join(cur, k));
      try {
        fs.rmSync(cur, { recursive: true, force: true });
        count++;
      } catch (e) {}
    } else {
      try {
        fs.rmSync(cur, { force: true });
        count++;
      } catch (e) {}
    }
  }
  return count;
}

function wipeRecord(rec) {
  const base = rec.dir && rec.name ? path.join(rec.dir, rec.name) : rec.path || '';
  let gone = removePath(base);
  gone += removePath(base + '.aria2');
  if (rec.isTorrent && rec.dir && rec.name) {
    const dir = path.join(rec.dir, rec.name);
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
        gone++;
      }
    } catch (e) {}
  }
  return gone;
}

function nameFromUri(uri) {
  try {
    const u = new URL(uri);
    if (u.protocol === 'magnet:') return (u.searchParams.get('dn') || '').trim();
    return path.basename(decodeURIComponent(u.pathname)).trim();
  } catch (e) {
    return '';
  }
}

function decodeDisposition(value) {
  if (!value) return '';
  const star = /filename\*\s*=\s*[^']*''([^;]+)/i.exec(value);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch (e) {
      return star[1].trim().replace(/^"|"$/g, '');
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(value);
  return plain ? plain[1].trim() : '';
}

function nameFromHeaders(headers, fallbackUrl) {
  const fromDisp = decodeDisposition(headers['content-disposition']);
  if (fromDisp) return path.basename(fromDisp);
  const fromUri = nameFromUri(fallbackUrl || '');
  if (fromUri) return fromUri;
  return '';
}

function rawProbe(url, method, depth) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.request(
      url,
      {
        method,
        headers: { 'User-Agent': 'aria2-download-manager', Accept: '*/*' },
        timeout: 8000
      },
      (res) => {
        res.resume();
        const status = res.statusCode;
        if (status >= 300 && status < 400 && res.headers.location && depth < 5) {
          let next;
          try {
            next = new URL(res.headers.location, url).toString();
          } catch (e) {
            return resolve({ ok: false, error: 'Bad redirect target' });
          }
          res.on('end', () => resolve(rawProbe(next, method, depth + 1)));
          return;
        }
        if (status < 200 || status >= 300) {
          return resolve({ ok: false, status, error: 'Server responded ' + status });
        }
        resolve({
          ok: true,
          status,
          url,
          headers: res.headers,
          length: Number(res.headers['content-length']) || 0,
          type: String(res.headers['content-type'] || '').split(';')[0].trim(),
          disposition: res.headers['content-disposition'] || ''
        });
      }
    );
    req.on('error', (e) => resolve({ ok: false, error: e.message || 'Connection failed' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Connection timed out' });
    });
    req.end();
  });
}

async function probeUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return { ok: false, error: 'Empty link' };
  if (/^magnet:/i.test(trimmed)) {
    let name = '';
    try {
      name = nameFromUri(trimmed);
    } catch (e) {}
    return { ok: true, kind: 'magnet', name, size: 0, type: 'magnet', url: trimmed };
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (e) {
    return { ok: false, error: 'Invalid link format' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'Only http and https links are supported' };
  }
  let res = await rawProbe(trimmed, 'HEAD', 0);
  if (!res.ok && (res.status === 403 || res.status === 405 || res.status === 501 || !res.status)) {
    res = await rawProbe(trimmed, 'GET', 0);
  }
  if (!res.ok) return res;
  const size = res.type === 'application/x-bittorrent' ? 0 : res.length;
  const name = nameFromHeaders(res.headers, res.url);
  return {
    ok: true,
    kind: 'http',
    name: name || 'download',
    size,
    type: res.type || 'unknown',
    url: res.url,
    resumable: res.type === 'application/x-bittorrent' ? false : res.length > 0
  };
}

async function probeAll(urls) {
  const results = [];
  const limit = 4;
  for (let i = 0; i < urls.length; i += limit) {
    const slice = urls.slice(i, i + limit);
    results.push(...(await Promise.all(slice.map((u) => probeUrl(u)))));
  }
  return results;
}

function decodeTorrent(data) {
  const text = String(data || '').replace(/^data:[^;]*;base64,/, '');
  if (!text) throw new Error('Empty torrent file');
  const buf = Buffer.from(text, 'base64');
  if (!buf.length) throw new Error('Unreadable torrent file');
  if (buf.length > MAX_TORRENT) throw new Error('Torrent file is too large');
  return buf;
}

function bencode(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'binary');
  let i = 0;
  function parse() {
    const c = buf[i];
    if (c === 0x69) {
      const end = buf.indexOf(0x65, i);
      if (end < 0) throw new Error('Corrupt torrent file');
      const n = Number(buf.toString('ascii', i + 1, end));
      if (!Number.isFinite(n)) throw new Error('Corrupt torrent file');
      i = end + 1;
      return n;
    }
    if (c === 0x6c) {
      i++;
      const out = [];
      while (buf[i] !== 0x65) {
        if (i >= buf.length) throw new Error('Corrupt torrent file');
        out.push(parse());
      }
      i++;
      return out;
    }
    if (c === 0x64) {
      i++;
      const out = {};
      while (buf[i] !== 0x65) {
        if (i >= buf.length) throw new Error('Corrupt torrent file');
        const key = String(parse());
        out[key] = parse();
      }
      i++;
      return out;
    }
    const colon = buf.indexOf(0x3a, i);
    if (colon < 0) throw new Error('Corrupt torrent file');
    const len = Number(buf.toString('ascii', i, colon));
    if (!Number.isFinite(len) || len < 0) throw new Error('Corrupt torrent file');
    const start = colon + 1;
    i = start + len;
    if (i > buf.length) throw new Error('Truncated torrent file');
    return buf.toString('binary', start, i);
  }
  const out = parse();
  if (i !== buf.length) throw new Error('Trailing data in torrent file');
  return out;
}


function torrentInfo(raw) {
  const meta = bencode(raw);
  const info = meta && meta.info;
  if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('Not a valid torrent file');
  const name = String(info.name || '').trim() || 'torrent';
  let size = 0;
  let files = 0;
  if (Array.isArray(info.files) && info.files.length) {
    files = info.files.length;
    for (const f of info.files) size += Number(f.length) || 0;
  } else if (typeof info.length === 'number') {
    files = 1;
    size = info.length;
  } else {
    throw new Error('Torrent has no file information');
  }
  return { name, size, files, infoHash: torrentHash(raw) };
}

function encodeBencode(value) {
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from('l', 'ascii'), ...value.map(encodeBencode), Buffer.from('e', 'ascii')]);
  }
  if (value && typeof value === 'object') {
    const parts = [Buffer.from('d', 'ascii')];
    for (const key of Object.keys(value).sort()) {
      const k = Buffer.from(key, 'binary');
      parts.push(Buffer.from(String(k.length) + ':', 'ascii'), k, encodeBencode(value[key]));
    }
    parts.push(Buffer.from('e', 'ascii'));
    return Buffer.concat(parts);
  }
  if (typeof value === 'number') {
    const s = Buffer.from(String(Math.trunc(value)), 'ascii');
    return Buffer.concat([Buffer.from('i', 'ascii'), s, Buffer.from('e', 'ascii')]);
  }
  const b = Buffer.from(String(value), 'binary');
  return Buffer.concat([Buffer.from(String(b.length) + ':', 'ascii'), b]);
}

function torrentHash(raw) {
  try {
    const meta = bencode(raw);
    return crypto.createHash('sha1').update(encodeBencode(meta.info)).digest('hex');
  } catch (e) {
    return '';
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '0.0.0.0', () => srv.close(() => resolve(true)));
  });
}

function targetPath(dir, name) {
  const base = dir && dir.trim() ? dir.trim() : state.settings.downloadDir;
  return path.join(base, name || '');
}

async function purgeHash(hash, name, dir) {
  const wantName = String(name || '').trim();
  const wantDir = String(dir || '').trim();
  if (!hash && !wantName) return 0;
  let purged = 0;
  let items = [];
  try {
    const [active, waiting, stopped] = await Promise.all([
      rpc('tellActive'),
      rpc('tellWaiting', 0, 1000),
      rpc('tellStopped', 0, 1000)
    ]);
    items = [...active, ...waiting, ...stopped];
  } catch (e) {
    return 0;
  }
  for (const item of items) {
    const bt = item.bittorrent || {};
    const h = String(item.infoHash || '').toLowerCase();
    const hashHit = hash && h && h !== '-' && h === hash;
    const btName = bt.info && bt.info.name ? String(bt.info.name) : '';
    const nameHit = wantName && btName === wantName;
    const base = wantDir ? path.resolve(wantDir) : '';
    const dirHit = !base || [base, path.join(base, wantName)].some((c) => path.resolve(item.dir || '') === c);
    if (!hashHit && !(nameHit && dirHit)) continue;
    purged++;
    try {
      await rpc('forceRemove', item.gid);
    } catch (e) {
      try {
        await rpc('remove', item.gid);
      } catch (e2) {}
    }
    await rpc('removeDownloadResult', item.gid).catch(() => {});
    canceledGids.add(item.gid);
    forgetNames([item.gid]);
    state.completed = state.completed.filter((c) => c.gid !== item.gid);
  }
  if (wantName) {
    const before = state.completed.length;
    state.completed = state.completed.filter((c) => c.name !== wantName);
    if (before !== state.completed.length) {
      log('dropped', before - state.completed.length, 'stale record(s) for', wantName);
    }
  }
  if (purged) {
    save();
    log('purged', purged, 'slot(s) for', wantName || hash);
  }
  return purged;
}

function existingTarget(dir, name) {
  const p = targetPath(dir, name);
  if (!name) return null;
  try {
    if (!fs.existsSync(p)) return null;
  } catch (e) {
    return null;
  }
  let size = 0;
  try {
    const st = fs.statSync(p);
    size = st.isDirectory() ? 0 : st.size;
  } catch (e) {}
  return { path: p, dir: path.dirname(p), name: path.basename(p), size };
}

async function addTorrentRaw(raw, opts) {
  return rpc('addTorrent', raw.toString('base64'), [], opts);
}

function addOptions(o, torrent) {
  const opts = {};
  if (o.name) opts.out = o.name;
  if (o.dir) opts.dir = o.dir;
  if (o.limit) opts['max-download-limit'] = String(Math.max(1, Number(o.limit) || 0)) + 'K';
  if (torrent) {
    if (o.seedRatio > 0) opts['seed-ratio'] = String(Math.min(10, Number(o.seedRatio) || 0));
    if (o.seedTime !== undefined) opts['seed-time'] = String(Math.max(0, Math.round(Number(o.seedTime) || 0)) + 'm');
    if (o.uploadLimit) opts['max-upload-limit'] = String(Math.max(1, Number(o.uploadLimit) || 0)) + 'K';
    if (o.peers) opts['bt-max-peers'] = num(o.peers, 1, 200);
    if (o.trackers) {
      const list = String(o.trackers).split(/[\s,]+/).filter(Boolean).slice(0, 20);
      if (list.length) opts['bt-tracker'] = list.join(',');
    }
    if (o.dht !== undefined) opts['enable-dht'] = o.dht ? 'true' : 'false';
    if (o.pex !== undefined) opts['enable-peer-exchange'] = o.pex ? 'true' : 'false';
  } else {
    if (o.split) opts.split = num(o.split, 1, 16);
    if (o.conns) opts['max-connection-per-server'] = num(o.conns, 1, 16);
  }
  if (o.overwrite) opts['allow-overwrite'] = 'true';
  return opts;
}

function itemUris(item) {
  const out = [];
  for (const f of item.files || []) {
    for (const u of f.uris || []) out.push(u.uri || u);
  }
  if (!out.length) for (const u of item.uris || []) out.push(u.uri || u);
  return Array.from(new Set(out.filter((u) => typeof u === 'string' && u)));
}

function canonicalName(item) {
  const bt = item.bittorrent;
  if (bt && typeof bt === 'object' && bt.info && bt.info.name) return bt.info.name;
  for (const f of item.files || []) {
    if (f.path) return path.basename(f.path);
  }
  for (const u of itemUris(item)) {
    const n = nameFromUri(u);
    if (n) return n;
  }
  const known = state.names[item.gid];
  if (known) return known;
  return nameFromUri(bt) || 'download';
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('invalid json body'));
      }
    });
    req.on('error', reject);
  });
}

async function renameDownload(gid, name) {
  const safe = path.basename(String(name || '').trim());
  if (!safe || safe === '.' || safe === '..') throw new Error('Invalid file name');
  const st = await rpc('tellStatus', gid);
  const file = (st.files || [])[0];
  if (!file || !file.path) throw new Error('File not created yet');
  const current = path.basename(file.path);
  if (current === safe) return { name: current, path: file.path };
  const dir = path.dirname(file.path);
  const target = path.join(dir, safe);
  if (fs.existsSync(target)) throw new Error('A file with that name already exists');
  const wasActive = st.status === 'active';
  if (wasActive) await rpc('pause', gid);
  try {
    fs.renameSync(file.path, target);
    if (fs.existsSync(file.path + '.aria2')) fs.renameSync(file.path + '.aria2', target + '.aria2');
  } catch (e) {
    if (wasActive) await rpc('unpause', gid).catch(() => {});
    throw new Error(e.message || 'Rename failed');
  }
  rememberName(gid, safe);
  for (const c of state.completed) {
    if (c.gid === gid) {
      c.name = safe;
      c.path = target;
    }
  }
  save();
  if (wasActive) await rpc('unpause', gid).catch(() => {});
  return { name: safe, path: target };
}

const router = async (req, res, url, body) => {
  switch (`${req.method} ${url.pathname}`) {
    case 'GET /api/info': {
      let aria2Version = '';
      try {
        const v = await new Promise((resolve) => {
          const c = spawn(ARIA2_BIN, ['--version']);
          let out = '';
          c.stdout.on('data', (d) => (out += d));
          c.on('close', () => resolve(out.split('\n')[0] || ''));
          c.on('error', () => resolve(''));
        });
        aria2Version = v.replace(/^aria2 version /, '');
      } catch (e) {}
      return sendJSON(res, 200, {
        serverUptime: Math.round((Date.now() - START) / 1000),
        aria2: aria2Version || 'not found',
        running: daemonUp,
        downloadDir: state.settings.downloadDir,
        completed: state.completed.length
      });
    }
    case 'GET /api/settings':
      return sendJSON(res, 200, Object.assign({}, state.settings));
    case 'POST /api/settings': {
      const next = Object.assign(state.settings, pickSettings(body));
      if (!next.downloadDir || typeof next.downloadDir !== 'string') next.downloadDir = DEFAULT_SETTINGS.downloadDir;
      state.settings = next;
      save();
      restartDaemon();
      return sendJSON(res, 200, { ok: true, settings: state.settings });
    }
    case 'POST /api/reset-settings':
      state.settings = defaults();
      save();
      restartDaemon();
      return sendJSON(res, 200, { ok: true, settings: state.settings });
    case 'POST /api/probe': {
      const urls = [].concat(body.urls || []).filter((u) => typeof u === 'string' && u.trim());
      if (!urls.length) return sendJSON(res, 400, { ok: false, error: 'Provide at least one URL' });
      const results = await probeAll(urls);
      const failed = results.filter((r) => !r.ok);
      return sendJSON(res, 200, { ok: failed.length === 0, results, ready: failed.length === 0 });
    }
    case 'POST /api/torrent/probe': {
      try {
        const info = torrentInfo(decodeTorrent(body.data));
        log('torrent probe ok:', info.name, info.files + ' file(s)', info.size + ' bytes');
        return sendJSON(res, 200, { ok: true, info });
      } catch (e) {
        log('torrent probe failed:', e.message);
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }
    case 'POST /api/torrent/add': {
      let raw;
      let info;
      try {
        raw = decodeTorrent(body.data);
        info = torrentInfo(raw);
      } catch (e) {
        log('torrent add rejected:', e.message);
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
      const body_ = body.options || {};
      const opts = addOptions(body_, true);
      let portPending = false;
      if (body_.port) {
        const port = num(body_.port, 1024, 65535);
        if (port !== Number(state.settings.listenPort)) {
          if (!(await portFree(port))) {
            return sendJSON(res, 400, { ok: false, error: 'Port ' + port + ' is already in use' });
          }
          state.settings.listenPort = port;
          save();
          portPending = true;
        }
      }
      log('torrent add:', info.name, '| raw', raw.length + 'B', '| opts', JSON.stringify(opts));
      try {
        const gid = await addTorrentRaw(raw, opts);
        rememberName(gid, info.name);
        rememberOpts(gid, body_);
        log('torrent added, gid', gid);
        return sendJSON(res, 200, {
          ok: true,
          gid,
          name: info.name,
          files: info.files,
          size: info.size,
          portPending
        });
      } catch (e) {
        log('torrent add failed:', e.message);
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }
    case 'POST /api/check-existing': {
      const out = {};
      if (body.torrent) {
        let info;
        try {
          info = torrentInfo(decodeTorrent(body.torrent));
        } catch (e) {
          return sendJSON(res, 400, { ok: false, error: e.message });
        }
        const hit = existingTarget(body.dir, info.name);
        if (hit) {
          out.torrent = { name: info.name, files: info.files, size: info.size, at: hit.path, exists: true };
        }
      }
      const urls = [].concat(body.urls || []).filter((u) => typeof u === 'string' && u.trim());
      for (const url of urls) {
        const name = (body.names && body.names[url]) || nameFromUri(url);
        if (!name) continue;
        const hit = existingTarget(body.dir, name);
        if (!hit) continue;
        out.urls = out.urls || [];
        out.urls.push({ url, name, size: hit.size, at: hit.path });
      }
      const has = !!out.torrent || !!(out.urls && out.urls.length);
      return sendJSON(res, 200, { ok: true, exists: has, ...out });
    }
    case 'POST /api/wipe-existing': {
      let removed = 0;
      const seen = new Set();
      const wipe = (dir, name) => {
        const hit = existingTarget(dir, name);
        if (!hit || seen.has(hit.path)) return;
        seen.add(hit.path);
        removed += removePath(hit.path);
        removed += removePath(hit.path + '.aria2');
      };
      if (body.torrent) {
        try {
          const info = torrentInfo(decodeTorrent(body.torrent));
          const dir = body.dir && body.dir.trim() ? body.dir.trim() : state.settings.downloadDir;
          wipe(dir, info.name);
          removed += await purgeHash(info.infoHash, info.name, dir);
        } catch (e) {}
      }
      for (const url of [].concat(body.urls || [])) {
        const name = (body.names && body.names[url]) || nameFromUri(url);
        wipe(body.dir, name);
      }
      log('wipe existing:', removed, 'path(s) removed');
      return sendJSON(res, 200, { ok: true, removed });
    }
    case 'POST /api/add': {
      const urls = [].concat(body.urls || []).filter((u) => typeof u === 'string' && u.trim());
      if (!urls.length) return sendJSON(res, 400, { ok: false, error: 'Provide at least one URL' });
      const opts = addOptions(body.options || {});
      const gids = [];
      let added = 0;
      for (const url of urls) {
        try {
          const gid = await rpc('addUri', [url], opts);
          rememberName(gid, nameFromUri(url));
          rememberOpts(gid, body.options || {});
          gids.push({ url, gid });
          added++;
        } catch (e) {
          gids.push({ url, error: e.message });
        }
      }
      return sendJSON(res, 200, {
        ok: added === urls.length,
        added,
        results: gids,
        error: added === urls.length ? '' : 'Some links could not be added'
      });
    }
    case 'POST /api/control': {
      const gid = body.gid;
      const act = body.action;
      if (!gid) return sendJSON(res, 400, { ok: false, error: 'missing gid' });
      const map = { pause: 'pause', resume: 'unpause', cancel: 'remove', force: 'forceRemove' };
      const method = map[act];
      if (!method) return sendJSON(res, 400, { ok: false, error: 'unknown action' });
      let removed = false;
      try {
        if (act === 'cancel') {
          let paths = [];
          let st = null;
          try {
            st = await rpc('tellStatus', gid);
            paths = (st.files || []).map((f) => f.path).filter(Boolean);
          } catch (e) {}
          const bt = !!(st && st.bittorrent);
          const dir = (st && st.dir) || '';
          const name = canonicalName(st || {});
          try {
            await rpc(method, gid);
          } catch (e) {
            if (/not found/i.test(e.message)) {
              await rpc('removeDownloadResult', gid).catch(() => {});
              removed = true;
            } else {
              await rpc('forceRemove', gid);
            }
          }
          if (!removed) rpc('removeDownloadResult', gid).catch(() => {});
          canceledGids.add(gid);
          forgetNames([gid]);
          for (const p of paths) {
            removePath(p);
            removePath(p + '.aria2');
          }
          if (bt && dir && name) {
            removePath(path.join(dir, name));
          }
          setTimeout(() => {
            for (const p of paths) removePath(p + '.aria2');
          }, 400);
        } else {
          await rpc(method, gid);
        }
        return sendJSON(res, 200, { ok: true });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }
    case 'POST /api/remove': {
      const rec = state.completed.find((c) => c.gid === body.gid || c.name === body.name);
      state.completed = state.completed.filter((c) => c.gid !== body.gid && c.name !== body.name);
      forgetNames([body.gid]);
      save();
      if (!body.keepFiles && rec) {
        const gone = wipeRecord(rec);
        return sendJSON(res, 200, { ok: true, removed: gone });
      }
      return sendJSON(res, 200, { ok: true, removed: 0 });
    }
    case 'POST /api/options': {
      const gid = body.gid;
      if (!gid) return sendJSON(res, 400, { ok: false, error: 'missing gid' });
      const o = body.options || {};
      const isTorrent = !!body.isTorrent;
      const opts = {};
      if (o.split > 0) opts.split = num(o.split, 1, 16);
      if (o.conns > 0) opts['max-connection-per-server'] = num(o.conns, 1, 16);
      if (o.limit !== undefined) {
        const limit = Math.max(0, Number(o.limit) || 0);
        opts['max-download-limit'] = limit ? limit + 'K' : '0';
      }
      if (isTorrent) {
        if (o.uploadLimit !== undefined) {
          const up = Math.max(0, Number(o.uploadLimit) || 0);
          opts['max-upload-limit'] = up ? up + 'K' : '0';
        }
        if (o.seedRatio !== undefined) opts['seed-ratio'] = String(Math.min(10, Math.max(0, Number(o.seedRatio) || 0)));
        if (o.seedTime !== undefined) opts['seed-time'] = String(Math.max(0, Math.round(Number(o.seedTime) || 0)) + 'm');
        if (o.peers > 0) opts['bt-max-peers'] = num(o.peers, 1, 200);
        if (o.dht !== undefined) opts['enable-dht'] = o.dht ? 'true' : 'false';
        if (o.pex !== undefined) opts['enable-peer-exchange'] = o.pex ? 'true' : 'false';
        if (o.sending !== undefined) {
          const sending = !!o.sending;
          if (sending) {
            const up = Math.max(0, Number(o.uploadLimit) || 0);
            opts['max-upload-limit'] = up ? up + 'K' : '0';
            if (o.seedRatio === undefined) opts['seed-ratio'] = String(o.ratio === undefined ? 0 : Math.max(0, Number(o.ratio) || 0));
          } else {
            opts['max-upload-limit'] = '1K';
            opts['seed-ratio'] = '0';
            opts['seed-time'] = '0';
          }
        }
      }
      if (!Object.keys(opts).length) return sendJSON(res, 400, { ok: false, error: 'nothing to change' });
      try {
        await rpc('changeOption', gid, opts);
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
      const keep = { limit: Number(o.limit) || 0, split: 0, conns: 0 };
      if (isTorrent) {
        keep.uploadLimit = Number(o.uploadLimit) || 0;
        keep.seedRatio = Number(o.seedRatio) || 0;
        keep.seedTime = Number(o.seedTime) || 0;
        keep.peers = Number(o.peers) || 55;
        keep.dht = !!o.dht;
        keep.pex = !!o.pex;
        keep.sending = o.sending === undefined ? true : !!o.sending;
      } else {
        keep.split = Number(o.split) || 0;
        keep.conns = Number(o.conns) || 0;
      }
      rememberOpts(gid, keep);
      return sendJSON(res, 200, { ok: true });
    }
    case 'POST /api/record-option': {
      const rec = state.completed.find((c) => c.gid === body.gid || c.name === body.name);
      if (!rec) return sendJSON(res, 400, { ok: false, error: 'record not found' });
      if (body.sending !== undefined) rec.sending = !!body.sending;
      if (body.uploadLimit !== undefined) rec.uploadLimit = Math.max(0, Number(body.uploadLimit) || 0);
      if (body.gid) rememberOpts(body.gid, { sending: !!rec.sending, uploadLimit: rec.uploadLimit });
      save();
      return sendJSON(res, 200, { ok: true, sending: !!rec.sending });
    }
    case 'POST /api/uri': {
      const gid = body.gid;
      const url = String(body.url || '').trim();
      if (!gid || !url) return sendJSON(res, 400, { ok: false, error: 'missing link' });
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http and https links are supported');
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message || 'Invalid link format' });
      }
      try {
        await rpc('changeUri', gid, [], [url], [0]);
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
      return sendJSON(res, 200, { ok: true });
    }
    case 'POST /api/rename': {
      const gid = body.gid;
      if (!gid || !body.name) return sendJSON(res, 400, { ok: false, error: 'missing name' });
      try {
        const out = await renameDownload(gid, body.name);
        return sendJSON(res, 200, { ok: true, name: out.name });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }
    case 'GET /api/downloads': {
      const tracked = await collectTracked();
      const activeGids = new Set([
        ...tracked.active.map((t) => t.gid),
        ...tracked.queued.map((t) => t.gid),
        ...tracked.paused.map((t) => t.gid)
      ]);
      await recordCompleted();
      const fresh = state.completed.filter((c) => !activeGids.has(c.gid));
      if (fresh.length !== state.completed.length) {
        state.completed = fresh;
        save();
      }
      return sendJSON(res, 200, {
        engine: daemonUp,
        active: tracked.active.map(mapItem),
        queued: tracked.queued.map(mapItem),
        paused: tracked.paused.map(mapItem),
        completed: state.completed
      });
    }
    default:
      return sendJSON(res, 404, { ok: false, error: 'not found' });
  }
};

function pickSettings(body) {
  const map = {
    downloadDir: (v) => String(v).trim(),
    maxConcurrent: (v) => num(v, 1, 16),
    maxConnPerServer: (v) => num(v, 1, 16),
    split: (v) => num(v, 1, 16),
    maxDownloadLimit: (v) => Math.max(0, Number(v) || 0),
    maxOverallDownloadLimit: (v) => Math.max(0, Number(v) || 0),
    maxUploadLimit: (v) => Math.max(0, Number(v) || 0),
    maxOverallUploadLimit: (v) => Math.max(0, Number(v) || 0),
    continue: (v) => !!v,
    autoFileRenaming: (v) => !!v,
    allowOverwrite: (v) => !!v,
    seedRatio: (v) => Math.max(0, Number(v) || 0),
    listenPort: (v) => (Number(v) > 0 ? num(v, 1024, 65535) : 0)
  };
  const out = {};
  for (const key of Object.keys(map)) {
    if (key in body) out[key] = map[key](body[key]);
  }
  return out;
}

function num(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function serveStatic(req, res, url) {
  let filePath = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      let body = {};
      if (req.method === 'POST') body = await readBody(req).catch(() => ({}));
      await router(req, res, url, body);
    } else {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405);
        return res.end('Method not allowed');
      }
      serveStatic(req, res, url);
    }
  } catch (e) {
    log('request failed', e.message);
    sendJSON(res, 500, { ok: false, error: e.message });
  }
});

fs.mkdirSync(DATA, { recursive: true });
save();
startDaemon();
server.listen(PORT, () => {
  log(`Aria2 Download Manager running at http://localhost:${PORT}`);
});