const DEFAULTS = {
  age: 30, retireAge: 65, pensionAge: 65, endAge: 95,
  income: 450, raise: 1, severance: 1500,
  pensionMode: "auto", job: "employee", startAge: 22, kouseiEnd: 0, avgGross: 600, pension: 180,
  livingItems: [
    { name: "食費", monthly: 6 }, { name: "水道光熱費", monthly: 2 }, { name: "通信費", monthly: 1 },
    { name: "日用品", monthly: 1 }, { name: "被服・美容", monthly: 1 }, { name: "交際・娯楽", monthly: 3 },
    { name: "保険・医療", monthly: 2 }, { name: "その他", monthly: 1 },
  ],
  retireLivingRatio: 80, inflation: 1,
  assets: [
    { name: "預貯金", type: "cash", amount: 200, rate: 0.1, monthly: 0, until: 0 },
    { name: "投資信託・株式", type: "invest", amount: 100, rate: 4, monthly: 3, until: 0 },
  ],
  debts: [],
  spouse: { enabled: false, age: 30, income: 300, raise: 1, retireAge: 65, pensionAge: 65, severance: 800,
    pensionMode: "auto", job: "employee", startAge: 22, kouseiEnd: 0, avgGross: 400, pension: 120 },
  childCost: 80,
  children: [],
  housing: { type: "rent", rent: 100, buyAge: 35, price: 4000, down: 400, closing: 200, rate: 1.5, years: 35, upkeep: 30,
    ownMode: "auto", ownBorrow: 3000, ownBorrowYear: new Date().getFullYear() - 5, ownTerm: 35,
    ownLoan: 2500, ownRate: 1.2, ownYears: 25, ownMgmt: 2, ownTax: 12, ownRepair: 20 },
  incomeChanges: [],
  moves: [],
  events: [{ name: "車の購入", age: 35, amount: 250 }, { name: "車の買い替え", age: 45, amount: 250 }],
};
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString("ja-JP");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function merge(s) {
  const d = structuredClone(DEFAULTS);
  if (!s || typeof s !== "object") { d.living = d.livingItems.reduce((t, it) => t + it.monthly, 0) * 12; return d; }
  const out = { ...d, ...s, spouse: { ...d.spouse, ...s.spouse }, housing: { ...d.housing, ...s.housing } };
  // 旧形式(年金額を手入力のみ)からの移行: 保存済みの年金額があれば手入力のままにする
  if (!s.pensionMode && typeof s.pension === "number") out.pensionMode = "manual";
  if (s.spouse && !s.spouse.pensionMode && typeof s.spouse.pension === "number") out.spouse.pensionMode = "manual";
  // 旧形式(savings 1項目)からの移行
  if (!Array.isArray(s.assets)) out.assets = typeof s.savings === "number" ? [{ name: "貯蓄", type: "cash", amount: s.savings, rate: s.returnRate ?? 2 }] : d.assets;
  // 旧形式(年間生活費 living)からの移行
  if (!Array.isArray(s.livingItems)) out.livingItems = typeof s.living === "number" ? [{ name: "生活費", monthly: Math.round(s.living / 12 * 10) / 10 }] : d.livingItems;
  // 資産の種類・積立の項目がない旧データを補う(利回りが低ければ預貯金、そうでなければ投資とみなす)
  out.assets = out.assets.map(a => ({ monthly: 0, until: 0, ...a, type: a.type || (a.rate < 1 ? "cash" : "invest") }));
  // 旧形式(ローン残高・残り年数を直接入力)は、そのまま「残高を直接入力」として引き継ぐ
  if (s.housing && !s.housing.ownMode) out.housing.ownMode = "balance";
  out.debts = (Array.isArray(s.debts) ? s.debts : []).map(d => ({ mode: "balance", ...d }));
  out.children = Array.isArray(s.children) ? s.children : [];
  out.incomeChanges = Array.isArray(s.incomeChanges) ? s.incomeChanges : [];
  out.moves = Array.isArray(s.moves) ? s.moves : [];
  out.events = Array.isArray(s.events) ? s.events : d.events;
  out.living = out.livingItems.reduce((t, it) => t + it.monthly, 0) * 12; // 年間生活費は月額の合計から算出
  return out;
}

