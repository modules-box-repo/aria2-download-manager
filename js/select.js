// Multi-select mode with bulk pause, resume and delete
const SelectMode = (() => {
  const bar = $('#selbar');
  const countEl = $('#sel-count');
  const btnPause = $('#sel-pause');
  const btnResume = $('#sel-resume');
  const btnDelete = $('#sel-delete');
  const btnAll = $('#sel-all');
  const btnNone = $('#sel-none');
  let active = false;

  function rows() {
    return $$('#dl-list .row').map((el) => ({ el, gid: el.dataset.gid, kind: el.dataset.kind, name: el.dataset.name || '' }));
  }

  function selected() {
    return rows().filter((r) => r.el.dataset.sel === '1');
  }

  function paint() {
    if (!active) return;
    const all = rows();
    const sel = selected();
    countEl.textContent = sel.length === all.length && all.length
      ? 'All ' + all.length + ' selected'
      : sel.length + ' selected';
    btnAll.disabled = !all.length || sel.length === all.length;
    btnNone.disabled = !sel.length;
    btnPause.disabled = !sel.some((r) => r.kind === 'active');
    btnResume.disabled = !sel.some((r) => r.kind === 'paused');
    btnDelete.disabled = !sel.length;
  }

  function markAll(on) {
    rows().forEach((r) => {
      if (on) r.el.dataset.sel = '1';
      else delete r.el.dataset.sel;
    });
    paint();
  }

  function enter() {
    if (active) return;
    active = true;
    document.body.classList.add('selecting');
    bar.classList.remove('hidden');
    paint();
  }

  function exit() {
    if (!active) return;
    active = false;
    document.body.classList.remove('selecting');
    bar.classList.add('hidden');
    $$('#dl-list .row').forEach((el) => delete el.dataset.sel);
  }

  async function run(action, btn) {
    const sel = selected();
    if (!sel.length) return;
    btn.disabled = true;
    const targets = sel.filter((r) => {
      if (action === 'pause') return r.kind === 'active';
      if (action === 'resume') return r.kind === 'paused';
      return true;
    });
    let done = 0;
    let missing = 0;
    for (const r of targets) {
      try {
        if (action === 'delete') {
          if (r.kind === 'completed' || r.kind === 'failed') {
            const res = await API.removeRecord({ gid: r.gid, name: r.name });
            if (!res.removed) missing++;
          } else {
            await API.control(r.gid, 'cancel');
          }
          DownloadsView.drop(r.gid);
        } else {
          await API.control(r.gid, action);
          DownloadsView.drop(r.gid);
        }
        done++;
      } catch (e) {
        toast(e.message, 'err');
      }
    }
    exit();
    if (done) {
      const label = action === 'pause' ? 'Paused' : action === 'resume' ? 'Resumed' : 'Deleted';
      toast(label + ' ' + done + (done === 1 ? ' item' : ' items'));
    }
    if (missing) toast(missing + ' file' + (missing === 1 ? ' was' : 's were') + ' already gone from disk', 'err');
    refresh();
  }

  $('#select-mode').innerHTML = icon('selectAll', 20);
  $('#sel-close').innerHTML = icon('close', 18);
  btnPause.innerHTML = icon('pause', 19);
  btnResume.innerHTML = icon('play', 19);
  btnDelete.innerHTML = icon('trash', 19);
  btnAll.innerHTML = icon('selectAll', 18);
  btnNone.innerHTML = icon('deselectAll', 18);
  $('#select-mode').addEventListener('click', () => (active ? exit() : enter()));
  $('#sel-close').addEventListener('click', exit);
  btnPause.addEventListener('click', () => run('pause', btnPause));
  btnResume.addEventListener('click', () => run('resume', btnResume));
  btnDelete.addEventListener('click', () => run('delete', btnDelete));
  btnAll.addEventListener('click', () => markAll(true));
  btnNone.addEventListener('click', () => markAll(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && active) exit();
  });

  return { paint, exit, isActive: () => active };
})();
