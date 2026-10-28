// OWNER, REPO и ADMIN_ID лежат в config.js

const API = f => `https://api.github.com/repos/${OWNER}/${REPO}/contents/${f}`;
const RAW = f => `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${f}`;
const $ = id => document.getElementById(id);

const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const haptic = t => { try { tg?.HapticFeedback?.impactOccurred(t || "light"); } catch (e) {} };

const isAdmin = tg?.initDataUnsafe?.user?.id === ADMIN_ID;
if (isAdmin) $("plusBtn").hidden = false;

let items = [], itemsSha = null;      // домашние задания (data.json)
let changes = [], changesSha = null;  // замены в расписании (changes.json)
let sched = { slots: [], lessons: [], anchorMonday: "2026-10-19", anchorWeek: "lower" };
let view = "active", sort = "date";
try { view = localStorage.getItem("view") || "active"; sort = localStorage.getItem("sort") || "date"; } catch (e) {}
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

// ================== GitHub: чтение и запись ==================
async function ghRead(file) {
  const url = API(file) + "?t=" + Date.now();
  try {
    if (isAdmin) {                                   // админу нужен sha для записи
      const r = await fetch(url);
      if (r.status === 404) return { data: [], sha: null };
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      return { data: JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\s/g, ""))))), sha: j.sha };
    }
    const r = await fetch(url, { headers: { Accept: "application/vnd.github.raw+json" } });
    if (r.status === 404) return { data: [], sha: null };
    if (!r.ok) throw new Error(r.status);
    return { data: await r.json(), sha: null };
  } catch (e) {
    if (isAdmin) throw e;
    const r = await fetch(RAW(file) + "?t=" + Date.now());   // запасной путь, если упёрлись в лимит API
    if (r.status === 404) return { data: [], sha: null };
    if (!r.ok) throw e;
    return { data: await r.json(), sha: null };
  }
}

async function ghWrite(file, data, sha, message) {
  const token = localStorage.getItem("gh_token");
  if (!token) { alert("Сначала введи токен GitHub"); return null; }
  const body = { message, content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))) };
  if (sha) body.sha = sha;
  const r = await fetch(API(file), {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    alert("Ошибка сохранения: " + r.status + (r.status === 409 || r.status === 422 ? ". Закрой и заново открой приложение." : ""));
    return null;
  }
  return (await r.json()).content.sha;
}

async function saveItems() {
  const s = await ghWrite("data.json", items, itemsSha, "update homework");
  if (s) itemsSha = s;
}
async function saveChanges() {
  const limit = ymd(new Date(Date.now() - 30 * 864e5));          // старые замены (>30 дней) чистим
  changes = changes.filter(c => c.date >= limit);
  const s = await ghWrite("changes.json", changes, changesSha, "update schedule changes");
  if (s) changesSha = s;
}

async function load() {
  try {
    const a = await ghRead("data.json");
    items = Array.isArray(a.data) ? a.data : []; itemsSha = a.sha;
  } catch (e) {
    $("list").innerHTML = '<div class="empty">Не удалось загрузить данные</div>';
    return;
  }
  try {
    const b = await ghRead("changes.json");
    changes = Array.isArray(b.data) ? b.data : []; changesSha = b.sha;
  } catch (e) { changes = []; }
  renderAll();
}

// ================== даты и недели ==================
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const dow = d => (d.getDay() + 6) % 7;                                   // 0 = Пн
const mondayOf = d => addDays(d, -dow(d));
const today0 = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
const daysLeft = due => Math.round((parseYmd(due) - today0()) / 864e5);
const fmt = due => parseYmd(due).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
const mins = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

function weekType(date) {
  const idx = Math.round((mondayOf(date) - parseYmd(sched.anchorMonday)) / (7 * 864e5));
  const same = ((idx % 2) + 2) % 2 === 0;
  return same ? sched.anchorWeek : (sched.anchorWeek === "lower" ? "upper" : "lower");
}
const weekName = w => (w === "upper" ? "верхняя" : "нижняя") + " неделя";