// ---- 受講生ごとのプラン保存(この端末のブラウザ内) ----
const STORE_KEY = "lifeplan.profiles.v1", LEGACY_KEY = "lifeplan.v2";
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// dirty: まだサーバーに送っていない変更がある / syncedMs: サーバーと最後にそろった時点の更新時刻
function newProfile(name, data) { return { id: uid(), name, memo: "", createdAt: Date.now(), updatedAt: Date.now(), data: data || merge(null), dirty: true, syncedMs: 0 }; }
// 名前・メモなどを変えたとき: 更新日時を進めて、同期の対象にする
function touchProfile(p) { p.updatedAt = Math.max(Date.now(), (p.syncedMs || 0) + 1); p.dirty = true; persist(); if (typeof scheduleSync === "function") scheduleSync(); }
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.profiles) && s.profiles.length) {
      if (!s.profiles.some(p => p.id === s.currentId)) s.currentId = s.profiles[0].id;
      s.deleted = Array.isArray(s.deleted) ? s.deleted : [];
      return s;
    }
  } catch (e) {}
  // 旧形式(プランが1つだけ)からの移行
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)); } catch (e) {}
  const p = newProfile((legacy && legacy.reportName) || "受講生 1", legacy ? merge(legacy) : null);
  return { currentId: p.id, profiles: [p], deleted: [], owner: null };
}
let store = loadStore();
const currentProfile = () => store.profiles.find(p => p.id === store.currentId);
let state = merge(currentProfile().data);
let lastSig = JSON.stringify(state), quietSave = true; // 開いただけでは「最終更新」を変えない
function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {} }
function save() {
  const p = currentProfile(), sig = JSON.stringify(state);
  let changed = false;
  if (sig !== lastSig) { if (!quietSave) { p.updatedAt = Math.max(Date.now(), (p.syncedMs || 0) + 1); p.dirty = true; changed = true; } lastSig = sig; }
  p.data = state;
  persist();
  if (changed && typeof scheduleSync === "function") scheduleSync();
}

// data-k="spouse.income" のようなパスで state を読み書きする
const inputs = [...document.querySelectorAll("[data-k]")];
function getPath(k) { return k.split(".").reduce((o, key) => o[key], state); }
function setPath(k, v) { const ks = k.split("."), last = ks.pop(); ks.reduce((o, key) => o[key], state)[last] = v; }
// state → 画面の入力欄。質問画面と詳細設定で同じ項目を共有するため、入力中の欄以外をそろえる。
function writeInputs(skipActive = false) {
  for (const el of inputs) {
    if (skipActive && el === document.activeElement) continue;
    const v = getPath(el.dataset.k);
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v === 0 && el.placeholder ? "" : v; // 空欄に意味がある欄(0=未設定)は空欄に戻す
  }
}
function readInput(el) {
  if (el.type === "checkbox") setPath(el.dataset.k, el.checked);
  else if (el.type === "number") { const v = parseFloat(el.value); setPath(el.dataset.k, Number.isFinite(v) ? v : 0); }
  else setPath(el.dataset.k, el.value);
}

