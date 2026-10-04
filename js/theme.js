// Handles light/dark theme switching with system default
(function () {
  const KEY = 'adm-theme';
  const meta = document.querySelector('meta[name="theme-color"]');
  const btn = document.getElementById('theme-toggle');
  const system = () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const current = () => localStorage.getItem(KEY) || system();

  function apply(t) {
    document.documentElement.dataset.theme = t;
    if (meta) meta.setAttribute('content', t === 'dark' ? '#070a13' : '#eef1f8');
    if (btn) btn.innerHTML = icon(t === 'dark' ? 'moon' : 'sun', 19);
  }

  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    btn.classList.add('rotating');
    setTimeout(() => {
      apply(next);
      btn.classList.remove('rotating');
    }, 160);
  });

  apply(current());
})();