// かんたん入力(質問ウィザード)。入力は app.js の state を直接更新し、詳細設定と常に同じ値を共有する。
const ONBOARDED_KEY = "lifeplan.onboarded";
const STEPS = 6; // 0: はじめに / 1〜5: 質問
let wzStep = 0;
const wz = id => document.getElementById(id);
const numVal = el => { const v = parseFloat(el.value); return Number.isFinite(v) && v > 0 ? v : 0; };
const round1 = v => Math.round(v * 10) / 10;

function assetByName(name, rate, type) {
  let a = state.assets.find(x => x.name === name);
  if (!a) { a = { name, type, amount: 0, rate, monthly: 0, until: 0 }; state.assets.push(a); }
  return a;
}
const isGeneratedChildren = () => state.children.every(c => /^子ども\d$/.test(c.name));

function setupWizardInputs() {
  wz("wzCash").addEventListener("input", e => { assetByName("預貯金", 0.1, "cash").amount = numVal(e.target); refresh(); });
  wz("wzInvest").addEventListener("input", e => { assetByName("投資信託・株式", 4, "invest").amount = numVal(e.target); refresh(); });
  wz("wzMonthly").addEventListener("input", e => { assetByName("投資信託・株式", 4, "invest").monthly = numVal(e.target); refresh(); });
  wz("wzRentM").addEventListener("input", e => { state.housing.rent = round1(numVal(e.target) * 12); update(); });
  wz("wzLiving").addEventListener("input", e => {
    const total = numVal(e.target), sum = state.livingItems.reduce((t, it) => t + it.monthly, 0);
    if (sum > 0) state.livingItems.forEach(it => { it.monthly = Math.round(it.monthly * total / sum * 100) / 100; });
    else if (state.livingItems.length) state.livingItems[0].monthly = total;
    else state.livingItems.push({ name: "生活費", monthly: total });
    refresh();
  });
  const regenChildren = () => {
    if (!isGeneratedChildren()) return;
    const n = parseInt(wz("wzChildCount").value, 10);
    const eldest = Math.max(0, parseInt(wz("wzEldest").value, 10) || 0);
    state.children = Array.from({ length: n }, (_, i) => ({ name: "子ども" + (i + 1), age: Math.max(0, eldest - 3 * i), course: "pub" }));
    refresh();
  };
  wz("wzChildCount").addEventListener("change", () => {
    if (isGeneratedChildren() && !wz("wzEldest").value) wz("wzEldest").value = 3;
    regenChildren();
  });
  wz("wzEldest").addEventListener("input", regenChildren);
}

// state → 質問画面だけの入力欄・表示切り替え・プレビュー
function afterUpdate() {
  const set = (id, v) => { const el = wz(id); if (el !== document.activeElement) el.value = v; };
  const asset = n => state.assets.find(x => x.name === n);
  set("wzCash", asset("預貯金") ? asset("預貯金").amount : 0);
  set("wzInvest", asset("投資信託・株式") ? asset("投資信託・株式").amount : 0);
  set("wzMonthly", asset("投資信託・株式") ? asset("投資信託・株式").monthly : 0);
  set("wzRentM", round1(state.housing.rent / 12));
  set("wzLiving", round1(state.livingItems.reduce((t, it) => t + it.monthly, 0)));
  const custom = !isGeneratedChildren();
  set("wzChildCount", String(Math.min(4, state.children.length)));
  if (!custom && state.children.length) set("wzEldest", Math.max(...state.children.map(c => c.age)));
  wz("wzSpouse").hidden = !state.spouse.enabled;
  wz("wzChildAge").hidden = custom || state.children.length === 0;
  wz("wzChildCustom").hidden = !custom;
  wz("wzChildCount").disabled = custom;
  const t = state.housing.type;
  wz("wzRent").hidden = t === "own";
  wz("wzOwn").hidden = t !== "own";
  wz("wzBuy").hidden = t !== "buy";
  const r = result;
  wz("wzPreview").innerHTML = r.depletedAge === null
    ? `いまの予測: <b class="good">${state.endAge}歳まで資産は尽きません</b>(最終資産 約${fmt(r.finalBalance)}万円)`
    : `いまの予測: <b class="bad">${r.depletedAge}歳ごろに資産が尽きます</b>`;
}

function showStep(n) {
  wzStep = n;
  document.querySelectorAll(".wz-step").forEach(el => { el.hidden = Number(el.dataset.step) !== n; });
  wz("wzBar").style.width = (n / (STEPS - 1)) * 100 + "%";
  wz("wzBack").hidden = n === 0;
  wz("wzNext").textContent = n === 0 ? "はじめる" : n === STEPS - 1 ? "結果を見る 🎉" : "次へ";
  wz("wzPreview").hidden = n === 0;
  wz("wzSkip").hidden = n !== 0;
  wz("wizard").scrollTo?.(0, 0); window.scrollTo(0, 0);
}
function openWizard(step = 1) {
  document.body.classList.add("wizard-on");
  wz("wizard").hidden = false;
  showStep(step);
}
function closeWizard() {
  try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch (e) {}
  document.body.classList.remove("wizard-on");
  wz("wizard").hidden = true;
  window.scrollTo(0, 0);
}

wz("wzNext").onclick = () => { wzStep >= STEPS - 1 ? closeWizard() : showStep(wzStep + 1); };
wz("wzBack").onclick = () => showStep(wzStep - 1);
wz("wzSkip").onclick = closeWizard;
wz("openWizard").onclick = () => openWizard(1);
wz("wizard").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); wz("wzNext").click(); } });

setupWizardInputs();
afterUpdate();
let seen = false;
try { seen = !!localStorage.getItem(ONBOARDED_KEY); } catch (e) {}
if (!seen) openWizard(0);