// ================== расписание + замены ==================
const lessonsFor = (day, week) => sched.lessons
  .filter(l => l.day === day + 1 && (l.week === "both" || l.week === week))
  .sort((a, b) => a.slot - b.slot);

// пары конкретного дня с учётом замен
function dayEntries(date) {
  const key = ymd(date), wk = weekType(date);
  const base = lessonsFor(dow(date), wk);
  const ch = changes.filter(c => c.date === key);
  const slots = [...new Set([...base.map(l => l.slot), ...ch.map(c => c.slot)])].sort((a, b) => a - b);
  return slots.map(slot => {
    const b = base.find(l => l.slot === slot) || null;
    const c = ch.find(x => x.slot === slot) || null;
    if (!c) return { slot, lesson: b, status: "normal", base: b, change: null };
    if (c.kind === "cancel") return b ? { slot, lesson: b, status: "cancelled", base: b, change: c } : null;
    return { slot, lesson: { slot, subject: c.subject, teacher: c.teacher, room: c.room },
             status: b ? "replaced" : "added", base: b, change: c };
  }).filter(Boolean);
}

const roomText = r => !r ? "" : /^\d/.test(r) ? "ауд. " + r : r;
const TAGS = { cancelled: '<span class="tag red">Отменена</span>', replaced: '<span class="tag orange">Замена</span>', added: '<span class="tag green">Добавлена</span>' };

function lessonRow(e, now, key) {
  const l = e.lesson, [s, end] = sched.slots[e.slot - 1];
  const info = [l.teacher, roomText(l.room)].filter(Boolean).map(esc).join(" · ");
  const was = e.status === "replaced" && e.base
    ? `<div class="was">вместо: ${esc(e.base.subject)}</div>` : "";
  return `<div class="row lesson ${e.status} ${now ? "now" : ""} ${isAdmin ? "editable" : ""}" data-slot="${e.slot}" data-date="${key}">
    <div class="time">${s}<br><span>${end}</span></div>
    <div class="grow">
      <div class="task">${esc(l.subject)}${TAGS[e.status] || ""}${now ? '<span class="nowtag">идёт сейчас</span>' : ""}</div>
      ${was}
      ${info ? `<div class="date">${info}</div>` : ""}
    </div></div>`;
}

function entriesHtml(date) {
  const key = ymd(date), isToday = key === ymd(today0());
  const n = new Date(), nm = n.getHours() * 60 + n.getMinutes();
  return dayEntries(date).map(e => {
    const [s, end] = sched.slots[e.slot - 1];
    const now = isToday && e.status !== "cancelled" && nm >= mins(s) && nm <= mins(end);
    return lessonRow(e, now, key);
  }).join("");
}

// ---- вкладка «Расписание» ----
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
let sDate = ymd(today0());

function initSched() {
  const t = today0();
  sDate = ymd(dow(t) <= 5 ? t : addDays(t, 1));       // в воскресенье показываем понедельник
}

function renderSched() {
  const t = today0(), date = parseYmd(sDate), mon = mondayOf(date);
  $("weekInfo").textContent = "Сейчас " + weekName(weekType(t));
  const days = DAYS.map((_, i) => addDays(mon, i));
  const short = d => d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
  $("weekLabel").textContent = `${short(days[0])} — ${short(days[5])}`;
  $("weekType").textContent = weekName(weekType(date)) + (ymd(mondayOf(t)) === ymd(mon) ? " · эта неделя" : "");

  const chg = new Set(changes.map(c => c.date));
  $("daySeg").innerHTML = days.map((d, i) => {
    const k = ymd(d);
    return `<button data-date="${k}" class="${k === sDate ? "on" : ""} ${k === ymd(t) ? "tod" : ""}">
      <span>${DAYS[i]}</span><b>${d.getDate()}</b><em class="cd ${chg.has(k) ? "" : "off"}"></em></button>`;
  }).join("");

  const entries = dayEntries(date);
  let html = entries.length
    ? `<div class="group-box">${entriesHtml(date)}</div>`
    : '<div class="empty">Пар нет 🎉</div>';
  if (isAdmin) {
    const free = sched.slots.map((_, i) => i + 1).filter(s => !entries.some(e => e.slot === s));
    html += free.length ? '<button class="addpair" id="addPair">＋ Добавить пару</button>' : "";
    html += '<p class="hint">Нажми на пару, чтобы отменить или заменить её на этот день</p>';
  }
  $("schedList").innerHTML = html;
}

