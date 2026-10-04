// DOM helpers, unit formatting and toast notifications
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log(v) / Math.log(1024)), units.length - 1);
  const val = v / Math.pow(1024, i);
  return (val >= 100 || i === 0 ? val.toFixed(0) : val.toFixed(1)) + ' ' + units[i];
}

function fmtSpeed(n) {
  return fmtBytes(n) + '/s';
}

function fmtEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 60) return Math.round(seconds) + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + Math.round(seconds % 60) + 's';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
  return Math.floor(seconds / 86400) + 'd ' + Math.floor((seconds % 86400) / 3600) + 'h';
}

function timeAgo(ts) {
  const diff = Math.max(0, (Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString();
}

function baseDir(p) {
  if (!p) return '';
  const parts = String(p).split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function toast(msg, type) {
  const wrap = $('#toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast ' + (type || 'ok');
  el.innerHTML = icon(type === 'err' ? 'alert' : 'checkCircle', 18) + '<span></span>';
  el.querySelector('span').textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s ease, transform .3s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(12px)';
    setTimeout(() => el.remove(), 320);
  }, 2400);
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const SPEED_MAX_KIB = 20971520;
const SPEED_MID_KIB = 1024;
const SPEED_LO_SPAN = Math.log2(SPEED_MID_KIB + 1);
const SPEED_HI_SPAN = Math.log2(SPEED_MAX_KIB / SPEED_MID_KIB);

function speedKib(pct) {
  const p = Math.min(100, Math.max(1, Number(pct) || 1));
  if (p >= 100) return SPEED_MAX_KIB;
  if (p <= 50) return Math.max(1, Math.round(Math.pow(2, (p / 50) * SPEED_LO_SPAN) - 1));
  return Math.max(SPEED_MID_KIB, Math.round(SPEED_MID_KIB * Math.pow(2, ((p - 50) / 50) * SPEED_HI_SPAN)));
}

function speedPct(kib) {
  const k = Math.max(0, Number(kib) || 0);
  if (k <= 0) return 100;
  if (k >= SPEED_MAX_KIB) return 100;
  if (k <= SPEED_MID_KIB) return Math.min(50, Math.round((50 * Math.log2(k + 1)) / SPEED_LO_SPAN));
  return Math.min(100, Math.round(50 + (50 * Math.log2(k / SPEED_MID_KIB)) / SPEED_HI_SPAN));
}

function fmtSpeedAuto(kib) {
  const v = Math.max(0, Number(kib) || 0);
  if (v <= 0) return 'Max';
  if (v >= SPEED_MAX_KIB) return 'Max';
  if (v < 1024) return (v < 10 ? v.toFixed(1) : String(Math.round(v))) + ' KB/s';
  if (v < 1048576) return (v / 1024).toFixed(v < 10240 ? 1 : 0) + ' MB/s';
  return (v / 1048576).toFixed(v < 10485760 ? 2 : 1) + ' GB/s';
}

function bindSpeed(sliderSel, outSel) {
  const slider = $(sliderSel);
  const out = $(outSel);
  const paint = () => { out.textContent = fmtSpeedAuto(speedKib(slider.value)); };
  slider.addEventListener('input', paint);
  return {
    read: () => speedKib(slider.value),
    write(kib) {
      slider.value = speedPct(kib);
      paint();
    },
    paint
  };
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop());
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

function onLongPress(el, fn, wait = 500) {
  let timer = null;
  let sx = 0;
  let sy = 0;
  const start = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const p = e.touches ? e.touches[0] : e;
    sx = p.clientX;
    sy = p.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.dataset.longpress = '1';
      fn();
    }, wait);
  };
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointermove', (e) => {
    const p = e.touches ? e.touches[0] : e;
    if (Math.abs(p.clientX - sx) > 10 || Math.abs(p.clientY - sy) > 10) cancel();
  });
  ['pointerup', 'pointercancel', 'pointerleave', 'scroll'].forEach((ev) => el.addEventListener(ev, cancel, true));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}