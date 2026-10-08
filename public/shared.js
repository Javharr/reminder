// Общая логика повторений — используется и сервером, и браузером
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };

  function occursOn(ev, ds) {
    if (!ev.date || ds < ev.date) return false;
    if (ev.until && ds > ev.until) return false;
    const r = ev.repeat || 'none';
    if (r === 'none') return ds === ev.date;
    const d = parseYmd(ds), s = parseYmd(ev.date);
    switch (r) {
      case 'daily': return true;
      case 'weekdays': { const w = d.getDay(); return w >= 1 && w <= 5; }
      case 'weekly': return d.getDay() === s.getDay();
      case 'monthly': return d.getDate() === s.getDate();
      case 'yearly': return d.getDate() === s.getDate() && d.getMonth() === s.getMonth();
    }
    return false;
  }
  const eventsOn = (events, ds) =>
    events.filter((e) => occursOn(e, ds)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  function at(ds, time) {
    const [h, m] = (time || '09:00').split(':').map(Number);
    const d = parseYmd(ds); d.setHours(h, m, 0, 0); return d;
  }
  function humanMin(m) {
    m = Number(m);
    if (m === 0) return 'сейчас';
    if (m % 1440 === 0) return (m / 1440) + ' дн.';
    if (m % 60 === 0) return (m / 60) + ' ч';
    return m + ' мин';
  }
  return { pad, ymd, parseYmd, addDays, occursOn, eventsOn, at, humanMin };
});