// ================== списки предметов и преподавателей ==================
function lists() {
  const subj = {};
  sched.lessons.forEach(l => {
    const s = subj[l.subject] = subj[l.subject] || { teachers: [], room: l.room };
    if (l.teacher && !s.teachers.includes(l.teacher)) s.teachers.push(l.teacher);
  });
  const byRu = (a, b) => a.localeCompare(b, "ru");
  return {
    subj,
    subjects: Object.keys(subj).sort(byRu),
    teachers: [...new Set(sched.lessons.map(l => l.teacher).filter(Boolean))].sort(byRu)
  };
}

function setSel(sel, other, val, list) {
  other.hidden = true; other.value = "";
  if (!val) sel.value = "";
  else if (list.includes(val)) sel.value = val;
  else { sel.value = "__other"; other.hidden = false; other.value = val; }
}

function fillPair(p, subject, teacher) {
  const L = lists();
  const opt = v => `<option value="${esc(v)}">${esc(v)}</option>`;
  p.sub.innerHTML = '<option value="" disabled>Предмет</option>' + L.subjects.map(opt).join("") + '<option value="__other">Другой…</option>';
  p.tea.innerHTML = '<option value="">Без преподавателя</option>' + L.teachers.map(opt).join("") + '<option value="__other">Другой…</option>';
  setSel(p.sub, p.subO, subject, L.subjects);
  setSel(p.tea, p.teaO, teacher, L.teachers);
}

function bindPair(p, onSubject) {
  p.sub.onchange = () => {
    const v = p.sub.value, L = lists();
    p.subO.hidden = v !== "__other";
    if (v && v !== "__other") {
      const info = L.subj[v];
      if (info) setSel(p.tea, p.teaO, info.teachers[0] || "", L.teachers);   // преподаватель подставляется сам
      onSubject && onSubject(info);
    }
  };
  p.tea.onchange = () => { p.teaO.hidden = p.tea.value !== "__other"; };
}

function readPair(p) {
  return {
    subject: (p.sub.value === "__other" ? p.subO.value : p.sub.value).trim(),
    teacher: (p.tea.value === "__other" ? p.teaO.value : p.tea.value).trim()
  };
}

const hw = { sub: $("subject"), subO: $("subjectOther"), tea: $("teacher"), teaO: $("teacherOther") };
const shp = { sub: $("shSubject"), subO: $("shSubjectOther"), tea: $("shTeacher"), teaO: $("shTeacherOther") };
bindPair(hw);
bindPair(shp, info => { if (info) $("shRoom").value = info.room || ""; });

// ================== окно замены ==================
let sh = null;

function openSheet(key, slot, isNew) {
  const entries = dayEntries(parseYmd(key));
  if (isNew) {
    const free = sched.slots.map((_, i) => i + 1).filter(s => !entries.some(e => e.slot === s));
    if (!free.length) return;
    $("shSlot").innerHTML = free.map(s => `<option value="${s}">${s}-я пара · ${sched.slots[s - 1][0]}–${sched.slots[s - 1][1]}</option>`).join("");
    slot = free[0];
  }
  const e = entries.find(x => x.slot === slot) || null;
  const base = e ? e.base : null, change = e ? e.change : null;
  sh = { key, slot, isNew: !!isNew, base, change,
         mode: change ? (change.kind === "cancel" ? "cancel" : "replace") : (base ? "cancel" : "replace") };

  const date = parseYmd(key);
  $("shTitle").textContent = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" });
  $("shSub").textContent = isNew ? "Новая пара на этот день"
    : `${slot}-я пара · ${sched.slots[slot - 1][0]}–${sched.slots[slot - 1][1]}`;
  $("shMode").hidden = !base;
  $("shSlotWrap").hidden = !isNew;
  $("shReset").hidden = !change;

  const src = change && change.kind !== "cancel" ? change : base;
  fillPair(shp, src?.subject || "", src?.teacher || "");
  $("shRoom").value = src?.room || "";
  setMode(sh.mode);
  $("overlay").hidden = false;
}

