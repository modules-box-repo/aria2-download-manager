// Long-press detail sheet with per-download actions
const ItemSheet = (() => {
  const wrap = $('#item-wrap');
  const nameEl = $('#item-name');
  const subEl = $('#item-sub');
  const gridEl = $('#item-grid');
  const actionsEl = $('#item-actions');
  let item = null;

  function close() {
    wrap.classList.add('hidden');
    document.body.style.overflow = '';
    item = null;
  }

  function stats() {
    if (!item) return [];
    const k = item.kind;
    const rows = [];
    const size = k === 'completed' || k === 'failed' ? item.size : item.total;
    if (k === 'completed') rows.push(['Status', 'Completed']);
    else if (k === 'failed') rows.push(['Status', item.message || 'Failed']);
    else if (k === 'paused') rows.push(['Status', 'Paused']);
    else if (k === 'waiting') rows.push(['Status', 'Queued']);
    else rows.push(['Status', 'Downloading']);
    if (size) rows.push(['Size', fmtBytes(size)]);
    if (item.dir) rows.push(['Folder', baseDir(item.dir) || item.dir]);
    if (item.isTorrent) {
      if (item.infoHash) rows.push(['Info hash', String(item.infoHash).slice(0, 12)]);
      if (k === 'active' || k === 'waiting') {
        rows.push(['Seeds', numOr(item.seeds, 0) + ' \u00b7 ' + numOr(item.livePeers, 0) + ' peers']);
      }
    }
    if (k === 'active') {
      if (item.dl) rows.push(['Speed', fmtSpeed(item.dl)]);
      rows.push(['Progress', (Number(item.pct) || 0).toFixed(1) + '%']);
    }
    return rows;
  }

  function actionBtn(act, label, ic, cls) {
    return '<button class="item-btn ' + (cls || '') + '" data-act="' + act + '" data-label="' + label + '" type="button">' +
      icon(ic, 18) + '<span>' + label + '</span></button>';
  }

  function magnetFor(it) {
    if (!it || !it.infoHash) return '';
    return 'magnet:?xt=urn:btih:' + it.infoHash + (it.name ? '&dn=' + encodeURIComponent(it.name) : '');
  }

  function renderActions() {
    if (!item) return void (actionsEl.innerHTML = '');
    const k = item.kind;
    let html = '';
    if (k === 'active') html += actionBtn('pause', 'Pause', 'pause');
    if (k === 'paused') html += actionBtn('resume', 'Resume', 'play');
    if (k === 'active' || k === 'paused' || k === 'waiting') html += actionBtn('cancel', 'Cancel', 'cancel');
    if (k === 'failed') html += actionBtn('retry', 'Retry', 'refresh');
    if (k === 'completed') {
      html += actionBtn('readd', 'Re-download', 'redownload');
    }
    html += actionBtn('copy', 'Copy link', 'copy');
    html += actionBtn('delete', 'Delete', 'trash', 'danger');
    actionsEl.innerHTML = html;
  }

  const sliders = [
    ['#item-split', '#item-split-out', (v) => (v > 0 ? v : 'Auto')],
    ['#item-conns', '#item-conns-out', (v) => (v > 0 ? v : 'Auto')],
    ['#item-ratio', '#item-ratio-out', (v) => (v > 0 ? Number(v).toFixed(1) : 'Auto')],
    ['#item-time', '#item-time-out', (v) => (v > 0 ? v + 'm' : 'Forever')],
    ['#item-peers', '#item-peers-out', (v) => (v > 0 ? v : 'Auto')]
  ];

  const BT_SLIDERS = ['#item-ratio', '#item-time', '#item-peers'];

  function isBt() {
    return !!(item && item.isTorrent);
  }

  function shapeSheet() {
    const bt = isBt();
    $('#item-http-opts').classList.toggle('hidden', bt);
    $('#item-bt-opts').classList.toggle('hidden', !bt);
    $('#item-link-field').classList.toggle('hidden', bt);
    $('#item-name-field').classList.toggle('hidden', bt);
    $('#item-seed-row').classList.toggle('hidden', !bt);
  }

  async function toggleSending(next) {
    const live = item && (item.kind === 'active' || item.kind === 'paused' || item.kind === 'waiting');
    if (!item || !isBt()) return;
    const before = item.sending !== false;
    const field = $('#item-seed');
    field.checked = next;
    field.disabled = true;
    try {
      if (live) {
        await API.options(item.gid, { sending: next, uploadLimit: Number(item.uploadLimit) || 0 }, true);
        toast(next ? 'Sending on, seeds forever' : 'Sending stopped');
      } else {
        await API.recordOption({ gid: item.gid, name: item.name, sending: next });
        toast(next ? 'Sending on' : 'Sending off');
      }
      item.sending = next;
      refresh();
    } catch (err) {
      item.sending = before;
      field.checked = before;
      toast(err.message, 'err');
    } finally {
      field.disabled = false;
    }
  }

  function fillOptions() {
    const k = item.kind;
    const live = k === 'active' || k === 'paused' || k === 'waiting';
    const bt = isBt();
    $('#item-out').value = item.name || '';
    $('#item-url').value = (item.uris && item.uris[0]) || '';
    $('#item-url').disabled = !live;
    $('#item-out').disabled = !live && k !== 'completed' && k !== 'failed';
    $('#item-split').value = Number(item.split) || 0;
    $('#item-conns').value = Number(item.maxConns) || 0;
SpeedControls.setItem(Number(item.limit) || 0);
    if (bt) SpeedControls.setItemUp(Number(item.uploadLimit) || 0);
    if (bt) {
      $('#item-ratio').value = Number(item.seedRatio) || 0;
      $('#item-time').value = Math.max(0, Number(item.seedTime) || 0);
      $('#item-peers').value = numOr(Number(item.peers), 55);
      $('#item-dht').checked = item.dht !== false;
      $('#item-pex').checked = item.pex !== false;
      $('#item-seed').checked = item.sending !== false;
    }
    sliders.forEach(([id, out, fmt]) => {
      const el = $(id);
      const inBt = BT_SLIDERS.indexOf(id) !== -1;
      el.classList.toggle('hidden', inBt && !bt);
      if (inBt && !bt) return;
      $(out).textContent = fmt(Number(el.value));
      el.disabled = !live;
    });
    if (bt) {
      $('#item-dht').disabled = !live;
      $('#item-pex').disabled = !live;
      $('#item-up').disabled = !live;
    }
    $('#item-apply').disabled = !live;
  }

  function numOr(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function fill() {
    if (!item) return;
    nameEl.textContent = item.name;
    subEl.textContent = item.dir ? baseDir(item.dir) || item.dir : '';
    const rows = stats();
    gridEl.innerHTML = rows.map(() => '<div class="item-cell"><span></span><b></b></div>').join('');
    gridEl.querySelectorAll('.item-cell').forEach((cell, i) => {
      $('span', cell).textContent = rows[i][0];
      $('b', cell).textContent = rows[i][1];
    });
    renderActions();
    shapeSheet();
    fillOptions();
  }

  async function applyChanges(btn) {
    if (!item) return;
    const live = item.kind === 'active' || item.kind === 'paused' || item.kind === 'waiting';
    const bt = isBt();
    const name = $('#item-out').value.trim();
    const url = $('#item-url').value.trim();
    const limit = SpeedControls.readItem();
    const uploadLimit = bt ? SpeedControls.readItemUp() : 0;
    const split = Number($('#item-split').value) || 0;
    const conns = Number($('#item-conns').value) || 0;
    const seedRatio = Number($('#item-ratio').value) || 0;
    const seedTime = Number($('#item-time').value) || 0;
    const peers = Number($('#item-peers').value) || 0;
    const dht = $('#item-dht').checked;
    const pex = $('#item-pex').checked;
    const sending = $('#item-seed').checked;
    btn.disabled = true;
    btn.textContent = 'Applying...';
    try {
      if (live) {
        const changed = limit !== (Number(item.limit) || 0) ||
          (bt && (uploadLimit !== (Number(item.uploadLimit) || 0) ||
            seedRatio !== (Number(item.seedRatio) || 0) ||
            seedTime !== Math.max(0, Number(item.seedTime) || 0) ||
            peers !== (Number(item.peers) || 0) ||
            dht !== (item.dht !== false) ||
            pex !== (item.pex !== false) ||
            sending !== (item.sending !== false))) ||
          (!bt && (split !== (Number(item.split) || 0) || conns !== (Number(item.maxConns) || 0)));
        if (changed) {
          const payload = bt
            ? { limit, uploadLimit, seedRatio, seedTime, peers, dht, pex, sending }
            : { limit, split, conns };
          await API.options(item.gid, payload, bt);
        }
        if (!bt && url && url !== (item.uris || [])[0]) await API.setLink(item.gid, url);
      }
      if (name && name !== item.name) {
        await API.rename(item.gid, name);
        close();
        toast('Saved');
        refresh();
        return;
      }
      toast('Updated');
      close();
      refresh();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Apply changes';
    }
  }

  async function run(act, btn) {
    if (!item) return;
    btn.disabled = true;
    try {
      if (act === 'pause' || act === 'resume') {
        await API.control(item.gid, act);
        toast(act === 'pause' ? 'Paused' : 'Resumed');
        close();
        refresh();
      } else if (act === 'cancel') {
        await API.control(item.gid, 'cancel');
        toast('Canceled');
        DownloadsView.drop(item.gid);
        close();
        refresh();
      } else if (act === 'retry') {
        if (!item.uris || !item.uris.length) return toast('No source link saved', 'err');
        await API.add(item.uris, {});
        toast('Restarted');
        DownloadsView.drop(item.gid);
        close();
        refresh();
      } else if (act === 'readd') {
        const source = item.uris && item.uris.length ? item.uris : (magnetFor(item) ? [magnetFor(item)] : []);
        if (!source.length) return toast('No source link saved', 'err');
        await API.add(source, { dir: item.dir || '' });
        toast('Re-added to queue');
        close();
        refresh();
      } else if (act === 'delete') {
        if (item.kind === 'active' || item.kind === 'paused' || item.kind === 'waiting') {
          await API.control(item.gid, 'cancel');
          toast('Download and files removed');
        } else {
          const res = await API.removeRecord({ gid: item.gid, name: item.name });
          toast(res.removed ? 'Record and files removed' : 'Record removed, file not found on disk');
        }
        DownloadsView.drop(item.gid);
        close();
        refresh();
      } else if (act === 'copy') {
        const url = item.uris && item.uris[0];
        if (!url) return toast('No source link saved', 'err');
        if (navigator.clipboard) await navigator.clipboard.writeText(url);
        toast('Link copied');
      }
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  actionsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    run(b.dataset.act, b);
  });

  $('#item-close').innerHTML = icon('close', 18);
  $('#item-adv-toggle').innerHTML = icon('chevron', 14) + '<span>Download settings</span>';
  $('#item-adv-toggle').addEventListener('click', () => {
    const adv = $('#item-adv');
    const open = adv.classList.contains('hidden');
    adv.classList.toggle('hidden', !open);
    $('#item-adv-toggle').classList.toggle('open', open);
  });
  sliders.forEach(([id, out, fmt]) => {
    $(id).addEventListener('input', () => { $(out).textContent = fmt(Number($(id).value)); });
  });
  $('#item-apply').addEventListener('click', (e) => applyChanges(e.currentTarget));
  $('#item-seed').addEventListener('change', (e) => toggleSending(e.target.checked));
  $('#item-close').addEventListener('click', close);
  $('.backdrop', wrap).addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !wrap.classList.contains('hidden')) close();
  });

  function open(id) {
    const found = DownloadsView.byKey(id);
    if (!found) return;
    item = found;
    fill();
    wrap.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  return { open, close };
})();
