// ── Личный органайзер: сервер ─────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// .env (простая загрузка без зависимостей)
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
process.env.TZ = process.env.TZ || 'Asia/Tashkent';

const express = require('express');
const webpush = require('web-push');
const S = require('./public/shared.js');

const PORT = Number(process.env.PORT) || 3000;
// На Railway данные лежат на подключённом томе (Volume), иначе — в папке data/
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const PASSWORD = process.env.APP_PASSWORD || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
fs.mkdirSync(DATA_DIR, { recursive: true });

// ── База данных (JSON-файл) ───────────────────────────────────────────
const defaults = () => ({
  events: [], tasks: [], notes: [], subscriptions: [], sent: {},
  settings: { digest: true, digestTime: '08:00' },
  telegram: { chatId: null, linkCode: crypto.randomBytes(4).toString('hex') },
});
let db = defaults();
try {
  const saved = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db = { ...db, ...saved, settings: { ...db.settings, ...saved.settings }, telegram: { ...db.telegram, ...saved.telegram } };
} catch {}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
save();
const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

// ── Web Push ключи ────────────────────────────────────────────────────
let vapid;
try { vapid = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid)); }
webpush.setVapidDetails('mailto:owner@localhost.local', vapid.publicKey, vapid.privateKey);

// ── Сервер ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const authToken = crypto.createHmac('sha256', vapid.privateKey).update('auth:' + PASSWORD).digest('hex');
const cookie = (req, name) => (req.headers.cookie || '').split(';').map((c) => c.trim().split('='))
  .find(([k]) => k === name)?.[1];
const isAuthed = (req) => !PASSWORD || cookie(req, 'auth') === authToken;

app.get('/api/status', (req, res) => res.json({ authed: isAuthed(req), needPassword: !!PASSWORD }));
app.post('/api/login', (req, res) => {
  const ok = PASSWORD && typeof req.body.password === 'string' &&
    crypto.timingSafeEqual(crypto.createHash('sha256').update(req.body.password).digest(),
      crypto.createHash('sha256').update(PASSWORD).digest());
  if (!ok) return res.status(401).json({ error: 'Неверный пароль' });
  res.setHeader('Set-Cookie', `auth=${authToken}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax`);
  res.json({ ok: true });
});
app.use('/api', (req, res, next) => (isAuthed(req) ? next() : res.status(401).json({ error: 'auth' })));

const FIELDS = {
  events: ['title', 'date', 'time', 'endTime', 'repeat', 'until', 'remind', 'notes', 'color'],
  tasks: ['title', 'due', 'time', 'priority', 'done', 'remind', 'notes'],
  notes: ['title', 'body', 'pinned', 'color'],
};
const pick = (col, body) => Object.fromEntries(FIELDS[col].filter((k) => k in body).map((k) => [k, body[k]]));

for (const col of Object.keys(FIELDS)) {
  app.get(`/api/${col}`, (req, res) => res.json(db[col]));
  app.post(`/api/${col}`, (req, res) => {
    const item = { ...pick(col, req.body), id: uid(), created: Date.now(), updated: Date.now() };
    db[col].push(item); save(); res.json(item);
  });
  app.put(`/api/${col}/:id`, (req, res) => {
    const i = db[col].findIndex((x) => x.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'not found' });
    db[col][i] = { ...db[col][i], ...pick(col, req.body), updated: Date.now() };
    save(); res.json(db[col][i]);
  });
  app.delete(`/api/${col}/:id`, (req, res) => {
    db[col] = db[col].filter((x) => x.id !== req.params.id); save(); res.json({ ok: true });
  });
}

