// Thin fetch wrapper for the local backend API
const API = {
  async request(method, path, body) {
    const opts = { method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Request failed');
    return data;
  },
  get(path) {
    return this.request('GET', path);
  },
  post(path, body) {
    return this.request('POST', path, body || {});
  },
  info() {
    return this.get('/api/info');
  },
  downloads() {
    return this.get('/api/downloads');
  },
  settings() {
    return this.get('/api/settings');
  },
  saveSettings(s) {
    return this.post('/api/settings', s);
  },
  resetSettings() {
    return this.post('/api/reset-settings', {});
  },
  add(urls, options) {
    return this.post('/api/add', { urls, options });
  },
  probe(urls) {
    return this.post('/api/probe', { urls });
  },
  probeTorrent(data) {
    return this.post('/api/torrent/probe', { data });
  },
  checkExisting(payload) {
    return this.post('/api/check-existing', payload);
  },
  wipeExisting(payload) {
    return this.post('/api/wipe-existing', payload);
  },
  addTorrent(data, options) {
    return this.post('/api/torrent/add', { data, options });
  },
  control(gid, action) {
    return this.post('/api/control', { gid, action });
  },
  removeRecord(payload) {
    return this.post('/api/remove', payload);
  },
  options(gid, options, isTorrent) {
    return this.post('/api/options', { gid, options, isTorrent: !!isTorrent });
  },
  recordOption(payload) {
    return this.post('/api/record-option', payload);
  },
  setLink(gid, url) {
    return this.post('/api/uri', { gid, url });
  },
  rename(gid, name) {
    return this.post('/api/rename', { gid, name });
  }
};