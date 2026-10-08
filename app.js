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

const isAdmin = tg?.initDataUnsafe?.user?.id === ADMIN_ID;
if (isAdmin) $("admin").hidden = false;

let items = [], sha = null;

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

// ---- чтение (все) ----
async function load() {
  try {
    const r = await fetch(`${API}?t=${Date.now()}`, {
      headers: { Accept: "application/vnd.github.raw+json" }
    });
    if (!r.ok) throw new Error(r.status);
    items = await r.json();
    if (isAdmin) {
      const meta = await fetch(`${API}?t=${Date.now()}`).then(r => r.json());
      sha = meta.sha;
    }
    render();
  } catch (e) {
    $("list").textContent = "Не удалось загрузить данные. Попробуй позже.";
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

function setToken() {
  const t = prompt("Вставь GitHub токен");
  if (t) localStorage.setItem("gh_token", t.trim());
}

async function addItem() {
  const subject = $("subject").value.trim();
  const task = $("task").value.trim();
  const due = $("due").value;
  if (!subject || !task || !due) return alert("Заполни все поля");
  items.push({ id: Date.now(), subject, task, due });
  $("subject").value = $("task").value = $("due").value = "";
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
function daysLeft(due) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(due + "T00:00:00") - today) / 864e5);
}

function render() {
  const list = items
    .map(i => ({ ...i, d: daysLeft(i.due) }))
    .filter(i => isAdmin || i.d >= 0)
    .sort((a, b) => a.d - b.d);

  $("list").innerHTML = list.length ? list.map(i => {
    const urgent = i.d >= 0 && i.d <= 2;
    const label = i.d < 0 ? "просрочено" : i.d === 0 ? "сегодня"
                : i.d === 1 ? "завтра" : "через " + i.d + " дн.";
    return `<div class="card ${urgent ? "urgent" : ""} ${i.d < 0 ? "over" : ""}">
      ${urgent ? '<div class="mark">❗</div>' : ""}
      <div class="grow">
        <div class="subj">${esc(i.subject)}</div>
        <div>${esc(i.task)}</div>
        <div class="date">до ${i.due.split("-").reverse().join(".")} · ${label}</div>
      </div>
      ${isAdmin ? `<button class="del" data-id="${i.id}">✕</button>` : ""}
    </div>`;
  }).join("") : "Заданий нет 🎉";
}

$("addBtn").onclick = addItem;
$("tokenBtn").onclick = setToken;
$("list").onclick = e => {
  const b = e.target.closest(".del");
  if (b) del(Number(b.dataset.id));
};

load();
