// Wires the drawer, views, add sheet and the polling loop
(function () {
  $('#drawer-badge').innerHTML = icon('download', 20);
  $('#fab').innerHTML = icon('plus', 24);
  $('#drawer-btn').innerHTML = icon('menu', 20);
  $('#open-settings').innerHTML = icon('gear', 20);
  $('#search-icon').innerHTML = icon('search', 16);
  $('#sheet-close').innerHTML = icon('close', 18);
  $('#adv-toggle').innerHTML = icon('chevron', 14) + '<span>Advanced options</span>';
  $('#empty-art').innerHTML = emptyArt('dl');
  $('#tfile-ic').innerHTML = icon('torrent', 17);

  const drawer = $('#drawer');
  const scrim = $('#scrim');
  function toggleDrawer(open) {
    drawer.classList.toggle('open', open);
    scrim.classList.toggle('show', open);
  }
  window.toggleDrawer = toggleDrawer;
  $('#drawer-btn').addEventListener('click', () => toggleDrawer(!drawer.classList.contains('open')));
  $('#scrim').addEventListener('click', () => toggleDrawer(false));
  $$('.drawer-item').forEach((d) =>
    d.addEventListener('click', () => {
      toggleDrawer(false);
      DownloadsView.setFilter(d.dataset.filter);
    })
  );

  const views = { downloads: $('#view-downloads'), settings: $('#view-settings') };
  function switchView(name) {
    if (name !== 'downloads') SelectMode.exit();
    Object.keys(views).forEach((k) => views[k].classList.toggle('is-active', k === name));
    $('#fab').classList.toggle('hidden', name === 'settings');
    $$('.drawer-item[data-filter]').forEach((d) =>
      d.classList.toggle('is-active', d.dataset.filter === (name === 'settings' ? 'settings' : DownloadsView.currentFilter()))
    );
    if (name === 'settings') SettingsView.refreshInfo();
  }
  window.switchView = switchView;
  $('#open-settings').addEventListener('click', () => {
    toggleDrawer(false);
    switchView(views.settings.classList.contains('is-active') ? 'downloads' : 'settings');
  });
  $('#theme-toggle').addEventListener('click', () => toggleDrawer(false));

  const sheetWrap = $('#sheet-wrap');
  let torrentData = '';
  let torrentInfo = null;
  function closeSheet() {
    sheetWrap.classList.add('hidden');
    document.body.style.overflow = '';
  }
  $('#fab').addEventListener('click', () => {
    $('#fab').classList.add('open');
    setTimeout(() => $('#fab').classList.remove('open'), 300);
    openSheet();
  });
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#btn-cancel').addEventListener('click', closeSheet);
  $('.backdrop', sheetWrap).addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheetWrap.classList.contains('hidden')) closeSheet();
  });

  $('#adv-toggle').addEventListener('click', () => {
    const adv = $('#adv-box');
    const collapsed = adv.classList.contains('hidden');
    adv.classList.toggle('hidden', !collapsed);
    $('#adv-toggle').classList.toggle('open', collapsed);
  });

  const sheetRange = (id, out) => {
    const show = () => { $(out).textContent = $(id).value > 0 ? $(id).value : 'Auto'; };
    show();
    $(id).addEventListener('input', show);
  };
  sheetRange('#add-split', '#sv-add-split');
  sheetRange('#add-conns', '#sv-add-conns');

  $('#add-seed-ratio').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('#sv-seed-ratio').textContent = v > 0 ? v.toFixed(1) : 'Auto';
  });
  $('#add-seed-time').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('#sv-seed-time').textContent = v > 0 ? v + 'm' : 'Forever';
  });
  $('#add-peers').addEventListener('input', (e) => {
    $('#sv-peers').textContent = e.target.value;
  });

  const DEFAULTS = { split: 0, conns: 0, limit: 0, uploadLimit: 0, seedRatio: 0, seedTime: 0, peers: 55 };

  function applyDefaults() {
    $('#add-split').value = DEFAULTS.split;
    $('#add-conns').value = DEFAULTS.conns;
    $('#sv-add-split').textContent = DEFAULTS.split > 0 ? String(DEFAULTS.split) : 'Auto';
    $('#sv-add-conns').textContent = DEFAULTS.conns > 0 ? String(DEFAULTS.conns) : 'Auto';
    SpeedControls.add.write(DEFAULTS.limit);
    SpeedControls.up.write(DEFAULTS.uploadLimit);
    $('#add-seed-ratio').value = DEFAULTS.seedRatio;
    $('#add-seed-time').value = DEFAULTS.seedTime;
    $('#add-peers').value = DEFAULTS.peers;
    $('#sv-seed-ratio').textContent = DEFAULTS.seedRatio > 0 ? DEFAULTS.seedRatio.toFixed(1) : 'Auto';
    $('#sv-seed-time').textContent = DEFAULTS.seedTime > 0 ? DEFAULTS.seedTime + 'm' : 'Forever';
    $('#sv-peers').textContent = String(DEFAULTS.peers);
  }

  function resetSheet() {
    $('#add-urls').value = '';
    $('#add-name').value = '';
    $('#add-torrent').value = '';
    torrentData = '';
    torrentInfo = null;
    applyDefaults();
    $('#add-dht').checked = true;
    $('#add-pex').checked = true;
    $('#add-trackers').value = '';
    $('#add-port').value = '';
    $('#adv-box').classList.add('hidden');
    $('#adv-toggle').classList.remove('open');
    setMode(false);
    Probe.clear();
  }
  function openSheet() {
    resetSheet();
    sheetWrap.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  window.addDefaults = DEFAULTS;
  window.applyAddDefaults = applyDefaults;

  function sheetOptions() {
    return {
      name: $('#add-name').value.trim(),
      dir: $('#add-dir').value.trim(),
      split: Number($('#add-split').value) || 0,
      conns: Number($('#add-conns').value) || 0,
      limit: SpeedControls.add.read(),
      seedRatio: Number($('#add-seed-ratio').value) || 0,
      seedTime: Number($('#add-seed-time').value) || 0,
      uploadLimit: SpeedControls.up.read(),
      peers: Number($('#add-peers').value) || 0,
      trackers: $('#add-trackers').value.trim(),
      port: Number($('#add-port').value) || 0,
      dht: $('#add-dht').checked,
      pex: $('#add-pex').checked
    };
  }

  function setMode(isTorrent) {
    $('#links-field').classList.toggle('hidden', isTorrent);
    $('#probe-box').classList.toggle('hidden', isTorrent);
    $('#adv-http').classList.toggle('hidden', isTorrent);
    $('#adv-torrent').classList.toggle('hidden', !isTorrent);
    setTorrentShape(null);
    if (isTorrent) {
      $('#adv-box').classList.remove('hidden');
      $('#adv-toggle').classList.add('open');
    }
  }

  function setTorrentShape(info) {
    const multi = !!(info && Number(info.files) > 1);
    $('#name-field').classList.toggle('hidden', multi);
    $('#dir-hint').classList.toggle('hidden', !multi);
    if (multi) {
      $('#add-name').value = '';
      $('#add-name').dataset.touched = '0';
    }
  }

  const dlgWrap = $('#dlg-wrap');
  let dlgResolve = null;
  function askReplace(msg) {
    $('#dlg-msg').innerHTML = msg;
    dlgWrap.classList.remove('hidden');
    return new Promise((res) => { dlgResolve = res; });
  }
  function closeDialog(answer) {
    dlgWrap.classList.add('hidden');
    const done = dlgResolve;
    dlgResolve = null;
    if (done) done(answer);
  }
  $('#dlg-confirm').addEventListener('click', () => closeDialog(true));
  $('#dlg-cancel').addEventListener('click', () => closeDialog(false));
  $('#dlg-backdrop').addEventListener('click', () => closeDialog(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dlgWrap.classList.contains('hidden')) closeDialog(false);
  });

  function buildCheckPayload() {
    const payload = { dir: $('#add-dir').value.trim() };
    if (torrentInfo && torrentData) payload.torrent = torrentData;
    const urls = parseUrls($('#add-urls').value);
    if (urls.length) {
      payload.urls = urls;
      payload.names = {};
      const manual = $('#add-name').value.trim();
      if (manual && urls.length === 1) payload.names[urls[0]] = manual;
    }
    return payload;
  }

  async function confirmExisting() {
    const payload = buildCheckPayload();
    if (!payload.torrent && !payload.urls.length) return { ok: true, wipe: null };
    let res;
    try {
      res = await API.checkExisting(payload);
    } catch (e) {
      return { ok: true, wipe: null };
    }
    if (!res.exists) return { ok: true, wipe: null };
    if (SettingsView.overwrite()) return { ok: true, wipe: payload };
    const names = [];
    if (res.torrent) names.push('<b>' + res.torrent.name + '</b>');
    if (res.urls) for (const u of res.urls) names.push('<b>' + u.name + '</b>');
    const msg = names.join('<br>') + '<br><br>These files already exist on disk. Replace them with a fresh download?';
    const ok = await askReplace(msg);
    return { ok, wipe: ok ? payload : null };
  }

  async function addDownloads() {
    const urls = parseUrls($('#add-urls').value);
    if (!urls.length && !torrentInfo) {
      toast('Paste a link or choose a torrent file', 'err');
      return;
    }
    const btn = $('#btn-add');
    btn.disabled = true;
    let added = 0;
    let failure = '';
    try {
      const choice = await confirmExisting();
      if (!choice.ok) {
        btn.disabled = !Probe.isReady();
        return;
      }
      if (choice.wipe) {
        try {
          const w = await API.wipeExisting(choice.wipe);
          if (w.removed) toast('Removed ' + w.removed + ' old file' + (w.removed === 1 ? '' : 's'));
        } catch (e) {
          toast('Could not remove the old files: ' + e.message, 'err');
        }
      }
      const overwrite = true;
      if (torrentInfo) {
        const res = await API.addTorrent(torrentData, Object.assign(sheetOptions(), { overwrite }));
        if (res.ok) {
          added++;
          if (res.portPending) toast('Port saved, applies on next engine start');
        } else failure = res.error || 'Torrent could not be added';
      }
      if (urls.length) {
        if (!Probe.isReady()) {
          const check = await Probe.run(urls);
          if (!check.ready) {
            if (!failure) failure = check.error || 'Some links are not reachable';
          }
        }
        if (Probe.isReady()) {
          const res = await API.add(urls, Object.assign(sheetOptions(), { overwrite }));
          if (res.ok) added += urls.length;
          else if (!failure) {
            const failed = res.results.filter((r) => r.error);
            failure = failed.length ? failed[0].error : res.error || 'Download failed';
          }
        }
      }
      if (added) {
        if (torrentInfo && urls.length) toast('Added torrent and ' + (urls.length > 1 ? urls.length + ' links' : 'link'));
        else if (torrentInfo) toast('Torrent added');
        else toast(urls.length > 1 ? 'Added ' + urls.length + ' downloads' : 'Download started');
        closeSheet();
        switchView('downloads');
        refresh();
      }
      if (failure) toast(failure, 'err');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = !Probe.isReady();
    }
  }

  $('#add-name').addEventListener('input', () => { $('#add-name').dataset.touched = '1'; });

  $('#add-torrent').addEventListener('change', async () => {
    const file = $('#add-torrent').files && $('#add-torrent').files[0];
    if (!file) {
      torrentData = '';
      torrentInfo = null;
      setMode(false);
      Probe.clearTorrent();
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast('Torrent file is too large', 'err');
      $('#add-torrent').value = '';
      return;
    }
    setMode(true);
    const data = await readFileBase64(file);
    torrentData = data;
    const info = await Probe.setTorrent(data, file.name);
    setTorrentShape(info);
    torrentInfo = info;
  });

  $('#btn-add').addEventListener('click', addDownloads);
  $('#add-urls').addEventListener('input', debounce(() => {
    const urls = parseUrls($('#add-urls').value);
    if (!urls.length) {
      if (!torrentInfo) Probe.clear();
      return;
    }
    Probe.run(urls);
  }, 550));
  $('#add-urls').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) addDownloads();
  });

  async function refresh() {
    try {
      const data = await API.downloads();
      DownloadsView.render(data);
    } catch {}
  }

  window.refresh = refresh;
  SettingsView.start();
  refresh();
  setInterval(refresh, 1600);
})();