function setMode(m) {
  sh.mode = m;
  document.querySelectorAll("#shMode button").forEach(b => b.classList.toggle("on", b.dataset.m === m));
  $("shForm").hidden = m === "cancel";
  $("shSave").textContent = m === "cancel" ? "Отменить пару" : (sh.base ? "Сохранить замену" : "Добавить пару");
}

const closeSheet = () => { $("overlay").hidden = true; sh = null; };

async function applySheet() {
  const slot = sh.isNew ? Number($("shSlot").value) : sh.slot;
  const ch = { id: Date.now(), date: sh.key, slot };
  if (sh.mode === "cancel" && sh.base) ch.kind = "cancel";
  else {
    const { subject, teacher } = readPair(shp);
    if (!subject) return alert("Выбери предмет");
    Object.assign(ch, { kind: "replace", subject, teacher, room: $("shRoom").value.trim() });
  }
  changes = changes.filter(c => !(c.date === sh.key && c.slot === slot));
  changes.push(ch);
  closeSheet(); haptic("medium"); renderAll();
  await saveChanges();
}

async function resetSheet() {
  const slot = sh.slot, key = sh.key;
  changes = changes.filter(c => !(c.date === key && c.slot === slot));
  closeSheet(); renderAll();
  await saveChanges();
}

// ================== домашние задания ==================
async function addItem() {
  const { subject, teacher } = readPair(hw);
  const task = $("task").value.trim(), due = $("due").value;
  if (!subject || !task || !due) return alert("Выбери предмет и заполни задание и срок");
  items.push({ id: Date.now(), subject, teacher, task, due });
  $("task").value = ""; $("due").value = "";
  fillPair(hw, "", "");
  $("admin").hidden = true;
  haptic("medium"); renderAll();
  await saveItems();
}

async function del(id) {
  if (!confirm("Удалить задание?")) return;
  items = items.filter(i => i.id !== id);
  renderAll();
  await saveItems();
}

function row(i, showSubject) {
  const old = i.d < 0, urgent = !old && i.d <= 2;
  const when = old ? "срок был " + fmt(i.due)
    : i.d === 0 ? "сегодня" : i.d === 1 ? "завтра" : "до " + fmt(i.due) + " · через " + i.d + " дн.";
  const who = i.teacher ? `<span class="t"> · ${esc(i.teacher)}</span>` : "";
  return `<div class="row ${old ? "old" : ""}">
    <div class="badge ${urgent ? "urgent" : ""} ${old || urgent ? "" : "dot"}">${urgent ? "!" : ""}</div>
    <div class="grow">
      ${showSubject ? `<div class="subj">${esc(i.subject)}${who}</div>` : ""}
      <div class="task">${esc(i.task)}</div>
      <div class="date ${urgent ? "urgent" : ""}">${when}</div>
    </div>
    ${isAdmin ? `<button class="del" data-id="${i.id}">×</button>` : ""}
  </div>`;
}

