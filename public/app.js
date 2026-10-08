// ── Органайзер: интерфейс ────────────────────────────────────────────
const { ymd, parseYmd, addDays, eventsOn, at, humanMin, pad } = Shared;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { events: [], tasks: [], notes: [], settings: {}, weekStart: null, taskFilter: 'active', noteQuery: '' };

const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WDL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
const REPEAT = { none: 'Не повторять', daily: 'Каждый день', weekdays: 'По будням', weekly: 'Каждую неделю', monthly: 'Каждый месяц', yearly: 'Каждый год' };
const REMIND = [['', 'Не напоминать'], ['0', 'В момент начала'], ['5', 'За 5 минут'], ['10', 'За 10 минут'], ['15', 'За 15 минут'],
  ['30', 'За 30 минут'], ['60', 'За 1 час'], ['120', 'За 2 часа'], ['1440', 'За 1 день']];
const today = () => ymd(new Date());
const fmtDay = (ds) => { const d = parseYmd(ds); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const relDay = (ds) => { const t = today(); if (ds === t) return 'Сегодня'; if (ds === addDays(t, 1)) return 'Завтра'; if (ds === addDays(t, -1)) return 'Вчера'; return fmtDay(ds); };
const mondayOf = (ds) => { const d = parseYmd(ds); const w = (d.getDay() + 6) % 7; return addDays(ds, -w); };

// ── API ──
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401) { showLogin(); throw new Error('auth'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Ошибка');
  return r.json();
}
async function loadAll() {
  [state.events, state.tasks, state.notes, state.settings] = await Promise.all(
    ['/api/events', '/api/tasks', '/api/notes', '/api/settings'].map((p) => api(p)));
}
async function saveItem(col, item) {
  const saved = item.id ? await api(`/api/${col}/${item.id}`, { method: 'PUT', body: item }) : await api(`/api/${col}`, { method: 'POST', body: item });
  const i = state[col].findIndex((x) => x.id === saved.id);
  if (i >= 0) state[col][i] = saved; else state[col].push(saved);
  render(); return saved;
}
async function deleteItem(col, id) {
  await api(`/api/${col}/${id}`, { method: 'DELETE' });
  state[col] = state[col].filter((x) => x.id !== id); render();
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }

// ── Рендер-блоки ──
function evHTML(e, ds, opts = {}) {
  const now = new Date();
  const start = e.time ? at(ds, e.time) : null;
  const end = e.endTime ? at(ds, e.endTime) : start && new Date(start.getTime() + 60 * 60000);
  const cls = ds === today() && start ? (end < now ? 'past' : start <= now ? 'now' : '') : '';
  const meta = [e.repeat && e.repeat !== 'none' ? '↻ ' + REPEAT[e.repeat].toLowerCase() : '', e.remind !== '' && e.remind != null ? '🔔 ' + (Number(e.remind) ? 'за ' + humanMin(e.remind) : 'в начале') : ''].filter(Boolean).join(' · ');
  if (opts.compact) return `<div class="ev ${cls}" style="--ec:var(--${e.color || 'c1'})" data-ev="${e.id}"><div class="ti">${esc(e.title)}</div><div class="meta">${e.time ? e.time + (e.endTime ? '–' + e.endTime : '') : 'весь день'}${e.remind !== '' && e.remind != null ? ' 🔔' : ''}</div></div>`;
  return `<div class="ev ${cls}" style="--ec:var(--${e.color || 'c1'})" data-ev="${e.id}">
    <div class="t">${e.time || '—'}${e.endTime ? `<small>${e.endTime}</small>` : e.time ? '' : '<small>весь день</small>'}</div>
    <div><div class="ti">${esc(e.title)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}${e.notes ? `<div class="meta">${esc(e.notes)}</div>` : ''}</div></div>`;
}
function taskHTML(t) {
  const late = !t.done && t.due && t.due < today();
  const meta = [t.due ? `<span class="${late ? 'late' : ''}">${late ? 'Просрочено · ' : ''}${relDay(t.due)}${t.time ? ', ' + t.time : ''}</span>` : '',
    t.remind !== '' && t.remind != null && t.due ? '<span>🔔</span>' : '', t.notes ? `<span>${esc(t.notes.slice(0, 80))}</span>` : ''].filter(Boolean).join('');
  return `<div class="task ${t.done ? 'done' : ''}"><input type="checkbox" class="chk" data-done="${t.id}" ${t.done ? 'checked' : ''}>
    <div class="body" data-task="${t.id}"><div class="ti">${esc(t.title)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
    <span class="prio ${t.priority || 'normal'}" title="Приоритет"></span></div>`;
}
function noteHTML(n) {
  const d = new Date(n.updated || n.created);
  return `<div class="card note" style="--nc:var(--${n.color || 'line'})" data-note="${n.id}">
    ${n.title ? `<h3>${esc(n.title)}</h3>` : ''}<p>${esc(n.body)}</p>
    <div class="meta"><span>${n.pinned ? '📌 ' : ''}${d.getDate()} ${MON[d.getMonth()]}</span></div></div>`;
}
const sortTasks = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '').localeCompare(b.time || '') ||
  ({ high: 0, normal: 1, low: 2 }[a.priority || 'normal'] - { high: 0, normal: 1, low: 2 }[b.priority || 'normal']);

