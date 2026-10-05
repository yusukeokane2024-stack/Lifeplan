const DEFAULTS = {
  age: 30, retireAge: 65, pensionAge: 65, endAge: 95,
  savings: 300, income: 450, raise: 1, living: 300, retireLivingRatio: 80,
  inflation: 1, returnRate: 2, pension: 180, severance: 1500,
  events: [
    { name: "結婚", age: 33, amount: 300 },
    { name: "住宅購入(頭金)", age: 38, amount: 600 },
    { name: "子の教育費", age: 45, amount: 400 },
  ],
};
const FIELDS = ["age","retireAge","pensionAge","endAge","savings","income","raise","living","retireLivingRatio","inflation","returnRate","pension","severance"];
const KEY = "lifeplan.v1";
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString("ja-JP");

let state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.events)) return { ...DEFAULTS, ...s };
  } catch (e) {}
  return structuredClone(DEFAULTS);
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

function readInputs() {
  for (const f of FIELDS) {
    const v = parseFloat($(f).value);
    state[f] = Number.isFinite(v) ? v : 0;
  }
}
function writeInputs() { for (const f of FIELDS) $(f).value = state[f]; }

function renderEvents() {
  const ul = $("eventList");
  ul.innerHTML = "";
  state.events.sort((a, b) => a.age - b.age).forEach((e, i) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = `${e.age}歳 ${e.name}: ${e.amount >= 0 ? "-" : "+"}${fmt(Math.abs(e.amount))}万円`;
    const b = document.createElement("button");
    b.textContent = "削除"; b.type = "button";
    b.onclick = () => { state.events.splice(i, 1); update(); };
    li.append(span, b); ul.append(li);
  });
}

function renderCards(r) {
  const card = (label, val, cls = "") => `<div class="card"><small>${label}</small><strong class="${cls}">${val}</strong></div>`;
  $("cards").innerHTML =
    card("退職時の資産", r.retireBalance === null ? "-" : fmt(r.retireBalance) + "万円", r.retireBalance < 0 ? "bad" : "") +
    card("最終資産", fmt(r.finalBalance) + "万円", r.finalBalance < 0 ? "bad" : "good") +
    card("資産が尽きる年齢", r.depletedAge === null ? "尽きない" : r.depletedAge + "歳", r.depletedAge === null ? "good" : "bad");
}

function renderChart(rows) {
  const W = 700, H = 320, m = { l: 56, r: 12, t: 12, b: 28 };
  const vals = rows.map(r => r.balance);
  let max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  if (max === min) max = min + 1;
  const x = i => m.l + (W - m.l - m.r) * (rows.length > 1 ? i / (rows.length - 1) : 0);
  const y = v => m.t + (H - m.t - m.b) * (1 - (v - min) / (max - min));
  const path = rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.balance).toFixed(1)}`).join("");
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = min + (max - min) * k / 4;
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/>` +
         `<text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="currentColor">${fmt(v)}</text>`;
  }
  const step = Math.max(1, Math.ceil(rows.length / 8));
  rows.forEach((r, i) => {
    if (i % step === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="currentColor">${r.age}歳</text>`;
  });
  const marks = rows.filter(r => r.eventNames).map(r => {
    const i = rows.indexOf(r);
    return `<circle cx="${x(i)}" cy="${y(r.balance)}" r="4" fill="var(--accent)"><title>${r.age}歳 ${r.eventNames.replace(/[<&]/g, "")}</title></circle>`;
  }).join("");
  $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}
    <line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--bad)" stroke-dasharray="4"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>${marks}
    <text x="${m.l}" y="10" font-size="11" fill="currentColor">資産残高(万円)</text></svg>`;
}

function renderTable(rows) {
  const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  $("table").innerHTML =
    "<tr><th>年齢</th><th>収入</th><th>運用益</th><th>生活費</th><th>イベント支出</th><th>資産残高</th><th>イベント</th></tr>" +
    rows.map(r => `<tr><td>${r.age}</td><td>${fmt(r.income)}</td><td>${fmt(r.invest)}</td><td>${fmt(r.living)}</td>` +
      `<td>${fmt(r.eventCost)}</td><td class="${r.balance < 0 ? "bad" : ""}">${fmt(r.balance)}</td><td>${esc(r.eventNames)}</td></tr>`).join("");
}

function update() {
  if (state.endAge < state.age) state.endAge = state.age;
  const r = LifePlan.simulate(state);
  renderEvents(); renderCards(r); renderChart(r.rows); renderTable(r.rows);
  save();
}

FIELDS.forEach(f => $(f).addEventListener("input", () => { readInputs(); update(); }));
$("eventForm").addEventListener("submit", ev => {
  ev.preventDefault();
  state.events.push({ name: $("evName").value.trim(), age: parseInt($("evAge").value, 10), amount: parseFloat($("evAmount").value) });
  ev.target.reset(); update();
});
$("reset").onclick = () => { state = structuredClone(DEFAULTS); writeInputs(); update(); };

writeInputs(); update();