// 編集できる一覧。入力中のフォーカスを保つため、追加・削除・並べ替えのときだけ作り直す。
function renderEditable(box, items, fields, onResort) {
  box.innerHTML = "";
  items.forEach((item, i) => {
    const card = document.createElement("div"); card.className = "item-card";
    const head = document.createElement("div"); head.className = "item-head";
    const grid = document.createElement("div"); grid.className = "item-grid";
    fields.forEach((f, fi) => {
      if (f.show && !f.show(item)) return; // 条件に合わない項目は表示しない
      let el;
      if (f.type === "select") {
        el = document.createElement("select");
        f.options.forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; el.append(o); });
        el.value = item[f.key];
      } else {
        el = document.createElement("input");
        el.type = f.type === "text" ? "text" : "number";
        if (f.step) el.step = f.step;
        if (f.min !== undefined) el.min = f.min;
        if (f.placeholder) el.placeholder = f.placeholder;
        if (f.type === "number" && !f.signed) el.inputMode = /\./.test(f.step || "") ? "decimal" : "numeric";
        el.value = f.blank && !item[f.key] ? "" : item[f.key];
      }
      el.setAttribute("aria-label", f.label || "名称");
      el.addEventListener("input", () => {
        item[f.key] = f.type === "number" ? (parseFloat(el.value) || 0) : el.value;
        update();
      });
      if (f.resort) el.addEventListener("change", () => {
        // 並び順が変わらないときは作り直さない(次の欄をタップした直後に、入力欄が消えてしまうのを防ぐ)。選択肢の切り替えは、表示項目が変わるので作り直す
        if (f.type !== "select" && items.every((it, i) => i === 0 || items[i - 1][f.key] <= it[f.key])) return;
        onResort();
      });
      if (fi === 0) { el.placeholder = "名称"; head.append(el); return; }
      const lab = document.createElement("label"); if (f.full) lab.className = "full"; lab.append(f.label, el); grid.append(lab);
    });
    const del = document.createElement("button"); del.type = "button"; del.textContent = "削除"; del.className = "del";
    del.onclick = () => { items.splice(i, 1); refresh(); };
    head.append(del); card.append(head, grid); box.append(card);
  });
}
const ASSET_FIELDS = [
  { key: "name", type: "text" },
  { key: "type", type: "select", label: "種類", options: [["cash", "預貯金"], ["invest", "投資"]] },
  { key: "amount", type: "number", label: "現在の金額(万円)", step: "10", min: 0 },
  { key: "rate", type: "number", label: "想定利回り(%/年)", step: "0.1" },
  { key: "monthly", type: "number", label: "毎月の積立(万円)", step: "0.5", min: 0 },
  { key: "until", type: "number", label: "積立を続ける年齢", placeholder: "空欄=退職まで", blank: true, min: 0, full: true },
];
const DEBT_FIELDS = [
  { key: "name", type: "text" },
  { key: "mode", type: "select", label: "入力方法", full: true, resort: true, options: [["auto", "借入時の条件から自動計算"], ["balance", "いまの残高を直接入力"]] },
  { key: "borrow", type: "number", label: "借入額(万円)", step: "10", min: 0, show: d => d.mode === "auto" },
  { key: "borrowYear", type: "number", label: "借入した年(西暦)", min: 1980, show: d => d.mode === "auto" },
  { key: "term", type: "number", label: "返済期間(総年数)", min: 1, show: d => d.mode === "auto" },
  { key: "rate", type: "number", label: "金利(%/年)", step: "0.1" },
  { key: "balance", type: "number", label: "いまの残高(万円)", step: "10", min: 0, show: d => d.mode !== "auto" },
  { key: "years", type: "number", label: "残り年数", min: 0, show: d => d.mode !== "auto" },
];
const CHILD_FIELDS = [
  { key: "name", type: "text" },
  { key: "age", type: "number", label: "年齢(生まれる前は負の数)", signed: true },
  { key: "course", type: "select", label: "進路", full: true, options: Object.entries(LifePlan.EDU_COURSES).map(([k, v]) => [k, v.label]) },
];
const INCOME_FIELDS = [
  { key: "name", type: "text" },
  { key: "who", type: "select", label: "対象", options: [["me", "本人"], ["spouse", "配偶者"]] },
  { key: "from", type: "number", label: "開始年齢", min: 0, resort: true },
  { key: "to", type: "number", label: "終了年齢(空欄=退職まで)", placeholder: "空欄", blank: true, min: 0 },
  { key: "income", type: "number", label: "変化後の年間手取り(万円)", step: "10", min: 0 },
  { key: "raise", type: "number", label: "その後の昇給率(%/年)", step: "0.1", signed: true },
];
const MOVE_FIELDS = [
  { key: "name", type: "text" },
  { key: "age", type: "number", label: "住み替える年齢", min: 0, resort: true },
  { key: "type", type: "select", label: "新しい住まい", resort: true, options: [["buy", "購入する(買い替え)"], ["rent", "賃貸に引っ越す"]] },
  { key: "rent", type: "number", label: "新居の家賃(年額)", step: "10", min: 0, show: m => m.type === "rent" },
  { key: "price", type: "number", label: "物件価格", show: m => m.type === "buy", step: "100", min: 0 },
  { key: "down", type: "number", label: "頭金", show: m => m.type === "buy", step: "50", min: 0 },
  { key: "closing", type: "number", label: "諸費用", show: m => m.type === "buy", step: "10", min: 0 },
  { key: "rate", type: "number", label: "ローン金利(%/年)", step: "0.1", show: m => m.type === "buy" },
  { key: "years", type: "number", label: "返済年数", min: 1, show: m => m.type === "buy" },
  { key: "upkeep", type: "number", label: "管理・修繕・税(年額)", step: "5", min: 0, show: m => m.type === "buy" },
  { key: "salePrice", type: "number", label: "旧居の売却価格(いま持ち家の場合)", step: "100", min: 0, full: true },
  { key: "sellCost", type: "number", label: "売却にかかる費用(仲介手数料など)", step: "10", min: 0, full: true },
];
const EVENT_FIELDS = [
  { key: "name", type: "text" },
  { key: "age", type: "number", label: "年齢", min: 0, resort: true },
  { key: "amount", type: "number", label: "金額(万円・収入は負の数)", signed: true },
];
function refresh() { renderLiving(); renderLists(); update(); }

