// 受講生ごとのプラン管理(一覧・切り替え・追加・複製・削除・バックアップ)。保存先はこの端末のブラウザ内。
const profDlg = document.getElementById("profDlg");
const closeDlg = () => (profDlg.close ? profDlg.close() : profDlg.removeAttribute("open"));
const fmtDate = t => { const d = new Date(t); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function updateProfileUI() { $("profName").textContent = (currentProfile().name || "").trim() || "名前未設定"; }

// プランを切り替える。現在の入力を保存してから、選んだプランを読み込む。
function switchProfile(id) {
  save();
  store.currentId = id; persist();
  quietSave = true;
  state = merge(currentProfile().data);
  lastSig = JSON.stringify(state);
  writeInputs(); refresh(); updateProfileUI();
  quietSave = false;
  window.scrollTo(0, 0);
}
function summaryOf(p) {
  const d = merge(p.data), r = LifePlan.simulate(d);
  return `${d.age}歳${d.spouse.enabled ? "・配偶者あり" : ""}${d.children.length ? `・子${d.children.length}人` : ""} ／ ` +
    (r.depletedAge === null ? `${d.endAge}歳まで資産は尽きない見込み` : `${r.depletedAge}歳ごろに資産が尽きる見込み`);
}

function renderProfiles() {
  const q = $("profSearch").value.trim().toLowerCase();
  const list = $("profList"); list.innerHTML = "";
  const rows = [...store.profiles].sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(p => !q || (p.name + " " + (p.memo || "")).toLowerCase().includes(q));
  if (!rows.length) list.innerHTML = '<p class="hint">該当する受講生がいません。</p>';
  for (const p of rows) {
    const cur = p.id === store.currentId;
    const row = document.createElement("div"); row.className = "prof-row" + (cur ? " cur" : "");
    const name = document.createElement("input"); name.className = "nm"; name.value = p.name; name.placeholder = "受講生の名前"; name.maxLength = 30;
    name.setAttribute("aria-label", "受講生の名前");
    name.oninput = () => { p.name = name.value; touchProfile(p); updateProfileUI(); };
    const memo = document.createElement("input"); memo.value = p.memo || ""; memo.placeholder = "メモ(任意。例: 第3期 / 面談日 10/20)"; memo.maxLength = 80;
    memo.setAttribute("aria-label", "メモ");
    memo.oninput = () => { p.memo = memo.value; touchProfile(p); };
    const meta = document.createElement("p"); meta.className = "prof-meta";
    meta.textContent = `最終更新 ${fmtDate(p.updatedAt)} ／ ${summaryOf(p)}`;
    if (cur) { const b = document.createElement("span"); b.className = "prof-badge"; b.textContent = "編集中"; meta.prepend(b); }
    const btns = document.createElement("div"); btns.className = "prof-btns";
    const open = document.createElement("button"); open.type = "button"; open.className = "open";
    open.textContent = cur ? "このプランを編集する" : "開いて編集する";
    open.onclick = () => { if (!cur) switchProfile(p.id); closeDlg(); };
    const dup = document.createElement("button"); dup.type = "button"; dup.className = "secondary"; dup.textContent = "複製";
    dup.onclick = () => {
      if (cur) save();
      const c = newProfile((p.name || "名前未設定") + "(コピー)", structuredClone(p.data)); c.memo = p.memo || "";
      store.profiles.push(c); persist(); renderProfiles(); if (typeof scheduleSync === "function") scheduleSync();
    };
    const del = document.createElement("button"); del.type = "button"; del.className = "del"; del.textContent = "削除";
    del.onclick = () => deleteProfile(p);
    btns.append(open, dup, del);
    row.append(name, memo, meta, btns); list.append(row);
  }
}
function deleteProfile(p) {
  if (!confirm(`「${p.name || "名前未設定"}」のプランを削除します。元に戻せません。よろしいですか?`)) return;
  const wasCur = p.id === store.currentId;
  store.profiles = store.profiles.filter(x => x.id !== p.id);
  if (!store.deleted.includes(p.id)) store.deleted.push(p.id); // 同期中なら、サーバー側からも削除する
  if (!store.profiles.length) { const n = newProfile("受講生 1"); store.profiles.push(n); store.currentId = n.id; switchProfileLoaded(); }
  else if (wasCur) { store.currentId = [...store.profiles].sort((a, b) => b.updatedAt - a.updatedAt)[0].id; switchProfileLoaded(); }
  persist(); renderProfiles(); if (typeof scheduleSync === "function") scheduleSync();
}
// 現在のプランが差し替わったとき(削除など)に、保存し直さず画面だけ読み込む
function switchProfileLoaded() {
  quietSave = true; state = merge(currentProfile().data); lastSig = JSON.stringify(state);
  writeInputs(); refresh(); updateProfileUI(); quietSave = false;
}
function createProfile() {
  save();
  let n = store.profiles.length + 1; while (store.profiles.some(p => p.name === `受講生 ${n}`)) n++;
  const p = newProfile(`受講生 ${n}`); store.profiles.push(p);
  switchProfile(p.id);
  closeDlg();
  openWizard(1); // 新しい受講生は、最初の質問から入力を始める
}

$("openProfiles").onclick = () => { save(); $("profSearch").value = ""; renderProfiles(); profDlg.showModal ? profDlg.showModal() : profDlg.setAttribute("open", ""); };
$("profClose").onclick = () => closeDlg();
profDlg.addEventListener("click", e => { if (e.target === profDlg) closeDlg(); }); // 枠の外をタップで閉じる
$("profSearch").addEventListener("input", renderProfiles);
$("profNew").onclick = createProfile;

$("profBackup").onclick = () => {
  save();
  const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  download(`lifeplan-backup_${stamp}.json`, JSON.stringify({ format: "lifeplan-backup", version: 1, exportedAt: Date.now(),
    profiles: store.profiles.map(({ name, memo, createdAt, updatedAt, data }) => ({ name, memo, createdAt, updatedAt, data })) }, null, 2), "application/json");
};
$("profRestore").onclick = () => $("profFile").click();
$("profFile").onchange = async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const items = j && j.format === "lifeplan-backup" && Array.isArray(j.profiles) ? j.profiles
      : j && typeof j === "object" && !Array.isArray(j) ? [{ name: j.reportName || "読み込んだプラン", data: j }] : null; // 1人分のJSONも受け付ける
    if (!items || !items.length) throw new Error("empty");
    for (const it of items) {
      const p = newProfile(String(it.name || "読み込んだプラン").slice(0, 30), merge(it.data));
      p.memo = String(it.memo || "").slice(0, 80);
      if (it.createdAt) p.createdAt = it.createdAt;
      store.profiles.push(p);
    }
    persist(); renderProfiles(); if (typeof scheduleSync === "function") scheduleSync();
    alert(`${items.length}件のプランを追加しました。`);
  } catch (e) { alert("読み込めませんでした。このアプリで保存したバックアップ(JSON)を選んでください。"); }
  ev.target.value = "";
};

updateProfileUI();
