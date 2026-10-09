// ====== НАСТРОЙКИ — поменяй три значения ======
const OWNER    = "csgovideo1112-ux";
const REPO     = "homework";
const ADMIN_ID = 1208281651;    
// ==============================================

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
    render();
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
  render();
  await save();
}

async function del(id) {
  if (!confirm("Удалить задание?")) return;
  items = items.filter(i => i.id !== id);
  render();
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

$("plusBtn").onclick = () => { $("admin").hidden = !$("admin").hidden; haptic(); };
$("addBtn").onclick = addItem;
$("tokenBtn").onclick = () => { const t = prompt("Вставь GitHub токен"); if (t) localStorage.setItem("gh_token", t.trim()); };
$("list").onclick = e => { const b = e.target.closest(".del"); if (b) del(Number(b.dataset.id)); };
$("viewSeg").onclick = e => { const b = e.target.closest("button"); if (b) { view = b.dataset.view; keep("view", view); haptic(); render(); } };
$("sortSeg").onclick = e => { const b = e.target.closest("button"); if (b) { sort = b.dataset.sort; keep("sort", sort); haptic(); render(); } };

load();