function render() {
  const all = items.map(i => ({ ...i, d: daysLeft(i.due) }));
  const active = all.filter(i => i.d >= 0).sort((a, b) => a.d - b.d);
  const archive = all.filter(i => i.d < 0).sort((a, b) => b.d - a.d);

  document.querySelector('[data-view="active"]').textContent = "Актуальные" + (active.length ? " · " + active.length : "");
  document.querySelector('[data-view="archive"]').textContent = "Архив" + (archive.length ? " · " + archive.length : "");
  document.querySelectorAll("#viewSeg button").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  document.querySelectorAll("#sortSeg button").forEach(b => b.classList.toggle("on", b.dataset.sort === sort));

  const list = view === "active" ? active : archive;
  if (!list.length) {
    $("list").innerHTML = `<div class="empty">${view === "active" ? "Заданий нет 🎉" : "Архив пуст"}</div>`;
    return;
  }
  if (sort === "date") {
    $("list").innerHTML = `<div class="group-box">${list.map(i => row(i, true)).join("")}</div>`;
    return;
  }
  const groups = {};
  list.forEach(i => {
    const k = i.subject.trim().toLowerCase();
    const g = groups[k] = groups[k] || { name: i.subject.trim(), teacher: "", items: [] };
    if (!g.teacher && i.teacher) g.teacher = i.teacher;
    g.items.push(i);
  });
  $("list").innerHTML = Object.values(groups)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map(g => `<div class="group">${esc(g.name)}${g.teacher ? `<span class="gt">${esc(g.teacher)}</span>` : ""}</div>
      <div class="group-box">${g.items.map(i => row(i, false)).join("")}</div>`)
    .join("");
}

// ================== карточка «сегодня» ==================
function renderHero() {
  const t = new Date(), t0 = today0(), wk = weekType(t0), key = ymd(t0);
  $("heroNum").textContent = t.getDate();
  $("heroDow").textContent = t.toLocaleDateString("ru-RU", { weekday: "long" }).replace(/^./, c => c.toUpperCase());
  $("heroMonth").textContent = t.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }).replace(/^\d+\s*/, "") + " · " + weekName(wk);

  const act = items.map(i => daysLeft(i.due)).filter(d => d >= 0);
  const hot = act.filter(d => d <= 2).length;
  $("heroChips").innerHTML =
    (hot ? `<span class="chip hot"><b>${hot}</b> горит</span>` : "") +
    `<span class="chip"><b>${act.length}</b> ${act.length === 1 ? "актуальное" : "актуальных"}</span>` +
    (changes.some(c => c.date === key) ? '<span class="chip warn">замены сегодня</span>' : "");

  const nm = t.getHours() * 60 + t.getMinutes();
  const all = sched.lessons.length ? dayEntries(t0) : [];
  const live = all.filter(e => e.status !== "cancelled");
  let txt = "Сегодня пар нет";
  if (all.length && !live.length) txt = "Все пары сегодня отменены";
  else if (live.length) {
    const st = e => mins(sched.slots[e.slot - 1][0]), en = e => mins(sched.slots[e.slot - 1][1]);
    const cur = live.find(e => nm >= st(e) && nm <= en(e));
    const nxt = live.find(e => st(e) > nm);
    if (cur) txt = `<em>Сейчас</em> · ${esc(cur.lesson.subject)}`;
    else if (nxt) txt = `<em>Дальше, ${sched.slots[nxt.slot - 1][0]}</em> · ${esc(nxt.lesson.subject)}`;
    else txt = "Пары на сегодня закончились";
  }
  $("heroNext").innerHTML = txt;
}

// ================== календарь ==================
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
let calMonth = new Date(today0().getFullYear(), today0().getMonth(), 1);
let calSel = ymd(today0());

