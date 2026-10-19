// ====== НАСТРОЙКИ — поменяй три значения ======
const OWNER    = "csgovideo1112-ux";
const REPO     = "homework";
const ADMIN_ID = 1208281651;    
// =============================================

const FILE = "data.json";
const API  = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;
const $ = id => document.getElementById(id);

const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const haptic = t => { try { tg?.HapticFeedback?.impactOccurred(t || "light"); } catch (e) {} };

const isAdmin = tg?.initDataUnsafe?.user?.id === ADMIN_ID;
if (isAdmin) $("plusBtn").hidden = false;

let items = [], sha = null;
let view = "active", sort = "date";
try { view = localStorage.getItem("view") || "active"; sort = localStorage.getItem("sort") || "date"; } catch (e) {}
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

// ---- чтение (все) ----
async function load() {
  try {
    const r = await fetch(`${API}?t=${Date.now()}`, { headers: { Accept: "application/vnd.github.raw+json" } });
    if (!r.ok) throw new Error(r.status);
    items = await r.json();
    if (isAdmin) sha = (await fetch(`${API}?t=${Date.now()}`).then(r => r.json())).sha;
    renderAll();
  } catch (e) {
    $("list").innerHTML = '<div class="empty">Не удалось загрузить данные</div>';
  }
}

// ---- запись (только админ с токеном) ----
async function save() {
  const token = localStorage.getItem("gh_token");
  if (!token) return alert("Сначала введи токен GitHub");
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(items, null, 2))));
  const r = await fetch(API, {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ message: "update homework", content, sha })
  });
  if (!r.ok) return alert("Ошибка сохранения: " + r.status);
  sha = (await r.json()).content.sha;
}

async function addItem() {
  const subject = $("subject").value.trim(), task = $("task").value.trim(), due = $("due").value;
  if (!subject || !task || !due) return alert("Заполни все поля");
  items.push({ id: Date.now(), subject, task, due });
  $("subject").value = $("task").value = $("due").value = "";
  $("admin").hidden = true;
  haptic("medium");
  renderAll();
  await save();
}

async function del(id) {
  if (!confirm("Удалить задание?")) return;
  items = items.filter(i => i.id !== id);
  renderAll();
  await save();
}

// ---- отображение ----
const daysLeft = due => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(due + "T00:00:00") - t) / 864e5);
};
const fmt = due => new Date(due + "T00:00:00")
  .toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

function row(i, showSubject) {
  const old = i.d < 0, urgent = !old && i.d <= 2;
  const when = old ? "срок был " + fmt(i.due)
    : i.d === 0 ? "сегодня" : i.d === 1 ? "завтра" : "до " + fmt(i.due) + " · через " + i.d + " дн.";
  return `<div class="row ${old ? "old" : ""}">
    <div class="badge ${urgent ? "urgent" : ""} ${old ? "" : urgent ? "" : "dot"}">${urgent ? "!" : ""}</div>
    <div class="grow">
      ${showSubject ? `<div class="subj">${esc(i.subject)}</div>` : ""}
      <div class="task">${esc(i.task)}</div>
      <div class="date ${urgent ? "urgent" : ""}">${when}</div>
    </div>
    ${isAdmin ? `<button class="del" data-id="${i.id}">✕</button>` : ""}
  </div>`;
}

function render() {
  const all = items.map(i => ({ ...i, d: daysLeft(i.due) }));
  const active = all.filter(i => i.d >= 0).sort((a, b) => a.d - b.d);
  const archive = all.filter(i => i.d < 0).sort((a, b) => b.d - a.d);   // свежие сверху

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
    (groups[k] = groups[k] || { name: i.subject.trim(), items: [] }).items.push(i);
  });
  $("list").innerHTML = Object.values(groups)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map(g => `<div class="group">${esc(g.name)}</div><div class="group-box">${g.items.map(i => row(i, false)).join("")}</div>`)
    .join("");
}


// ================== РАСПИСАНИЕ И КАЛЕНДАРЬ ==================
let sched = { slots: [], lessons: [], anchorMonday: "2026-10-19", anchorWeek: "lower" };
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт"];
const WEEKS = { upper: "Верхняя", lower: "Нижняя" };
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dow = d => (d.getDay() + 6) % 7;                // 0 = Пн
const mondayOf = d => { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate()); m.setDate(m.getDate() - dow(m)); return m; };

function weekType(date) {
  const [y, m, d] = sched.anchorMonday.split("-").map(Number);
  const idx = Math.round((mondayOf(date) - new Date(y, m - 1, d)) / (7 * 864e5));
  const same = ((idx % 2) + 2) % 2 === 0;
  const other = sched.anchorWeek === "lower" ? "upper" : "lower";
  return same ? sched.anchorWeek : other;
}
const lessonsFor = (day, week) => sched.lessons
  .filter(l => l.day === day + 1 && (l.week === "both" || l.week === week))
  .sort((a, b) => a.slot - b.slot);

const roomText = r => /^\d/.test(r) ? "ауд. " + r : r;
const mins = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

function lessonRow(l, now) {
  const [s, e] = sched.slots[l.slot - 1];
  return `<div class="row lesson ${now ? "now" : ""}">
    <div class="time">${s}<br><span>${e}</span></div>
    <div class="grow">
      <div class="task">${esc(l.subject)}${now ? '<span class="nowtag">идёт сейчас</span>' : ""}</div>
      <div class="date">${esc(l.teacher)} · ${esc(roomText(l.room))}</div>
    </div></div>`;
}