let botUsername = null;
app.get('/api/settings', (req, res) => res.json({
  ...db.settings,
  vapidPublicKey: vapid.publicKey,
  telegram: { enabled: !!TG_TOKEN, linked: !!db.telegram.chatId, bot: botUsername, code: db.telegram.linkCode },
}));
app.put('/api/settings', (req, res) => {
  if (typeof req.body.digest === 'boolean') db.settings.digest = req.body.digest;
  if (/^\d\d:\d\d$/.test(req.body.digestTime || '')) db.settings.digestTime = req.body.digestTime;
  save(); res.json({ ok: true });
});
app.post('/api/telegram/unlink', (req, res) => {
  db.telegram = { chatId: null, linkCode: crypto.randomBytes(4).toString('hex') }; save(); res.json({ ok: true });
});
app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'bad subscription' });
  db.subscriptions = db.subscriptions.filter((s) => s.endpoint !== sub.endpoint).concat(sub);
  save(); res.json({ ok: true });
});
app.post('/api/push/unsubscribe', (req, res) => {
  db.subscriptions = db.subscriptions.filter((s) => s.endpoint !== req.body?.endpoint); save(); res.json({ ok: true });
});
app.post('/api/notify/test', async (req, res) => {
  const r = await notify('🔔 Проверка', 'Уведомления работают! Так будут приходить напоминания.', '/#settings');
  res.json(r);
});
app.get('/api/export', (req, res) => {
  const { events, tasks, notes, settings } = db;
  res.setHeader('Content-Disposition', `attachment; filename="organizer-${S.ymd(new Date())}.json"`);
  res.json({ events, tasks, notes, settings, exported: new Date().toISOString() });
});
app.post('/api/import', (req, res) => {
  const b = req.body || {};
  for (const col of Object.keys(FIELDS)) if (Array.isArray(b[col])) {
    const ids = new Set(db[col].map((x) => x.id));
    db[col].push(...b[col].filter((x) => x && x.id && !ids.has(x.id)));
  }
  save(); res.json({ ok: true });
});

// ── Отправка уведомлений ──────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
async function notify(title, body, url = '/') {
  const result = { push: 0, telegram: false };
  const payload = JSON.stringify({ title, body, url });
  for (const sub of [...db.subscriptions]) {
    try { await webpush.sendNotification(sub, payload); result.push++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.subscriptions = db.subscriptions.filter((s) => s.endpoint !== sub.endpoint); save();
      } else console.error('push error', e.statusCode || e.message);
    }
  }
  if (TG_TOKEN && db.telegram.chatId) {
    try {
      const r = await tg('sendMessage', { chat_id: db.telegram.chatId, text: `<b>${esc(title)}</b>\n${esc(body)}`, parse_mode: 'HTML' });
      result.telegram = !!r.ok;
    } catch (e) { console.error('telegram error', e.message); }
  }
  return result;
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function dayText(ds) {
  const d = S.parseYmd(ds);
  const evs = S.eventsOn(db.events, ds);
  const tasks = db.tasks.filter((t) => !t.done && t.due && t.due <= ds)
    .sort((a, b) => (a.due + (a.time || '')).localeCompare(b.due + (b.time || '')));
  let out = `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}\n\n`;
  out += evs.length ? '📅 Расписание:\n' + evs.map((e) => `• ${e.time || 'весь день'} — ${e.title}`).join('\n') : '📅 Событий нет';
  out += '\n\n';
  out += tasks.length ? '✅ Задачи:\n' + tasks.map((t) => `• ${t.title}${t.due < ds ? ' (просрочено)' : t.time ? ' — ' + t.time : ''}`).join('\n') : '✅ Задач на этот день нет';
  return out;
}

// ── Планировщик: проверка каждые 30 секунд ────────────────────────────
const WINDOW = 15 * 60 * 1000; // если сервер был выключен — догоняем до 15 мин
let ticking = false;
async function tick() {
  if (ticking) return; ticking = true;
  try {
    const now = Date.now();
    const today = S.ymd(new Date());
    const days = [-1, 0, 1, 2].map((n) => S.addDays(today, n));
    const due = [];
    for (const ev of db.events) {
      if (ev.remind === null || ev.remind === undefined || ev.remind === '') continue;
      for (const ds of days) {
        if (!S.occursOn(ev, ds)) continue;
        const fire = S.at(ds, ev.time).getTime() - Number(ev.remind) * 60000;
        if (fire <= now && fire > now - WINDOW)
          due.push([`e:${ev.id}:${fire}`, `📅 ${ev.title}`,
            (ev.time ? `в ${ev.time}` : 'весь день') + (Number(ev.remind) ? ` · через ${S.humanMin(ev.remind)}` : ' · начинается сейчас') + (ev.notes ? `\n${ev.notes}` : ''), '/#schedule']);
      }
    }
    for (const t of db.tasks) {
      if (t.done || !t.due || t.remind === null || t.remind === undefined || t.remind === '') continue;
      const fire = S.at(t.due, t.time).getTime() - Number(t.remind) * 60000;
      if (fire <= now && fire > now - WINDOW)
        due.push([`t:${t.id}:${fire}`, `✅ ${t.title}`, (t.time ? `срок: ${t.time}` : 'срок сегодня') + (t.notes ? `\n${t.notes}` : ''), '/#tasks']);
    }
    if (db.settings.digest) {
      const fire = S.at(today, db.settings.digestTime).getTime();
      if (fire <= now && fire > now - WINDOW) due.push([`d:${today}`, '☀️ Доброе утро! План на сегодня', dayText(today), '/#today']);
    }
    for (const [key, title, body, url] of due) {
      if (db.sent[key]) continue;
      db.sent[key] = now; save();
      await notify(title, body, url);
    }
    for (const [k, v] of Object.entries(db.sent)) if (v < now - 7 * 864e5) delete db.sent[k];
  } catch (e) { console.error('tick error', e); }
  ticking = false;
}
setInterval(tick, 30000);