function renderCal() {
  $("calTitle").textContent = `${MONTHS[calMonth.getMonth()]} ${calMonth.getFullYear()}`;
  const byDay = {};
  items.forEach(i => (byDay[i.due] = byDay[i.due] || []).push({ ...i, d: daysLeft(i.due) }));
  const chg = new Set(changes.map(c => c.date));

  const lead = dow(calMonth);
  const total = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
  const todayKey = ymd(today0());
  let html = "";
  for (let i = 0; i < lead; i++) html += '<button class="day out"></button>';
  for (let d = 1; d <= total; d++) {
    const key = `${calMonth.getFullYear()}-${pad(calMonth.getMonth() + 1)}-${pad(d)}`;
    const list = byDay[key] || [];
    const dd = list.length ? list[0].d : 0;
    const cls = dd < 0 ? "past" : dd <= 2 ? "urgent" : "";
    html += `<button class="day ${key === todayKey ? "today" : ""} ${key === calSel ? "sel" : ""}" data-date="${key}">${d}
      <span class="dots">${list.length ? `<i class="${cls}"></i>` : ""}${chg.has(key) ? '<i class="chg"></i>' : ""}</span></button>`;
  }
  $("calGrid").innerHTML = html;

  const date = parseYmd(calSel), key = calSel;
  const head = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" });
  let out = `<div class="dayhead">${head}<small>${weekName(weekType(date))}</small></div>`;
  const tasks = byDay[key] || [];
  const entries = dayEntries(date);
  if (tasks.length) out += `<div class="group">Сдать</div><div class="group-box">${tasks.map(i => row(i, true)).join("")}</div>`;
  if (entries.length) out += `<div class="group">Пары</div><div class="group-box">${entriesHtml(date)}</div>`;
  if (!tasks.length && !entries.length) out += '<div class="empty">В этот день ничего нет</div>';
  $("calDetail").innerHTML = out;
}

// ================== вкладки и события ==================
function renderAll() { render(); renderSched(); renderCal(); renderHero(); }

function showTab(t) {
  $("tasksView").hidden = t !== "tasks";
  $("schedView").hidden = t !== "sched";
  $("calView").hidden = t !== "cal";
  document.querySelectorAll("#tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  window.scrollTo(0, 0);
}

$("tabbar").onclick = e => { const b = e.target.closest("button"); if (b) { haptic(); showTab(b.dataset.tab); } };
$("wPrev").onclick = () => { sDate = ymd(addDays(parseYmd(sDate), -7)); haptic(); renderSched(); };
$("wNext").onclick = () => { sDate = ymd(addDays(parseYmd(sDate), 7)); haptic(); renderSched(); };
$("daySeg").onclick = e => { const b = e.target.closest("button"); if (b) { sDate = b.dataset.date; haptic(); renderSched(); } };
$("calPrev").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCal(); };
$("calNext").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCal(); };
$("calGrid").onclick = e => { const b = e.target.closest(".day[data-date]"); if (b) { calSel = b.dataset.date; haptic(); renderCal(); } };

$("plusBtn").onclick = () => { $("admin").hidden = !$("admin").hidden; haptic(); };
$("addBtn").onclick = addItem;
$("tokenBtn").onclick = () => { const t = prompt("Вставь GitHub токен"); if (t) localStorage.setItem("gh_token", t.trim()); };
$("list").onclick = e => { const b = e.target.closest(".del"); if (b) del(Number(b.dataset.id)); };
$("viewSeg").onclick = e => { const b = e.target.closest("button"); if (b) { view = b.dataset.view; keep("view", view); haptic(); render(); } };
$("sortSeg").onclick = e => { const b = e.target.closest("button"); if (b) { sort = b.dataset.sort; keep("sort", sort); haptic(); render(); } };

// замены: только админ
document.addEventListener("click", e => {
  if (!isAdmin) return;
  if (e.target.closest("#addPair")) return openSheet(sDate, null, true);
  const r = e.target.closest(".row.lesson[data-slot]");
  if (r) openSheet(r.dataset.date, Number(r.dataset.slot), false);
});
$("shMode").onclick = e => { const b = e.target.closest("button"); if (b && sh) setMode(b.dataset.m); };
$("shSave").onclick = applySheet;
$("shReset").onclick = resetSheet;
$("shClose").onclick = closeSheet;
$("overlay").onclick = e => { if (e.target === $("overlay")) closeSheet(); };

async function loadSched() {
  try {
    const r = await fetch(`schedule.json?t=${Date.now()}`);
    if (r.ok) sched = await r.json();
  } catch (e) {}
  initSched();
  fillPair(hw, "", "");
  renderAll();
}

showTab("tasks");
loadSched();
load();