// 生活費の項目行。入力中のフォーカスを保つため、追加・削除時だけ作り直す。
function renderLiving() {
  const box = $("livingRows");
  box.innerHTML = "";
  state.livingItems.forEach((it, i) => {
    const row = document.createElement("div"); row.className = "living-row";
    const name = document.createElement("input"); name.value = it.name; name.placeholder = "項目名";
    name.oninput = () => { it.name = name.value; save(); };
    const amt = document.createElement("input"); amt.type = "number"; amt.inputMode = "decimal"; amt.step = "0.1"; amt.min = "0";
    amt.value = it.monthly; amt.setAttribute("aria-label", it.name + "の月額(万円)");
    amt.oninput = () => { it.monthly = parseFloat(amt.value) || 0; update(); };
    const del = document.createElement("button"); del.type = "button"; del.textContent = "削除";
    del.onclick = () => { state.livingItems.splice(i, 1); refresh(); };
    row.append(name, amt, del); box.append(row);
  });
}

function renderLists() {
  state.events.sort((x, y) => x.age - y.age);
  state.incomeChanges.sort((x, y) => x.from - y.from);
  renderEditable($("incomeList"), state.incomeChanges, INCOME_FIELDS, renderLists);
  state.moves.sort((x, y) => x.age - y.age);
  renderEditable($("moveList"), state.moves, MOVE_FIELDS, renderLists);
  renderEditable($("eventList"), state.events, EVENT_FIELDS, renderLists);
  renderEditable($("assetList"), state.assets, ASSET_FIELDS);
  renderEditable($("debtList"), state.debts, DEBT_FIELDS, renderLists);
  renderEditable($("childList"), state.children, CHILD_FIELDS);
}

function renderCards(r) {
  const card = (label, val, cls = "") => `<div class="card"><small>${label}</small><strong class="${cls}">${val}</strong></div>`;
  $("cards").innerHTML =
    card("退職時の資産", r.retireBalance === null ? "-" : fmt(r.retireBalance) + "万円", r.retireBalance < 0 ? "bad" : "") +
    card("最終資産", fmt(r.finalBalance) + "万円", r.finalBalance < 0 ? "bad" : "good") +
    card("資産枯渇年齢", r.depletedAge === null ? "尽きない" : r.depletedAge + "歳", r.depletedAge === null ? "good" : "bad");
}