// ── Экраны ──
const views = {
  today() {
    const t = today(), d = new Date();
    const evs = eventsOn(state.events, t);
    const tom = eventsOn(state.events, addDays(t, 1));
    const tasks = state.tasks.filter((x) => !x.done && (!x.due || x.due <= t)).sort(sortTasks);
    const pinned = state.notes.filter((n) => n.pinned);
    const h = d.getHours(); const hi = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
    const next = evs.find((e) => e.time && at(t, e.time) > d);
    return `<div class="head"><div><h1>${hi}</h1><div class="sub">${WDL[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}</div></div>
      <div class="row"><button class="btn" data-new="event">+ Событие</button><button class="btn primary" data-new="task">+ Задача</button></div></div>
      <form class="quick" data-quick="task"><input type="text" name="title" placeholder="Быстро добавить задачу на сегодня…" autocomplete="off"><button class="btn">Добавить</button></form>
      <div class="grid">
        <section class="card"><h2>Расписание на сегодня</h2>
          ${next ? `<div class="now-line">Следующее: ${esc(next.title)} в ${next.time}</div>` : ''}
          ${evs.map((e) => evHTML(e, t)).join('') || '<div class="empty">Свободный день ✨</div>'}
          ${tom.length ? `<h2 style="margin-top:20px">Завтра</h2>${tom.map((e) => evHTML(e, addDays(t, 1))).join('')}` : ''}
        </section>
        <section class="card"><h2>Задачи</h2>${tasks.map(taskHTML).join('') || '<div class="empty">Всё сделано 🎉</div>'}</section>
        ${pinned.length ? `<section><h2>Закреплённые заметки</h2>${pinned.map(noteHTML).join('')}</section>` : ''}
      </div>`;
  },

  schedule() {
    const ws = state.weekStart || mondayOf(today());
    const days = [...Array(7)].map((_, i) => addDays(ws, i));
    const a = parseYmd(days[0]), b = parseYmd(days[6]);
    const range = a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MON[b.getMonth()]}` : `${fmtDay(days[0])} – ${fmtDay(days[6])}`;
    return `<div class="head"><div><h1>Расписание</h1><div class="sub">${range} ${b.getFullYear()}</div></div>
      <div class="row"><button class="btn sm" data-week="-1">←</button><button class="btn sm" data-week="0">Эта неделя</button><button class="btn sm" data-week="1">→</button>
      <button class="btn primary" data-new="event">+ Событие</button></div></div>
      <div class="week">${days.map((ds) => { const d = parseYmd(ds); return `<div class="day ${ds === today() ? 'today' : ''}">
        <div class="dh"><b>${d.getDate()}</b><span>${WD[d.getDay()]}</span></div>
        ${eventsOn(state.events, ds).map((e) => evHTML(e, ds, { compact: true })).join('')}
        <button class="add" data-new="event" data-date="${ds}">+</button></div>`; }).join('')}</div>`;
  },

  tasks() {
    const t = today(), f = state.taskFilter;
    const open = state.tasks.filter((x) => !x.done);
    const filters = { active: ['Все', open], today: ['Сегодня', open.filter((x) => x.due && x.due <= t)],
      upcoming: ['Предстоящие', open.filter((x) => x.due && x.due > t)], nodate: ['Без срока', open.filter((x) => !x.due)],
      done: ['Выполнено', state.tasks.filter((x) => x.done)] };
    const list = [...filters[f][1]].sort(f === 'done' ? (a, b) => b.updated - a.updated : sortTasks);
    let body;
    if (f === 'active') {
      const groups = [['Просрочено', list.filter((x) => x.due && x.due < t)], ['Сегодня', list.filter((x) => x.due === t)],
        ['Завтра', list.filter((x) => x.due === addDays(t, 1))], ['Позже', list.filter((x) => x.due > addDays(t, 1))], ['Без срока', list.filter((x) => !x.due)]];
      body = groups.filter(([, l]) => l.length).map(([n, l]) => `<div class="group"><h2>${n}</h2><div class="card">${l.map(taskHTML).join('')}</div></div>`).join('');
    } else body = list.length ? `<div class="card">${list.map(taskHTML).join('')}</div>` : '';
    return `<div class="head"><div><h1>Планы и задачи</h1><div class="sub">${open.length} открыто</div></div>
      <button class="btn primary" data-new="task">+ Задача</button></div>
      <form class="quick" data-quick="task"><input type="text" name="title" placeholder="Новая задача… (Enter)" autocomplete="off"><button class="btn">Добавить</button></form>
      <div class="tabs">${Object.entries(filters).map(([k, [n, l]]) => `<button class="tab ${k === f ? 'active' : ''}" data-filter="${k}">${n}<span class="n">${l.length}</span></button>`).join('')}</div>
      ${body || '<div class="empty">Здесь пусто</div>'}`;
  },

  notes() {
    const q = state.noteQuery.toLowerCase();
    const list = state.notes.filter((n) => !q || (n.title + ' ' + n.body).toLowerCase().includes(q))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updated || b.created) - (a.updated || a.created));
    return `<div class="head"><div><h1>Заметки</h1><div class="sub">${state.notes.length} всего</div></div>
      <button class="btn primary" data-new="note">+ Заметка</button></div>
      <div class="quick"><input type="search" id="noteSearch" placeholder="Поиск по заметкам…" value="${esc(state.noteQuery)}"></div>
      <div class="notes">${list.map(noteHTML).join('') || '<div class="empty">Заметок пока нет</div>'}</div>`;
  },

  settings() {
    const s = state.settings, tg = s.telegram || {};
    const pushOk = 'serviceWorker' in navigator && 'PushManager' in window;
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    return `<div class="head"><div><h1>Настройки</h1><div class="sub">Уведомления и данные</div></div></div>
      <div class="grid">
      ${window.DEMO ? `<section class="card"><h2>Демо-режим</h2><div class="lbl"><span>Это демонстрация сайта. Данные хранятся только в этом браузере, а напоминания всплывают прямо на странице. Когда сайт будет запущен на сервере, они начнут приходить push-уведомлениями и в Telegram.</span></div>
        <div class="set"><div class="lbl"><b>Проверка</b><span>Показать, как выглядит напоминание</span></div><button class="btn primary" data-act="test">Показать</button></div></section>` : ''}
      <section class="card" ${window.DEMO ? 'hidden' : ''}><h2>Уведомления в браузере</h2>
        <div class="set"><div class="lbl"><b>Push-уведомления на этом устройстве</b>
          <span>${!pushOk ? 'Этот браузер не поддерживает push. На iPhone: «Поделиться» → «На экран Домой», затем откройте оттуда.' :
            perm === 'granted' ? '<span class="ok" id="pushState">Проверяю…</span>' : perm === 'denied' ? 'Заблокировано в настройках браузера — разрешите уведомления для этого сайта.' : 'Придут, даже если вкладка закрыта.'}</span></div>
          ${pushOk && perm !== 'denied' ? '<button class="btn primary" data-act="push">Включить</button>' : ''}</div>
        <div class="set"><div class="lbl"><b>Проверка</b><span>Отправить тестовое уведомление везде</span></div><button class="btn" data-act="test">Отправить тест</button></div>
      </section>
      <section class="card"><h2>Telegram</h2>
        ${!tg.enabled ? `<div class="lbl"><b>Бот не настроен</b><ol class="steps">
            <li>Откройте в Telegram <b>@BotFather</b>, отправьте <code>/newbot</code> и придумайте имя.</li>
            <li>Скопируйте токен, который он пришлёт.</li>
            <li>Вставьте в файл <code>.env</code>: <code>TELEGRAM_BOT_TOKEN=токен</code></li>
            <li>Перезапустите сервер и обновите эту страницу.</li></ol></div>`
        : tg.linked ? `<div class="set"><div class="lbl"><b class="ok">✓ Подключено${tg.bot ? ' — @' + esc(tg.bot) : ''}</b><span>Напоминания приходят в Telegram. Боту можно писать: /today, /task, /note</span></div>
            <button class="btn danger sm" data-act="unlink">Отвязать</button></div>`
        : `<div class="set"><div class="lbl"><b>Привязать свой Telegram</b><span>Нажмите кнопку — откроется бот, нажмите «Start».</span></div>
            ${tg.bot ? `<a class="btn primary" href="https://t.me/${esc(tg.bot)}?start=${esc(tg.code)}" target="_blank" rel="noopener">Подключить Telegram</a>` : '<span>Бот не отвечает — проверьте токен</span>'}</div>
            <div class="set"><div class="lbl"><span>Или отправьте боту вручную: <code>/start ${esc(tg.code)}</code></span></div><button class="btn sm" data-act="reload">Я подключил</button></div>`}
      </section>
      <section class="card"><h2>Утренняя сводка</h2>
        <div class="set"><label class="check"><input type="checkbox" class="chk" id="digest" ${s.digest ? 'checked' : ''}> Присылать план на день</label>
          <input type="time" id="digestTime" value="${esc(s.digestTime || '08:00')}" style="width:auto"></div>
      </section>
      <section class="card" ${window.DEMO ? 'hidden' : ''}><h2>Данные</h2>
        <div class="set"><div class="lbl"><b>Резервная копия</b><span>Скачать всё в JSON-файл</span></div><a class="btn" href="/api/export">Скачать</a></div>
        <div class="set"><div class="lbl"><b>Восстановить</b><span>Загрузить из JSON-файла</span></div><label class="btn">Загрузить<input type="file" id="importFile" accept=".json" hidden></label></div>
      </section></div>`;
  },
};

// ── Формы ──
const opt = (pairs, v) => pairs.map(([k, n]) => `<option value="${k}" ${String(v ?? '') === k ? 'selected' : ''}>${n}</option>`).join('');
const swatches = (v, withNone) => `<div class="swatches">${withNone ? `<input type="radio" name="color" value="" style="--sw:var(--line)" ${!v ? 'checked' : ''}>` : ''}${COLORS.map((c) => `<input type="radio" name="color" value="${c}" style="--sw:var(--${c})" ${v === c ? 'checked' : ''}>`).join('')}</div>`;

const forms = {
  event: (e) => `<h3>${e.id ? 'Событие' : 'Новое событие'}</h3>
    <div class="field"><label>Название</label><input type="text" name="title" value="${esc(e.title)}" required autofocus></div>
    <div class="two"><div class="field"><label>Дата</label><input type="date" name="date" value="${esc(e.date || today())}" required></div>
      <div class="field"><label>Повтор</label><select name="repeat">${opt(Object.entries(REPEAT), e.repeat || 'none')}</select></div></div>
    <div class="two"><div class="field"><label>Начало (пусто — весь день)</label><input type="time" name="time" value="${esc(e.time)}"></div>
      <div class="field"><label>Конец</label><input type="time" name="endTime" value="${esc(e.endTime)}"></div></div>
    <div class="field"><label>Напоминание</label><select name="remind">${opt(REMIND, e.id ? e.remind : '15')}</select></div>
    <div class="field"><label>Цвет</label>${swatches(e.color || 'c1')}</div>
    <div class="field"><label>Заметка</label><textarea name="notes" rows="2">${esc(e.notes)}</textarea></div>`,
  task: (t) => `<h3>${t.id ? 'Задача' : 'Новая задача'}</h3>
    <div class="field"><label>Что сделать</label><input type="text" name="title" value="${esc(t.title)}" required autofocus></div>
    <div class="two"><div class="field"><label>Срок</label><input type="date" name="due" value="${esc(t.due)}"></div>
      <div class="field"><label>Время</label><input type="time" name="time" value="${esc(t.time)}"></div></div>
    <div class="two"><div class="field"><label>Приоритет</label><select name="priority">${opt([['low', 'Низкий'], ['normal', 'Обычный'], ['high', 'Высокий']], t.priority || 'normal')}</select></div>
      <div class="field"><label>Напоминание</label><select name="remind">${opt(REMIND, t.remind)}</select></div></div>
    <div class="field"><label>Подробности</label><textarea name="notes" rows="3">${esc(t.notes)}</textarea></div>`,
  note: (n) => `<h3>${n.id ? 'Заметка' : 'Новая заметка'}</h3>
    <input type="text" name="title" value="${esc(n.title)}" placeholder="Заголовок">
    <textarea name="body" class="big" placeholder="Текст заметки…" autofocus>${esc(n.body)}</textarea>
    <div class="row" style="justify-content:space-between"><label class="check"><input type="checkbox" class="chk" name="pinned" ${n.pinned ? 'checked' : ''}> Закрепить</label>${swatches(n.color, true)}</div>`,
};
const COL = { event: 'events', task: 'tasks', note: 'notes' };

function openForm(kind, item = {}) {
  const dlg = $('#modal'), form = $('#modalForm');
  form.innerHTML = forms[kind](item) + `<div class="actions">
    <div>${item.id ? '<button type="button" class="btn danger" data-del>Удалить</button>' : ''}</div>
    <div class="row"><button type="button" class="btn ghost" data-cancel>Отмена</button><button class="btn primary" value="save">Сохранить</button></div></div>`;
  if (kind === 'task' && item.due && !item.id) form.remind.value = '15';
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form), data = { ...item };
    for (const [k, v] of fd.entries()) data[k] = typeof v === 'string' ? v.trim() : v;
    if (kind === 'note') { data.pinned = form.pinned.checked; if (!data.title && !data.body) return dlg.close(); }
    if (kind === 'task') data.done = !!item.done;
    if (kind === 'event' && data.repeat === 'none') delete data.until;
    if (data.remind !== undefined && data.remind !== '') data.remind = Number(data.remind);
    try { await saveItem(COL[kind], data); dlg.close(); toast('Сохранено'); } catch (e) { toast(e.message); }
  };
  $('[data-cancel]', form).onclick = () => dlg.close();
  const del = $('[data-del]', form);
  if (del) del.onclick = async () => {
    if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'Точно удалить?'; return; }
    await deleteItem(COL[kind], item.id); dlg.close(); toast('Удалено');
  };
  dlg.showModal();
}

// ── Push ──
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
async function enablePush() {
  const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
  if ((await Notification.requestPermission()) !== 'granted') return toast('Уведомления не разрешены');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(state.settings.vapidPublicKey) });
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  toast('Уведомления включены'); render();
}
async function checkPush() {
  const el = $('#pushState'); if (!el) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  el.textContent = sub ? '✓ Включены на этом устройстве' : 'Разрешено, но не подключено — нажмите «Включить»';
  if (sub) { $('[data-act=push]')?.remove(); api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() }).catch(() => {}); }
}

// ── События ──
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-new],[data-ev],[data-task],[data-note],[data-week],[data-filter],[data-act]');
  if (!el) return;
  const d = el.dataset;
  if (d.new) return openForm(d.new, d.new === 'event' && d.date ? { date: d.date } : {});
  if (d.ev) return openForm('event', state.events.find((x) => x.id === d.ev));
  if (d.task) return openForm('task', state.tasks.find((x) => x.id === d.task));
  if (d.note) return openForm('note', state.notes.find((x) => x.id === d.note));
  if (d.week) { state.weekStart = d.week === '0' ? null : addDays(state.weekStart || mondayOf(today()), 7 * d.week); return render(); }
  if (d.filter) { state.taskFilter = d.filter; return render(); }
  try {
    if (d.act === 'push') await enablePush();
    if (d.act === 'test' && window.DEMO) return window.demoNotify('🔔 Проверка', 'Так будут выглядеть напоминания.');
    if (d.act === 'test') { const r = await api('/api/notify/test', { method: 'POST' }); toast(r.push || r.telegram ? `Отправлено: push ${r.push}${r.telegram ? ', Telegram ✓' : ''}` : 'Нет подключённых каналов — включите push или Telegram'); }
    if (d.act === 'unlink' && !d.sure) { el.dataset.sure = '1'; el.textContent = 'Точно отвязать?'; return; }
    if (d.act === 'unlink') { await api('/api/telegram/unlink', { method: 'POST' }); await loadAll(); render(); }
    if (d.act === 'reload') { await loadAll(); render(); toast(state.settings.telegram.linked ? 'Telegram подключён ✓' : 'Пока не подключено'); }
  } catch (err) { toast(err.message); }
});
document.addEventListener('change', async (e) => {
  if (e.target.dataset.done) {
    const t = state.tasks.find((x) => x.id === e.target.dataset.done);
    await saveItem('tasks', { ...t, done: e.target.checked }); if (e.target.checked) toast('Готово ✓');
  }
  if (e.target.id === 'digest' || e.target.id === 'digestTime') {
    await api('/api/settings', { method: 'PUT', body: { digest: $('#digest').checked, digestTime: $('#digestTime').value } });
    state.settings.digest = $('#digest').checked; state.settings.digestTime = $('#digestTime').value; toast('Сохранено');
  }
  if (e.target.id === 'importFile' && e.target.files[0]) {
    try { await api('/api/import', { method: 'POST', body: JSON.parse(await e.target.files[0].text()) }); await loadAll(); render(); toast('Данные загружены'); }
    catch { toast('Не удалось прочитать файл'); }
  }
});
document.addEventListener('submit', async (e) => {
  const q = e.target.dataset.quick; if (!q) return;
  e.preventDefault();
  const title = e.target.elements.title.value.trim(); if (!title) return;
  await saveItem('tasks', { title, done: false, priority: 'normal', due: location.hash === '#today' || !location.hash ? today() : '' });
  toast('Задача добавлена'); $('[data-quick] input')?.focus();
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'noteSearch') { state.noteQuery = e.target.value; const pos = e.target.selectionStart; render(); const s = $('#noteSearch'); s.focus(); s.setSelectionRange(pos, pos); }
});

// ── Роутинг ──
function render() {
  const v = (location.hash.slice(1) || 'today');
  const view = views[v] ? v : 'today';
  $('#view').innerHTML = views[view]();
  document.querySelectorAll('.side a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  if (view === 'settings') checkPush();
}
window.addEventListener('hashchange', render);
setInterval(() => { if (!$('#modal').open && !['notes', 'settings'].includes(location.hash.slice(1))) render(); }, 60000);
document.addEventListener('visibilitychange', async () => { if (!document.hidden && !$('#modal').open) { try { await loadAll(); render(); } catch {} } });

function showLogin() { $('#app').hidden = true; $('#login').hidden = false; }
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: e.target.password.value }) });
  if (!r.ok) return ($('#loginErr').textContent = 'Неверный пароль');
  start();
};
async function start() {
  const st = await fetch('/api/status').then((r) => r.json());
  if (!st.authed) return showLogin();
  $('#login').hidden = true; $('#app').hidden = false;
  await loadAll(); render();
  if (navigator.serviceWorker) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
start();
