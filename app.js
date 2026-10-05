const DEFAULTS = {
  age: 30, retireAge: 65, pensionAge: 65, endAge: 95,
  income: 450, raise: 1, pension: 180, severance: 1500,
  living: 200, retireLivingRatio: 80, inflation: 1,
  assets: [{ name: "預貯金", amount: 200, rate: 0.1 }, { name: "投資信託・株式", amount: 100, rate: 4 }],
  debts: [],
  spouse: { enabled: false, age: 30, income: 300, raise: 1, retireAge: 65, pensionAge: 65, pension: 120, severance: 800 },
  childCost: 80,
  children: [],
  housing: { type: "rent", rent: 100, buyAge: 35, price: 4000, down: 400, closing: 200, rate: 1.5, years: 35, upkeep: 30 },
  events: [{ name: "車の購入", age: 35, amount: 250 }, { name: "車の買い替え", age: 45, amount: 250 }],
};
const KEY = "lifeplan.v2";
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString("ja-JP");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function merge(s) {
  const d = structuredClone(DEFAULTS);
  if (!s || typeof s !== "object") return d;
  const out = { ...d, ...s, spouse: { ...d.spouse, ...s.spouse }, housing: { ...d.housing, ...s.housing } };
  // 旧形式(savings 1項目)からの移行
  if (!Array.isArray(s.assets)) out.assets = typeof s.savings === "number" ? [{ name: "貯蓄", amount: s.savings, rate: s.returnRate ?? 2 }] : d.assets;
  out.debts = Array.isArray(s.debts) ? s.debts : [];
  out.children = Array.isArray(s.children) ? s.children : [];
  out.events = Array.isArray(s.events) ? s.events : d.events;
  return out;
}
let state = (() => { try { return merge(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return merge(null); } })();
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

// data-k="spouse.income" のようなパスで state を読み書きする
const inputs = [...document.querySelectorAll("[data-k]")];
function getPath(k) { return k.split(".").reduce((o, key) => o[key], state); }
function setPath(k, v) { const ks = k.split("."), last = ks.pop(); ks.reduce((o, key) => o[key], state)[last] = v; }
function writeInputs() {
  for (const el of inputs) {
    const v = getPath(el.dataset.k);
    if (el.type === "checkbox") el.checked = !!v; else el.value = v;
  }
}
function readInput(el) {
  if (el.type === "checkbox") setPath(el.dataset.k, el.checked);
  else if (el.type === "number") { const v = parseFloat(el.value); setPath(el.dataset.k, Number.isFinite(v) ? v : 0); }
  else setPath(el.dataset.k, el.value);
}

function removable(ul, items, text, onRemove) {
  ul.innerHTML = "";
  items.forEach((item, i) => {
    const li = document.createElement("li");
    const span = document.createElement("span"); span.textContent = text(item);
    const b = document.createElement("button"); b.type = "button"; b.textContent = "削除";
    b.onclick = () => onRemove(i);
    li.append(span, b); ul.append(li);
  });
}

function renderLists() {
  state.events.sort((a, b) => a.age - b.age);
  removable($("eventList"), state.events,
    e => `${e.age}歳 ${e.name}: ${e.amount >= 0 ? "-" : "+"}${fmt(Math.abs(e.amount))}万円`,
    i => { state.events.splice(i, 1); update(); });
  removable($("assetList"), state.assets,
    a => `${a.name}: ${fmt(a.amount)}万円(利回り ${a.rate}%)`, i => { state.assets.splice(i, 1); update(); });
  removable($("debtList"), state.debts,
    d => `ローン ${d.name}: 残高${fmt(d.balance)}万円 / 金利${d.rate}% / 残り${d.years}年`, i => { state.debts.splice(i, 1); update(); });
  removable($("childList"), state.children,
    c => `${c.name}(${c.age < 0 ? -c.age + "年後に誕生" : c.age + "歳"}) ${LifePlan.EDU_COURSES[c.course].label}`,
    i => { state.children.splice(i, 1); update(); });
}

function renderCards(r) {
  const card = (label, val, cls = "") => `<div class="card"><small>${label}</small><strong class="${cls}">${val}</strong></div>`;
  $("cards").innerHTML =
    card("退職時の資産", r.retireBalance === null ? "-" : fmt(r.retireBalance) + "万円", r.retireBalance < 0 ? "bad" : "") +
    card("最終資産", fmt(r.finalBalance) + "万円", r.finalBalance < 0 ? "bad" : "good") +
    card("資産が尽きる年齢", r.depletedAge === null ? "尽きない" : r.depletedAge + "歳", r.depletedAge === null ? "good" : "bad");
}

function renderChart(rows) {
  const W = 700, H = 320, m = { l: 56, r: 12, t: 16, b: 28 };
  let max = Math.max(0, ...rows.map(r => r.balance)), min = Math.min(0, ...rows.map(r => r.balance));
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
  rows.forEach((r, i) => { if (i % step === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="currentColor">${r.age}歳</text>`; });
  const marks = rows.map((r, i) => r.eventNames ?
    `<circle cx="${x(i)}" cy="${y(r.balance)}" r="4" fill="var(--accent)"><title>${r.age}歳 ${esc(r.eventNames)}</title></circle>` : "").join("");
  $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}
    <line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--bad)" stroke-dasharray="4"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>${marks}
    <text x="${m.l}" y="10" font-size="11" fill="currentColor">資産残高(万円)</text></svg>`;
}

const COLS = [
  ["年齢", r => r.age], ["配偶者年齢", r => r.spouseAge ?? ""],
  ["本人給与", r => r.salary], ["配偶者給与", r => r.spouseSalary], ["年金", r => r.pension],
  ["退職金", r => r.severance], ["運用益", r => r.invest], ["収入合計", r => r.incomeTotal],
  ["生活費", r => r.living], ["住居費", r => r.housing], ["子ども費用", r => r.child], ["ローン返済", r => r.debt],
  ["イベント等", r => r.eventCost], ["支出合計", r => r.outgoTotal],
  ["年間収支", r => r.net], ["資産残高", r => r.balance], ["イベント名", r => r.eventNames],
];
const num = v => typeof v === "number" ? Math.round(v) : v;

function renderTable(rows) {
  $("table").innerHTML =
    "<tr>" + COLS.map(c => `<th>${c[0]}</th>`).join("") + "</tr>" +
    rows.map(r => "<tr>" + COLS.map(([name, f], i) => {
      const v = f(r), cls = (name === "資産残高" || name === "年間収支") && v < 0 ? ' class="bad"' : "";
      return `<td${cls}>${typeof v === "number" ? fmt(v) : esc(v)}</td>`;
    }).join("") + "</tr>").join("");
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function toCsv(rows) {
  const q = v => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [COLS.map(c => c[0]).join(",")].concat(rows.map(r => COLS.map(c => q(num(c[1](r)))).join(",")));
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM付きでExcelでも文字化けしない
}

let result;
function update() {
  if (state.endAge < state.age) state.endAge = state.age;
  result = LifePlan.simulate(state);
  renderLists(); renderCards(result); renderChart(result.rows); renderTable(result.rows);
  $("assetInfo").textContent = `資産合計 ${fmt(result.assetTotal)}万円 / 加重平均利回り ${result.returnRate.toFixed(2)}%` +
    (result.debtTotal ? ` / ローン残高合計 ${fmt(result.debtTotal)}万円(純資産 ${fmt(result.assetTotal - result.debtTotal)}万円)` : "");
  document.getElementById("buyFields").style.display = state.housing.type === "buy" ? "" : "none";
  const h = state.housing;
  $("loanInfo").textContent = h.type === "buy"
    ? `借入額 ${fmt(h.price - h.down)}万円 / 年間返済額 約${fmt(LifePlan.annualPayment(h.price - h.down, h.rate, h.years))}万円` : "";
  save();
}

inputs.forEach(el => el.addEventListener("input", () => { readInput(el); update(); }));
$("chCourse").innerHTML = Object.entries(LifePlan.EDU_COURSES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
$("childForm").addEventListener("submit", ev => {
  ev.preventDefault();
  state.children.push({ name: $("chName").value.trim(), age: parseInt($("chAge").value, 10), course: $("chCourse").value });
  ev.target.reset(); update();
});
$("assetForm").addEventListener("submit", ev => {
  ev.preventDefault();
  state.assets.push({ name: $("asName").value.trim(), amount: parseFloat($("asAmount").value), rate: parseFloat($("asRate").value) });
  ev.target.reset(); update();
});
$("debtForm").addEventListener("submit", ev => {
  ev.preventDefault();
  state.debts.push({ name: $("dbName").value.trim(), balance: parseFloat($("dbBalance").value), rate: parseFloat($("dbRate").value), years: parseInt($("dbYears").value, 10) });
  ev.target.reset(); update();
});
$("eventForm").addEventListener("submit", ev => {
  ev.preventDefault();
  state.events.push({ name: $("evName").value.trim(), age: parseInt($("evAge").value, 10), amount: parseFloat($("evAmount").value) });
  ev.target.reset(); update();
});
$("reset").onclick = () => { if (confirm("入力内容を初期値に戻します。よろしいですか?")) { state = merge(null); writeInputs(); update(); } };
$("exportCsv").onclick = () => download("lifeplan-cashflow.csv", toCsv(result.rows), "text/csv;charset=utf-8");
$("print").onclick = () => window.print();
$("exportJson").onclick = () => download("lifeplan-data.json", JSON.stringify(state, null, 2), "application/json");
$("importJson").onclick = () => $("importFile").click();
$("importFile").onchange = async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try { state = merge(JSON.parse(await f.text())); writeInputs(); update(); }
  catch (e) { alert("読み込めませんでした。保存したJSONファイルを選んでください。"); }
  ev.target.value = "";
};

writeInputs(); update();
