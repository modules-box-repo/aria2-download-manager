// Populates the settings form and applies engine changes
const SettingsView = (() => {
  const FIELDS = {
    downloadDir: '#set-dir'
  };
  const SPEEDS = {
    maxDownloadLimit: 'dl',
    maxOverallDownloadLimit: 'odl',
    maxUploadLimit: 'ul',
    maxOverallUploadLimit: 'oul'
  };
  const SLIDERS = {
    maxConcurrent: ['#set-concurrent', '#sv-concurrent'],
    maxConnPerServer: ['#set-conns', '#sv-conns'],
    split: ['#set-split', '#sv-split'],
    seedRatio: ['#set-seed', '#sv-seed']
  };
  const CHECKS = { continue: '#set-continue', autoFileRenaming: '#set-rename', allowOverwrite: '#set-overwrite' };

  function fmtSlider(key, v) {
    v = Number(v) || 0;
    return key === 'seedRatio' ? (v === 0 ? 'Off' : String(v)) : String(v);
  }

  Object.keys(SLIDERS).forEach((k) => {
    const inp = $(SLIDERS[k][0]);
    const out = $(SLIDERS[k][1]);
    out.textContent = fmtSlider(k, inp.value);
    inp.addEventListener('input', () => { out.textContent = fmtSlider(k, inp.value); });
  });

  function collect() {
    const out = {};
    for (const k of Object.keys(FIELDS)) out[k] = k === 'downloadDir' ? $(FIELDS[k]).value.trim() : (Number($(FIELDS[k]).value) || 0);
    for (const k of Object.keys(SLIDERS)) out[k] = Number($(SLIDERS[k][0]).value) || 0;
    for (const k of Object.keys(SPEEDS)) out[k] = SpeedControls[SPEEDS[k]].read();
    for (const k of Object.keys(CHECKS)) out[k] = $(CHECKS[k]).checked;
    return out;
  }

  function populate(s) {
    for (const k of Object.keys(FIELDS)) $(FIELDS[k]).value = s[k] || '';
    for (const k of Object.keys(SLIDERS)) {
      $(SLIDERS[k][0]).value = s[k] || 0;
      $(SLIDERS[k][1]).textContent = fmtSlider(k, s[k]);
    }
    for (const k of Object.keys(SPEEDS)) SpeedControls[SPEEDS[k]].write(s[k] || 0);
    for (const k of Object.keys(CHECKS)) $(CHECKS[k]).checked = !!s[k];
    publish(s);
  }

  function publish(s) {
    if (!window.addDefaults) return;
    window.addDefaults.split = Number(s.split) || 0;
    window.addDefaults.conns = Number(s.maxConnPerServer) || 0;
    window.addDefaults.limit = SpeedControls.dl.read();
    window.addDefaults.uploadLimit = SpeedControls.ul.read();
    window.addDefaults.seedRatio = Number(s.seedRatio) || 0;
    window.addDefaults.seedTime = 0;
    window.addDefaults.peers = 55;
  }

  function refreshInfo() {
    API.info()
      .then((info) => {
        $('#sys-version').innerHTML = info.aria2;
        $('#sys-run').innerHTML = '<span style="color:' + (info.running ? 'var(--ok)' : 'var(--warn)') + '">' + (info.running ? 'running' : 'stopped') + '</span>';
        $('#sys-dir').innerHTML = info.downloadDir;
        $('#sys-done').innerHTML = info.completed;
        $('#sys-uptime').innerHTML = fmtEta(info.serverUptime);
      })
      .catch(() => {
        $('#sys-version').innerHTML = 'unreachable';
      });
  }

  $('#btn-save').addEventListener('click', async () => {
    const btn = $('#btn-save');
    btn.disabled = true;
    btn.textContent = 'Applying...';
    try {
      const payload = collect();
      await API.saveSettings(payload);
      publish(payload);
      toast('Settings applied, engine restarted');
      refreshInfo();
    } catch (err) {
      toast(err.message, 'err');
    }
    btn.disabled = false;
    btn.textContent = 'Save & apply';
  });

  $('#btn-reset').addEventListener('click', async () => {
    try {
      await API.resetSettings();
      const s = await API.settings();
      populate(s);
      toast('Settings reset to defaults');
      refreshInfo();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  function start() {
    API.settings().then(populate).catch(() => {});
    refreshInfo();
    setInterval(refreshInfo, 8000);
  }

  return { start, refreshInfo, overwrite: () => $(CHECKS.allowOverwrite).checked };
})();