// ---- вкладка «Расписание» ----
const today0 = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
let sWeek = null, sDay = 0;

function initSched() {
  const t = today0(), cur = weekType(t);
  if (dow(t) <= 4) { sDay = dow(t); sWeek = cur; }
  else { sDay = 0; sWeek = cur === "upper" ? "lower" : "upper"; }   // выходные → ближайший понедельник
  $("daySeg").innerHTML = DAYS.map((d, i) => `<button data-day="${i}">${d}</button>`).join("");
}

function renderSched() {
  const t = today0(), cur = weekType(t);
  $("weekInfo").textContent = `Сейчас ${cur === "upper" ? "верхняя" : "нижняя"} неделя`;
  document.querySelectorAll("#weekSeg button").forEach(b => {
    b.classList.toggle("on", b.dataset.week === sWeek);
    b.textContent = WEEKS[b.dataset.week] + (b.dataset.week === cur ? " ·  сейчас" : "");
  });
  document.querySelectorAll("#daySeg button").forEach(b => b.classList.toggle("on", Number(b.dataset.day) === sDay));

  const list = lessonsFor(sDay, sWeek);
  const n = new Date(), nm = n.getHours() * 60 + n.getMinutes();
  const isToday = sDay === dow(t) && sWeek === cur;
  $("schedList").innerHTML = list.length
    ? `<div class="group-box">${list.map(l => {
        const [s, e] = sched.slots[l.slot - 1];
        return lessonRow(l, isToday && nm >= mins(s) && nm <= mins(e));
      }).join("")}</div>`
    : '<div class="empty">Пар нет 🎉</div>';
}

// ---- вкладка «Календарь» ----
let calMonth = new Date(today0().getFullYear(), today0().getMonth(), 1);
let calSel = ymd(today0());

function renderCal() {
  $("calTitle").textContent = `${MONTHS[calMonth.getMonth()]} ${calMonth.getFullYear()}`;
  const byDay = {};
  items.forEach(i => (byDay[i.due] = byDay[i.due] || []).push({ ...i, d: daysLeft(i.due) }));

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
    html += `<button class="day ${key === todayKey ? "today" : ""} ${key === calSel ? "sel" : ""} ${list.length ? "has" : ""}" data-date="${key}">${d}<i class="${cls}"></i></button>`;
  }
  $("calGrid").innerHTML = html;

  // подробности выбранного дня
  const [y, m, d] = calSel.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const wk = weekType(date);
  const head = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" });
  let out = `<div class="dayhead">${head} · ${wk === "upper" ? "верхняя" : "нижняя"} неделя</div>`;
  const tasks = (byDay[calSel] || []);
  const lessons = dow(date) <= 4 ? lessonsFor(dow(date), wk) : [];
  if (tasks.length) out += `<div class="group">Сдать</div><div class="group-box">${tasks.map(i => row(i, true)).join("")}</div>`;
  if (lessons.length) out += `<div class="group">Пары</div><div class="group-box">${lessons.map(l => lessonRow(l, false)).join("")}</div>`;
  if (!tasks.length && !lessons.length) out += '<div class="empty">В этот день ничего нет</div>';
  $("calDetail").innerHTML = out;
}

// ---- вкладки и события ----
let tab = "tasks";
function renderAll() { render(); renderSched(); renderCal(); }
function showTab(t) {
  tab = t;
  $("tasksView").hidden = t !== "tasks";
  $("schedView").hidden = t !== "sched";
  $("calView").hidden = t !== "cal";
  document.querySelectorAll("#tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  window.scrollTo(0, 0);
}

$("tabbar").onclick = e => { const b = e.target.closest("button"); if (b) { haptic(); showTab(b.dataset.tab); } };
$("weekSeg").onclick = e => { const b = e.target.closest("button"); if (b) { sWeek = b.dataset.week; haptic(); renderSched(); } };
$("daySeg").onclick = e => { const b = e.target.closest("button"); if (b) { sDay = Number(b.dataset.day); haptic(); renderSched(); } };
$("calPrev").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCal(); };
$("calNext").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCal(); };
$("calGrid").onclick = e => { const b = e.target.closest(".day[data-date]"); if (b) { calSel = b.dataset.date; haptic(); renderCal(); } };

$("plusBtn").onclick = () => { $("admin").hidden = !$("admin").hidden; haptic(); };
$("addBtn").onclick = addItem;
$("tokenBtn").onclick = () => { const t = prompt("Вставь GitHub токен"); if (t) localStorage.setItem("gh_token", t.trim()); };
$("list").onclick = e => { const b = e.target.closest(".del"); if (b) del(Number(b.dataset.id)); };
$("viewSeg").onclick = e => { const b = e.target.closest("button"); if (b) { view = b.dataset.view; keep("view", view); haptic(); render(); } };
$("sortSeg").onclick = e => { const b = e.target.closest("button"); if (b) { sort = b.dataset.sort; keep("sort", sort); haptic(); render(); } };

async function loadSched() {
  try {
    const r = await fetch(`schedule.json?t=${Date.now()}`);
    if (r.ok) sched = await r.json();
  } catch (e) {}
  initSched();
  renderSched(); renderCal();
}

showTab("tasks");
loadSched();
load();