function renderChart(rows) {
  const W = 700, H = 320, m = { l: 56, r: 14, t: 18, b: 30 };
  let max = Math.max(0, ...rows.map(r => r.balance)), min = Math.min(0, ...rows.map(r => r.balance));
  if (max === min) max = min + 1;
  const x = i => m.l + (W - m.l - m.r) * (rows.length > 1 ? i / (rows.length - 1) : 0);
  const y = v => m.t + (H - m.t - m.b) * (1 - (v - min) / (max - min));
  const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r.balance).toFixed(1)}`);
  const line = "M" + pts.join("L");
  const hasInvest = rows.some(r => r.investBal > 1);
  const investLine = hasInvest ? "M" + rows.map((r, i) => `${x(i).toFixed(1)},${y(Math.max(r.investBal, 0)).toFixed(1)}`).join("L") : "";
  const area = `${line}L${x(rows.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = min + (max - min) * k / 4;
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/>` +
         `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="axis">${fmt(v)}</text>`;
  }
  const step = Math.max(1, Math.ceil(rows.length / 7));
  rows.forEach((r, i) => { if (i % step === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="axis">${r.age}歳</text>`; });
  const marks = rows.map((r, i) => r.eventNames ?
    `<circle cx="${x(i)}" cy="${y(r.balance)}" r="5" class="mark"><title>${r.age}歳 ${esc(r.eventNames)}</title></circle>` : "").join("");
  $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:var(--accent);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>
    ${g}<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" class="zero-line"/>
    <path d="${area}" fill="url(#areaG)"/>${hasInvest ? `<path d="${investLine}" class="series2"/>` : ""}<path d="${line}" class="series"/>${marks}
    <text x="${m.l}" y="10" class="axis">資産残高(万円)${hasInvest ? "  ―合計  ┄うち投資" : ""}</text></svg>`;
}

function renderVerdict(r) {
  const el = $("verdict");
  if (r.depletedAge === null) {
    el.className = "verdict ok";
    el.innerHTML = `<div class="verdict-icon">🎉</div><div><strong>${state.endAge}歳まで、資産は尽きない見込みです</strong><span>退職時の資産は約${fmt(r.retireBalance ?? r.finalBalance)}万円。条件を変えると、結果がすぐに変わります。</span></div>`;
  } else {
    el.className = "verdict ng";
    el.innerHTML = `<div class="verdict-icon">⚠️</div><div><strong>${r.depletedAge}歳ごろに、資産が尽きる見込みです</strong><span>生活費や住居費の見直し、働く期間を延ばす、運用を増やす、などで変わります。条件を変えて試してみましょう。</span></div>`;
  }
}

const COLS = [
  ["年齢", r => r.age], ["配偶者年齢", r => r.spouseAge ?? ""],
  ["本人給与", r => r.salary], ["配偶者給与", r => r.spouseSalary], ["年金", r => r.pension],
  ["退職金", r => r.severance], ["運用益", r => r.invest], ["収入合計", r => r.incomeTotal],
  ["生活費", r => r.living], ["住居費", r => r.housing], ["子ども費用", r => r.child], ["ローン返済", r => r.debt],
  ["イベント等", r => r.eventCost], ["支出合計", r => r.outgoTotal],
  ["年間収支", r => r.net], ["積立額", r => r.contrib], ["資産残高", r => r.balance], ["預貯金残高", r => r.cashBal], ["投資残高", r => r.investBal], ["イベント名", r => r.eventNames],
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
  state.living = state.livingItems.reduce((t, it) => t + it.monthly, 0) * 12; // 年間生活費は月額の合計から算出
  $("livingTotal").textContent = `月額合計 ${(state.living / 12).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円 / 年額 ${fmt(state.living)}万円`;
  result = LifePlan.simulate(state);
  renderVerdict(result); renderCards(result); renderChart(result.rows); renderTable(result.rows);
  const cashSum = state.assets.filter(x => x.type !== "invest").reduce((t, x) => t + x.amount, 0);
  $("assetInfo").textContent = `資産合計 ${fmt(result.assetTotal)}万円(預貯金 ${fmt(cashSum)}万円 / 投資 ${fmt(result.assetTotal - cashSum)}万円)` +
    (result.monthlyContrib ? ` / 毎月の積立 ${result.monthlyContrib.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円` : "") +
    (result.debtTotal ? ` / ローン残高合計 ${fmt(result.debtTotal)}万円(純資産 ${fmt(result.assetTotal - result.debtTotal)}万円)` : "");
  if (result.monthlyContrib > 0) {
    const base = LifePlan.simulate({ ...state, assets: state.assets.map(x => ({ ...x, monthly: 0 })) });
    const diff = result.finalBalance - base.finalBalance;
    $("effect").innerHTML = `📈 毎月${result.monthlyContrib.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円の積立で、積立をしない場合より<b>最終資産が約${fmt(Math.abs(diff))}万円${diff >= 0 ? "多く" : "少なく"}</b>なる見込みです。`;
  } else {
    $("effect").textContent = "💡 毎月の積立を設定すると、資産形成の効果を確認できます(「現在の資産・負債」から設定)。";
  }
  for (const [key, person, est] of [["Me", state, result.myPension], ["Sp", state.spouse, result.spousePension]]) {
    const auto = person.pensionMode !== "manual";
    $("auto" + key).style.display = auto && person.job === "employee" ? "" : "none";
    $("manual" + key).style.display = auto ? "none" : "";
    $("pensionInfo" + key).textContent = auto
      ? `見積額: 年${est.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円(月${(est / 12).toFixed(1)}万円)。` +
        (person.job === "employee"
        ? (person.kouseiEnd > 0 && person.kouseiEnd < 65 ? `厚生年金は${person.startAge}〜${person.kouseiEnd}歳の分のみ。以降は国民年金です。` : "")
        : "働き方が会社員・公務員以外のため、国民年金(基礎年金)のみの見積もりです。")
      : "";
  }
  const ht = state.housing.type;
  $("buyFields").style.display = ht === "buy" ? "" : "none";
  $("ownFields").style.display = ht === "own" ? "" : "none";
  $("rentLabel").style.display = ht === "own" ? "none" : "";
  const h = state.housing;
  $("ownAuto").style.display = h.ownMode === "balance" ? "none" : "";
  $("ownBal").style.display = h.ownMode === "balance" ? "" : "none";
  let loanText = "";
  if (h.type === "buy") loanText = `借入額 ${fmt(h.price - h.down)}万円 / 年間返済額 約${fmt(LifePlan.annualPayment(h.price - h.down, h.rate, h.years))}万円`;
  else if (h.type === "own") {
    const st = LifePlan.loanStatus({ mode: h.ownMode === "balance" ? "balance" : "auto", borrow: h.ownBorrow, borrowYear: h.ownBorrowYear, term: h.ownTerm, rate: h.ownRate, balance: h.ownLoan, years: h.ownYears }, new Date().getFullYear());
    loanText = st.payment > 0 && st.remaining > 0
      ? `${h.ownMode === "balance" ? "入力された残高" : "自動計算: いまのローン残高"} 約${fmt(st.balance)}万円 / 年間返済額 約${fmt(st.payment)}万円(あと${st.remaining}年、${state.age + st.remaining}歳ごろに完済) / 返済後の年間住居費 約${fmt(h.ownMgmt * 12 + h.ownTax + h.ownRepair)}万円`
      : `ローンは完済済み(返済なし) / 年間住居費 約${fmt(h.ownMgmt * 12 + h.ownTax + h.ownRepair)}万円`;
  }
  $("loanInfo").textContent = loanText;
  $("debtInfo").textContent = state.debts.length
    ? "いまの状況: " + state.debts.map((d, i) => { const st = result.debtStates[i]; return st.remaining > 0 ? `${d.name || "ローン"} 残高 約${fmt(st.balance)}万円・年${fmt(st.payment)}万円・あと${st.remaining}年` : `${d.name || "ローン"} 完済済み`; }).join(" / ")
    : "";
  writeInputs(true);
  save();
  if (typeof afterUpdate === "function") afterUpdate();
}

inputs.forEach(el => el.addEventListener("input", () => { readInput(el); update(); }));
$("chCourse").innerHTML = Object.entries(LifePlan.EDU_COURSES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
$("childForm").addEventListener("submit", ev => {
  ev.preventDefault();
  state.children.push({ name: $("chName").value.trim(), age: parseInt($("chAge").value, 10), course: $("chCourse").value });
  ev.target.reset(); refresh();
});
$("addLiving").onclick = () => {
  state.livingItems.push({ name: "", monthly: 0 }); refresh();
  const names = $("livingRows").querySelectorAll("input:not([type])"); names[names.length - 1].focus();
};
$("addIncome").onclick = () => {
  state.incomeChanges.push({ name: "収入の変化", who: "me", from: state.age + 5, to: 0, income: Math.round(state.income * 0.8 / 10) * 10, raise: 0 });
  refresh();
};
$("addMove").onclick = () => {
  state.moves.push({ name: "住み替え", age: state.age + 10, type: "buy", rent: 120, price: 4000, down: 800, closing: 200, rate: 1.5, years: 30, upkeep: 30, salePrice: 3000, sellCost: 150 });
  refresh();
};
$("assetForm").addEventListener("submit", ev => {
  ev.preventDefault();
  state.assets.push({ name: $("asName").value.trim(), type: $("asType").value, amount: parseFloat($("asAmount").value), rate: parseFloat($("asRate").value), monthly: parseFloat($("asMonthly").value) || 0, until: 0 });
  ev.target.reset(); refresh();
});
$("debtForm").addEventListener("submit", ev => {
  ev.preventDefault();
  state.debts.push({ name: $("dbName").value.trim(), mode: "auto", borrow: parseFloat($("dbBorrow").value), borrowYear: parseInt($("dbYear").value, 10),
    rate: parseFloat($("dbRate").value), term: parseInt($("dbTerm").value, 10), balance: 0, years: 0 });
  ev.target.reset(); refresh();
});
$("eventForm").addEventListener("submit", ev => {
  ev.preventDefault();
  state.events.push({ name: $("evName").value.trim(), age: parseInt($("evAge").value, 10), amount: parseFloat($("evAmount").value) });
  ev.target.reset(); refresh();
});
$("reset").onclick = () => { if (confirm("このプランの入力内容を初期値に戻します。よろしいですか?")) { state = merge(null); writeInputs(); refresh(); } };
$("exportCsv").onclick = () => download("lifeplan-cashflow.csv", toCsv(result.rows), "text/csv;charset=utf-8");
$("pdfBtn").onclick = () => exportPdf();
$("exportJson").onclick = () => download("lifeplan-data.json", JSON.stringify(state, null, 2), "application/json");
$("importJson").onclick = () => $("importFile").click();
$("importFile").onchange = async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try { state = merge(JSON.parse(await f.text())); writeInputs(); refresh(); }
  catch (e) { alert("読み込めませんでした。保存したJSONファイルを選んでください。"); }
  ev.target.value = "";
};

// 数字入力欄はスマホで数字キーパッドを出す。小数が要る欄(step が小数)は小数点付き。
// 負の数を入れる欄(子どもの年齢・イベント金額)は iOS の数字キーパッドに「-」が無いので対象外。
document.querySelectorAll('input[type="number"]').forEach(el => {
  if (el.id === "chAge" || el.id === "evAmount") return;
  el.inputMode = /\./.test(el.step) ? "decimal" : "numeric";
});

writeInputs(); refresh(); quietSave = false;
