// Renders the unified download list with filters, status colors and piece segments
const DownloadsView = (() => {
  const list = $('#dl-list');
  const empty = $('#dl-empty');
  const emptyTitle = $('#empty-title');
  const emptySub = $('#empty-sub');
  const chipsBar = $('#chips');
  const search = $('#dl-search');
  const FILTERS = ['all', 'active', 'waiting', 'paused', 'completed', 'failed'];
  const els = new Map();
  let DATA = null;
  let filter = 'all';
  let query = '';

  function grouped() {
    const arr = [];
    if (!DATA) return arr;
    (DATA.active || []).forEach((i) => arr.push(Object.assign({}, i, { kind: 'active' })));
    (DATA.paused || []).forEach((i) => arr.push(Object.assign({}, i, { kind: 'paused' })));
    (DATA.queued || []).forEach((i) => arr.push(Object.assign({}, i, { kind: 'waiting' })));
    (DATA.completed || []).forEach((i) => arr.push(Object.assign({}, i, { kind: i.status === 'ok' ? 'completed' : 'failed' })));
    return arr;
  }

  function counts() {
    const c = { all: 0, active: 0, waiting: 0, paused: 0, completed: 0, failed: 0 };
    for (const i of dedupe(grouped())) {
      c.all++;
      c[i.kind]++;
    }
    return c;
  }

  function renderChips(c) {
    let html = '';
    FILTERS.forEach((f) => {
      html += '<button class="chip' + (filter === f ? ' is-on' : '') + '" data-filter="' + f + '" type="button"><span>' +
        f.charAt(0).toUpperCase() + f.slice(1) + '</span><i>' + c[f] + '</i></button>';
    });
    chipsBar.innerHTML = html;
    chipsBar.querySelectorAll('.chip').forEach((ch) =>
      ch.addEventListener('click', () => {
        setFilter(ch.dataset.filter);
        toggleDrawer(false);
      })
    );
    FILTERS.forEach((f) => {
      const el = $('#c-' + f);
      if (el) el.textContent = c[f];
    });
    $$('.drawer-item[data-filter]').forEach((d) => d.classList.toggle('is-active', d.dataset.filter === filter));
  }

function pctFor(kind, item) {
    if (kind === 'completed') return 100;
    if (kind === 'failed') return Math.min(100, Math.round((Number(item.done) || 0) / Math.max(Number(item.total) || 1, 1) * 100));
    return Number(item.pct) || 0;
  }

  function splitCount(item) {
    const n = Number(item.split) || Number(item.maxConns) || 0;
    return Math.min(16, Math.max(0, n));
  }

  function segFills(item, pct) {
    const n = splitCount(item);
    if (n < 2) return null;
    const done = (Math.min(100, Math.max(0, pct)) / 100) * n;
    const out = [];
    for (let i = 0; i < n; i++) out.push(Math.min(1, Math.max(0, done - i)));
    return out;
  }

  function statusLabel(item) {
    const k = item.kind;
    if (k === 'active') return 'active';
    if (k === 'waiting') return 'queued';
    return k;
  }

  function torrentTag(item) {
    if (!item.isTorrent) return '';
    const on = item.sending !== false;
const up = Number(item.ul) || 0;
const upText = ': ' + fmtSpeed(up);
return '<span class="bt-tag" data-f="bt">' + icon('torrent', 13) + '<em>Torrent</em></span>' +
      '<span class="bt-tag ' + (on ? 'send-on' : 'send-off') + '" data-f="send">' + icon('upload', 13) + '<em>' +
      (on ? 'sending' : 'not sending') + upText + '</em></span>';
  }

  function metaHtml(item) {
    const k = item.kind;
    let html = '';
    if (k === 'active') {
      const eta = item.total && item.dl ? fmtEta((item.total - item.done) / item.dl) : '--:--';
      html = '<span class="rc">\u2193 ' + fmtSpeed(item.dl) + '</span><span>' + eta + '</span><span>' + item.conns + 'c</span><span>' + fmtBytes(item.done) + ' / ' + (item.total ? fmtBytes(item.total) : '?') + '</span>';
    } else if (k === 'waiting') {
      html = '<span>' + (item.total ? fmtBytes(item.total) : '') + '</span>';
    } else if (k === 'paused') {
      html = '<span>' + fmtBytes(item.done) + ' / ' + (item.total ? fmtBytes(item.total) : '?') + '</span>';
    } else if (k === 'failed') {
      html = '<span>' + (item.message || 'download failed') + '</span>';
    } else {
      html = '<span>' + (item.size ? fmtBytes(item.size) : 'unknown size') + '</span><span>' + timeAgo(item.doneAt) + '</span>';
    }
    return '<span class="meta-lead"><span class="st-badge' + (k === 'active' ? ' live' : '') + '">' + statusLabel(item) + '</span>' + torrentTag(item) + '</span>' +
      '<span class="meta-info">' + html + '</span>';
  }

  function actionsHtml(item) {
    if (item.kind === 'failed') {
      return btn('retry', 'Retry');
    }
    return '';
  }

  function btn(act, title) {
    const icons = {
      retry: 'refresh', copy: 'copy'
    };
    return '<button class="mini-btn" data-act="' + act + '" title="' + title + '" type="button">' + icon(icons[act], 17) + '</button>';
  }

  function buildRow(item, index) {
    const el = document.createElement('li');
    el.className = 'row has k-' + item.kind;
    el.dataset.gid = item.gid || item.name;
    el.dataset.name = item.name || '';
    el.dataset.kind = item.kind;
    el.style.animationDelay = Math.min(index * 35, 240) + 'ms';
    const pct = pctFor(item.kind, item);
    const fills = segFills(item, pct);
    const segHtml = fills
      ? '<div class="segs" data-f="segs">' + fills.map(() => '<span class="seg"><i style="width:0%"></i></span>').join('') + '</div>'
      : '';
    el.innerHTML =
      '<span class="row-check" data-f="check">' + icon('check', 14) + '</span>' +
      '<div class="row-main">' +
        '<div class="row-top">' +
          '<div class="row-name" data-f="name" title="' + item.name + '">' + item.name + '</div>' +
          '<div class="row-pct" data-f="pct">' + (item.kind === 'completed' ? '100%' : pct.toFixed(0) + '%') + '</div>' +
        '</div>' +
        '<div class="bar" data-f="bar-box"' + (fills ? ' hidden' : '') + '><div class="bar-fill" data-f="bar" style="width:' + pct + '%"></div></div>' +
        segHtml +
        '<div class="row-meta" data-f="meta">' + metaHtml(item) + '</div>' +
        '<div class="row-actions' + (actionsHtml(item) ? '' : ' hidden') + '" data-f="actions" data-kind="' + item.kind + '">' + actionsHtml(item) + '</div>' +
      '</div>';

    el.addEventListener('click', (e) => {
      const key = el.dataset.gid;
      if (document.body.classList.contains('selecting')) {
        toggleSelect(el);
        return;
      }
      const b = e.target.closest('[data-act]');
      if (el.dataset.longpress === '1') {
        el.dataset.longpress = '0';
        return;
      }
      if (b) return onAction(b.dataset.act, findItem(key), b);
      const live = findItem(key);
      if (live && (live.kind === 'active' || live.kind === 'paused')) toggle(live, el);
    });
    onLongPress(el, () => {
      if (!document.body.classList.contains('selecting')) ItemSheet.open(el.dataset.gid);
    });
    return el;
  }

  function toggleSelect(el) {
    if (el.dataset.sel === '1') delete el.dataset.sel;
    else el.dataset.sel = '1';
    SelectMode.paint();
  }

  function findItem(key) {
    return dedupe(grouped()).find((i) => (i.gid || i.name) === key) || null;
  }

  function moveTo(key, kind) {
    if (!DATA) return null;
    const buckets = { active: DATA.active, paused: DATA.paused, queued: DATA.queued, waiting: DATA.queued };
    let item = null;
    for (const list of [DATA.active, DATA.paused, DATA.queued]) {
      const i = list.findIndex((x) => x.gid === key);
      if (i > -1) {
        item = list.splice(i, 1)[0];
        break;
      }
    }
    if (!item) return null;
    const target = kind === 'waiting' ? DATA.queued : buckets[kind];
    target.push(Object.assign({}, item, { kind }));
    return item;
  }

  async function toggle(item, el) {
    if (el.dataset.busy === '1') return;
    const act = item.kind === 'active' ? 'pause' : 'resume';
    el.dataset.busy = '1';
    try {
      await API.control(item.gid, act);
      moveTo(item.gid, act === 'pause' ? 'paused' : 'active');
      apply();
      toast(act === 'pause' ? 'Paused' : 'Resumed');
      refresh();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      el.dataset.busy = '0';
    }
  }

  function updateRow(el, item) {
    const pct = pctFor(item.kind, item);
    if (el.dataset.kind !== item.kind) {
      el.dataset.kind = item.kind;
      el.className = 'row has k-' + item.kind;
    }
    const nameEl = $('[data-f="name"]', el);
    if (nameEl.textContent !== item.name) {
      nameEl.textContent = item.name;
      nameEl.title = item.name;
    }
    const fills = segFills(item, pct);
    const barBox = $('[data-f="bar-box"]', el);
    let strip = $('[data-f="segs"]', el);
    barBox.classList.toggle('hidden', Boolean(fills));
    if (fills) {
      if (!strip || strip.children.length !== fills.length) {
        strip = document.createElement('div');
        strip.className = 'segs';
        strip.dataset.f = 'segs';
        strip.innerHTML = fills.map(() => '<span class="seg"><i></i></span>').join('');
        barBox.after(strip);
      }
      $$('.seg i', strip).forEach((fillEl, i) => {
        const w = Math.round(fills[i] * 1000) / 10;
        if (fillEl.dataset.w !== String(w)) {
          fillEl.dataset.w = String(w);
          fillEl.style.width = w + '%';
        }
      });
    } else if (strip) {
      strip.remove();
    }
    if (!fills) $('[data-f="bar"]', el).style.width = pct + '%';
    const pctEl = $('[data-f="pct"]', el);
    pctEl.textContent = item.kind === 'completed' ? '100%' : pct.toFixed(0) + '%';
    $('[data-f="meta"]', el).innerHTML = metaHtml(item);
    const actions = $('[data-f="actions"]', el);
    if (actions.dataset.kind !== item.kind) {
      actions.dataset.kind = item.kind;
      const html = actionsHtml(item);
      actions.innerHTML = html;
      actions.classList.toggle('hidden', !html);
    }
  }

  async function onAction(act, item, btnEl) {
    if (!item) return;
    btnEl.style.opacity = '.45';
    try {
      if (act === 'retry') {
        if (!item.uris || !item.uris.length) return toast('No source link saved', 'err');
        await API.add(item.uris, {});
        toast('Restarted');
        refresh();
      } else if (act === 'copy') {
        const url = item.uris && item.uris[0];
        if (!url) return toast('No source link saved', 'err');
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Link copied'));
        else toast('Link copied');
      }
    } catch (err) {
      toast(err.message, 'err');
    }
    btnEl.style.opacity = '';
  }

  function dedupe(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const hash = item.infoHash || '';
      if (hash) {
        if (seen.has(hash)) continue;
        seen.add(hash);
      }
      out.push(item);
    }
    return out;
  }

  function apply() {
    const all = dedupe(grouped());
    renderChips(counts());
    const filtered = all.filter((i) => filter === 'all' || i.kind === filter);
    const q = query;
    const shown = q ? filtered.filter((i) => (i.name || '').toLowerCase().includes(q)) : filtered;
    const seen = new Set();

    shown.forEach((item, index) => {
      const key = item.gid || item.name;
      seen.add(key);
      let el = els.get(key);
      if (!el) {
        el = buildRow(item, index);
        els.set(key, el);
        list.appendChild(el);
      } else if (!el.isConnected) {
        list.appendChild(el);
      }
      updateRow(el, item);
    });

    els.forEach((el, key) => {
      if (!seen.has(key)) {
        el.style.transition = 'opacity .25s ease, transform .25s ease';
        el.style.opacity = '0';
        el.style.transform = 'translateY(-6px)';
        setTimeout(() => el.remove(), 260);
        els.delete(key);
      }
    });

    const has = shown.length > 0;
    list.classList.toggle('hidden', !has);
    empty.classList.toggle('hidden', has);
    if (!has) {
      const labels = { waiting: 'queued' };
      const f = labels[filter] || filter;
      emptyTitle.textContent = 'No ' + f + ' downloads';
      emptySub.textContent = filter === 'all' ? 'Tap the + button and paste a link to start grabbing files.' : 'Nothing here right now.';
    }
    SelectMode.paint();
  }

  function setFilter(f) {
    filter = f;
    if (f === 'settings') {
      switchView('settings');
      return;
    }
    switchView('downloads');
    apply();
  }

  function currentFilter() {
    return filter;
  }

  search.addEventListener('input', debounce(() => {
    query = search.value.trim().toLowerCase();
    apply();
  }, 160));

  function render(data) {
    DATA = data;
    apply();
  }

  function drop(key) {
    if (!DATA) return;
    for (const list of [DATA.active, DATA.paused, DATA.queued]) {
      const i = list.findIndex((x) => x.gid === key);
      if (i > -1) list.splice(i, 1);
    }
    DATA.completed = (DATA.completed || []).filter((c) => c.gid !== key);
    apply();
  }

  return { render, setFilter, currentFilter, byKey: findItem, drop };
})();