// ── Telegram-бот ──────────────────────────────────────────────────────
async function tg(method, params = {}) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
  });
  return r.json();
}
const HELP = `Команды:
/today — план на сегодня
/tomorrow — план на завтра
/tasks — открытые задачи
/task текст — добавить задачу
/note текст — добавить заметку

Просто напишите текст — сохраню его как заметку.`;

async function handleTg(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const reply = (t) => tg('sendMessage', { chat_id: chatId, text: t });
  if (!db.telegram.chatId) {
    if (text === `/start ${db.telegram.linkCode}`) {
      db.telegram.chatId = chatId; save();
      return reply('✅ Готово! Теперь напоминания будут приходить сюда.\n\n' + HELP);
    }
    return reply('Чтобы подключить бота, откройте сайт → «Настройки» → «Подключить Telegram».');
  }
  if (chatId !== db.telegram.chatId) return reply('Это личный бот, он уже привязан к другому аккаунту.');

  const [cmd, ...rest] = text.split(' ');
  const arg = rest.join(' ').trim();
  const today = S.ymd(new Date());
  switch (cmd.split('@')[0]) {
    case '/start': case '/help': return reply(HELP);
    case '/today': return reply(dayText(today));
    case '/tomorrow': return reply(dayText(S.addDays(today, 1)));
    case '/tasks': {
      const open = db.tasks.filter((t) => !t.done);
      return reply(open.length ? '✅ Открытые задачи:\n' + open.map((t) => `• ${t.title}${t.due ? ` (${t.due.split('-').reverse().join('.')})` : ''}`).join('\n') : 'Открытых задач нет 🎉');
    }
    case '/task':
      if (!arg) return reply('Напишите так: /task купить молоко');
      db.tasks.push({ id: uid(), title: arg, done: false, priority: 'normal', created: Date.now(), updated: Date.now() }); save();
      return reply('✅ Задача добавлена: ' + arg);
    case '/note':
      if (!arg) return reply('Напишите так: /note идея для проекта');
      db.notes.push({ id: uid(), title: '', body: arg, created: Date.now(), updated: Date.now() }); save();
      return reply('📝 Заметка сохранена');
    default:
      if (text.startsWith('/')) return reply(HELP);
      db.notes.push({ id: uid(), title: '', body: text, created: Date.now(), updated: Date.now() }); save();
      return reply('📝 Сохранил как заметку');
  }
}

async function tgLoop() {
  try { botUsername = (await tg('getMe')).result?.username || null; console.log('Telegram-бот: @' + botUsername); }
  catch (e) { console.error('Не удалось подключиться к Telegram:', e.message); }
  let offset = 0;
  for (;;) {
    try {
      const r = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
      if (!r.ok) { await new Promise((ok) => setTimeout(ok, 5000)); continue; }
      for (const u of r.result) { offset = u.update_id + 1; if (u.message) await handleTg(u.message).catch(console.error); }
    } catch { await new Promise((ok) => setTimeout(ok, 5000)); }
  }
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Органайзер запущен: http://localhost:${PORT}\n`);
  tick();
  if (TG_TOKEN) tgLoop(); else console.log('  (Telegram не настроен — добавьте TELEGRAM_BOT_TOKEN в .env)');
});
