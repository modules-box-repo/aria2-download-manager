// Validates pasted links and shows file details before adding a download
function parseUrls(text) {
  return String(text || '')
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean);
}

const Probe = (() => {
  const stateBox = $('#probe-state');
  const listBox = $('#probe-list');
  const addBtn = $('#btn-add');
  const tfile = $('.tfile');
  const tfileName = $('#tfile-name');
  const tfileSub = $('#tfile-sub');
  const MAX_ROWS = 5;
  let token = 0;
  let ready = false;
  let autoName = '';

  function suggestName(results) {
    const field = $('#add-name');
    if (field.dataset.touched === '1') return;
    if (field.value && field.value !== autoName) return;
    if (results.length !== 1 || !results[0].ok) return;
    autoName = results[0].name || '';
    if (autoName) field.value = autoName;
  }

  function setState(kind, text) {
    stateBox.className = 'probe-state show ' + kind;
    stateBox.innerHTML = icon(kind === 'wait' ? 'refresh' : kind === 'ok' ? 'checkCircle' : 'alert', 16) + '<span></span>';
    stateBox.querySelector('span').textContent = text;
  }

  function rowHtml(item) {
    const good = item.ok;
    const sub = good
      ? (item.kind === 'magnet' ? 'Magnet link' : item.type || 'file')
      : item.error;
    return '<li class="probe-row ' + (good ? 'good' : 'bad') + '">' +
      '<span class="probe-ic">' + icon(good ? 'checkCircle' : 'alert', 15) + '</span>' +
      '<span class="probe-main">' +
        '<span class="probe-name"></span>' +
        '<span class="probe-sub"></span>' +
      '</span>' +
      '<span class="probe-size"></span>' +
    '</li>';
  }

  function renderList(results) {
    const shown = results.slice(0, MAX_ROWS);
    listBox.innerHTML = shown.map(rowHtml).join('');
    listBox.querySelectorAll('.probe-row').forEach((el, i) => {
      const item = shown[i];
      $('.probe-name', el).textContent = item.ok ? item.name || item.url : item.url;
      $('.probe-sub', el).textContent = item.ok
        ? (item.kind === 'magnet' ? 'Magnet link' : item.type || 'file')
        : item.error;
      $('.probe-size', el).textContent = item.ok && item.size ? fmtBytes(item.size) : '';
    });
    listBox.classList.toggle('hidden', !shown.length);
  }

  function setReady(next) {
    ready = next;
    addBtn.disabled = !next;
  }

  async function setTorrent(data, label) {
    const mine = ++token;
    setReady(false);
    stateBox.className = 'probe-state';
    stateBox.innerHTML = '';
    tfile.className = 'tfile';
    tfileName.textContent = label || 'Torrent file';
    tfileSub.textContent = 'Checking torrent...';
    try {
      const res = await API.probeTorrent(data);
      if (mine !== token) return null;
      tfile.className = 'tfile has';
      tfileName.textContent = res.info.name;
      tfileSub.textContent = res.info.files + (res.info.files > 1 ? ' files \u00b7 ' : ' file \u00b7 ') + fmtBytes(res.info.size);
      setState('ok', 'Torrent ready \u00b7 ' + res.info.name);
      setReady(true);
      suggestName([{ ok: true, name: res.info.name }]);
      return res.info;
    } catch (err) {
      if (mine !== token) return null;
      const msg = err.message === 'not found' ? 'Server is out of date, restart it' : err.message;
      tfile.className = 'tfile bad';
      tfileName.textContent = label || 'Torrent file';
      tfileSub.textContent = msg;
      setReady(false);
      return null;
    }
  }

  function clearTorrent() {
    tfile.className = 'tfile';
    tfileName.textContent = 'Choose a torrent file';
    tfileSub.textContent = '';
  }

  async function run(urls) {
    const mine = ++token;
    setReady(false);
    setState('wait', 'Checking link' + (urls.length > 1 ? 's' : '') + '...');
    listBox.classList.add('hidden');
    let data;
    try {
      data = await API.probe(urls);
    } catch (err) {
      if (mine !== token) return { ready: false, error: err.message };
      setState('err', err.message);
      setReady(false);
      return { ready: false, error: err.message };
    }
    if (mine !== token) return { ready: false, error: 'stale' };
    const results = data.results || [];
    renderList(results);
    const bad = results.filter((r) => !r.ok);
    const total = results.reduce((sum, r) => sum + (r.ok ? Number(r.size) || 0 : 0), 0);
    if (bad.length) {
      setState('err', bad.length === 1 ? 'Link is not available' : bad.length + ' links are not available');
      setReady(false);
      return { ready: false, error: bad[0].error, results };
    }
    suggestName(results);
    const unknown = results.some((r) => r.ok && !r.size);
    setState('ok', unknown ? results.length + ' link' + (results.length > 1 ? 's' : '') + ' verified'
      : results.length + ' link' + (results.length > 1 ? 's' : '') + ' verified \u00b7 ' + fmtBytes(total));
    setReady(true);
    return { ready: true, results };
  }

  function clear() {
    token++;
    ready = false;
    autoName = '';
    $('#add-name').dataset.touched = '0';
    stateBox.className = 'probe-state';
    stateBox.innerHTML = '';
    listBox.classList.add('hidden');
    listBox.innerHTML = '';
    clearTorrent();
    addBtn.disabled = true;
  }

  return { run, clear, setTorrent, clearTorrent, isReady: () => ready };
})();
