// ログインと端末間の同期(Firebase Authentication と Cloud Firestore を REST で直接利用)。
// 方針: 端末内の保存を常に正とし(オフラインでも使える)、ログイン中は変更をサーバーに送り、他の端末の変更を取り込む。
// 同じプランを複数の端末で同時に編集して食い違った場合は、新しい方を残し、古い方は「(競合コピー)」として別プランに残す。
const CFG = window.LIFEPLAN_CONFIG || {};
const SYNC_ON = !!(CFG.firebaseApiKey && CFG.firebaseProjectId);
const trim = u => String(u).replace(/\/$/, "");
const FB = {
  key: CFG.firebaseApiKey, project: CFG.firebaseProjectId,
  auth: trim(CFG.firebaseAuthBase || "https://identitytoolkit.googleapis.com"),
  token: trim(CFG.firebaseTokenBase || "https://securetoken.googleapis.com"),
  store: trim(CFG.firestoreBase || "https://firestore.googleapis.com"),
};
const AUTH_KEY = "lifeplan.auth";
const el = id => document.getElementById(id);

let session = (() => { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) { return null; } })();
let syncing = false, syncAgain = false, syncTimer = null;
let lastSync = { up: 0, down: 0 }; // 直近の同期で、端末から送ったプラン数 / サーバーから受け取ったプラン数
let syncState = { kind: session ? "idle" : "out", at: 0, msg: "" }; // out | idle | syncing | error | offline

function saveSession(s) {
  session = s;
  try { s ? localStorage.setItem(AUTH_KEY, JSON.stringify(s)) : localStorage.removeItem(AUTH_KEY); } catch (e) {}
}
const jpError = m => {
  const t = String(m || "");
  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/i.test(t)) return "メールアドレスまたはパスワードが違います。";
  if (/EMAIL_EXISTS/i.test(t)) return "このメールアドレスはすでに登録されています。ログインしてください。";
  if (/WEAK_PASSWORD/i.test(t)) return "パスワードは6文字以上にしてください。";
  if (/INVALID_EMAIL|MISSING_EMAIL/i.test(t)) return "メールアドレスの形式を確認してください。";
  if (/MISSING_PASSWORD/i.test(t)) return "パスワードを入力してください。";
  if (/TOO_MANY_ATTEMPTS|QUOTA|rate limit/i.test(t)) return "短時間に操作が多すぎます。しばらくしてからもう一度お試しください。";
  if (/USER_DISABLED/i.test(t)) return "このアカウントは利用できません。";
  if (/OPERATION_NOT_ALLOWED|ADMIN_ONLY/i.test(t)) return "この操作は許可されていません。Firebase のログイン設定(メール/パスワード・新規登録)を確認してください。";
  if (/PERMISSION_DENIED|insufficient permissions/i.test(t)) return "サーバーの保護ルールにより保存できませんでした。Firestore のルール設定を確認してください。";
  if (/API key not valid|API_KEY_INVALID/i.test(t)) return "Firebase の API キーが正しくありません。config.js を確認してください。";
  if (/Failed to fetch|NetworkError|Load failed/i.test(t)) return "通信できませんでした。ネットワークを確認してください。";
  return t || "エラーが発生しました。";
};

// ---------- HTTP ----------
async function http(url, { method = "GET", json, form, token } = {}) {
  const headers = {};
  if (json !== undefined) headers["Content-Type"] = "application/json";
  if (form !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(url, { method, headers, body: json !== undefined ? JSON.stringify(json) : form });
  const text = await res.text(); let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok) {
    const e = j && j.error;
    const err = new Error((e && (e.message || e.status)) || `HTTP ${res.status}`);
    err.status = res.status; err.fbStatus = e && e.status; throw err;
  }
  return j;
}
// ログイン済みのリクエスト(期限が近ければ先にトークンを更新)
async function authed(url, opts = {}) { await ensureFresh(); return http(url, { ...opts, token: session.access_token }); }
const identity = (path, body) => http(`${FB.auth}/v1/${path}?key=${encodeURIComponent(FB.key)}`, { method: "POST", json: body });
function toSession(j) {
  return { access_token: j.idToken, refresh_token: j.refreshToken, expires_at: Math.floor(Date.now() / 1000) + Number(j.expiresIn || 3600), user: { id: j.localId, email: j.email } };
}
let refreshing = null;
async function ensureFresh() {
  if (!session || session.expires_at * 1000 - Date.now() > 60000) return;
  refreshing = refreshing || (async () => {
    try {
      const j = await http(`${FB.token}/v1/token?key=${encodeURIComponent(FB.key)}`, { method: "POST", form: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refresh_token)}` });
      saveSession({ ...session, access_token: j.id_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + Number(j.expires_in || 3600) });
    } catch (e) {
      if (e.status >= 400 && e.status < 500) { saveSession(null); setSync("out"); renderAuth(); } // ログインの有効期限切れ・アカウント削除など
      throw e;
    } finally { refreshing = null; }
  })();
  await refreshing;
}

// ---------- ログイン・登録 ----------
async function signIn(email, password) {
  await onSignedIn(toSession(await identity("accounts:signInWithPassword", { email, password, returnSecureToken: true })));
}
async function signUp(email, password) {
  await onSignedIn(toSession(await identity("accounts:signUp", { email, password, returnSecureToken: true })));
}
async function onSignedIn(s) {
  // この端末に別アカウントのデータが残っているときは、混ざらないように消してから読み込む
  if (store.owner && store.owner !== s.user.id) {
    if (!confirm("この端末には、別のアカウントのプランが残っています。\nそれを削除してから、このアカウントのプランを読み込みます。よろしいですか?")) { return; }
    wipeLocal();
  }
  saveSession(s);
  store.owner = s.user.id; persist();
  setSync("idle"); renderAuth(); updateAuthButton();
  await syncNow();
  // この端末にあったプランと、アカウントにあったプランの両方がある → 別々に入力したプランが並んでいる可能性があるので確認を促す
  if (lastSync.up > 0 && lastSync.down > 0 && store.profiles.length > 1) {
    closeAuth();
    alert(`この端末のプラン(${lastSync.up}件)と、アカウントに保存されていたプラン(${lastSync.down}件)を、どちらも残しました。\n\n同じ名前のプランが複数あるときは、別々に入力したものです。次の画面で内容(年齢など)を見て、使うプランを選び、不要なものは削除してください。`);
    $("openProfiles").click();
  }
}
function wipeLocal() {
  const n = newProfile("受講生 1");
  store.profiles = [n]; store.currentId = n.id; store.deleted = []; store.owner = null; store.remoteRev = null; persist();
  switchProfileLoaded();
}
async function signOut(wipe) {
  if (wipe) await syncNow().catch(() => {}); // 消す前に、送れていない変更をできるだけ送る
  saveSession(null); setSync("out");
  if (wipe) wipeLocal();
  renderAuth(); updateAuthButton();
}

// ---------- Firestore(受講生プランは lifeplanUsers/{uid}/plans/{planId} に保存) ----------
const docsRoot = () => `projects/${FB.project}/databases/(default)/documents`;
const userDoc = () => `${docsRoot()}/lifeplanUsers/${session.user.id}`;
const planName = id => `${userDoc()}/plans/${id}`;
const sv = v => ({ stringValue: String(v ?? "") });
const iv = v => ({ integerValue: String(Math.round(Number(v) || 0)) });
const lastId = n => n.split("/").pop();

// 更新の目印(rev): 他の端末が書き込むたびに変わる。変化がなければ、一覧の取得を省いて読み取り回数を抑える
async function remoteRev() {
  try { const d = await authed(`${FB.store}/v1/${userDoc()}`); return Number(d.fields && d.fields.rev ? d.fields.rev.integerValue : 0) || null; }
  catch (e) { if (e.status === 404) return null; throw e; }
}
async function remoteList() {
  const out = []; let tok = "";
  do {
    const j = await authed(`${FB.store}/v1/${userDoc()}/plans?pageSize=300&mask.fieldPaths=updatedMs${tok ? `&pageToken=${encodeURIComponent(tok)}` : ""}`);
    for (const d of (j && j.documents) || []) out.push({ id: lastId(d.name), updated_ms: Number(d.fields && d.fields.updatedMs ? d.fields.updatedMs.integerValue : 0) });
    tok = (j && j.nextPageToken) || "";
  } while (tok);
  return out;
}
async function remoteGet(ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 50) {
    const res = await authed(`${FB.store}/v1/${docsRoot()}:batchGet`, { method: "POST", json: { documents: ids.slice(i, i + 50).map(planName) } });
    for (const r of res || []) {
      if (!r.found) continue;
      const f = r.found.fields || {};
      try { rows.push({ id: lastId(r.found.name), name: f.name ? f.name.stringValue : "", memo: f.memo ? f.memo.stringValue : "", data: JSON.parse(f.dataJson.stringValue),
        created_ms: Number(f.createdMs ? f.createdMs.integerValue : 0), updated_ms: Number(f.updatedMs ? f.updatedMs.integerValue : 0) }); } catch (e) {}
    }
  }
  return rows;
}
// 書き込み(追加・更新・削除)をまとめて送る。送ったあとの rev を返す
async function remoteCommit(upserts, deleteIds) {
  const rev = Date.now(), ops = [];
  for (const p of upserts) ops.push({ update: { name: planName(p.id), fields: { name: sv(p.name), memo: sv(p.memo), dataJson: sv(JSON.stringify(p.data)), createdMs: iv(p.createdAt), updatedMs: iv(p.updatedAt) } } });
  for (const id of deleteIds) ops.push({ delete: planName(id) });
  for (let i = 0; i < ops.length; i += 100) {
    const chunk = ops.slice(i, i + 100);
    chunk.push({ update: { name: userDoc(), fields: { rev: iv(rev) } } });
    await authed(`${FB.store}/v1/${docsRoot()}:commit`, { method: "POST", json: { writes: chunk } });
  }
  return rev;
}

// ---------- 同期 ----------
// キーの並び順に左右されない比較(JSON文字列)
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);
const isPristine = p => !p.syncedMs && /^受講生 \d+$/.test(p.name || "") && stable(merge(p.data)) === stable(merge(null)); // 何も入力していない初期プラン
function removeLocal(id) {
  store.profiles = store.profiles.filter(p => p.id !== id);
  const wasCurrent = store.currentId === id;
  if (!store.profiles.length) { const n = newProfile("受講生 1"); store.profiles.push(n); store.currentId = n.id; }
  else if (wasCurrent) store.currentId = [...store.profiles].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
  persist();
  if (wasCurrent) switchProfileLoaded();
}

// ---- 食い違い(競合)の解決: 前回同期した時点(base)を基準に、項目ごとに合わせる ----
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => stable(a) === stable(b);
// 片方だけが変えた項目はそのまま取り込み、両方が同じ項目を変えていたら新しい方(localWins)を採用して conflict を立てる
function mergeVal(b, l, r, localWins, st) {
  if (same(l, r)) return l;
  if (same(b, r)) return l;   // サーバー側は変わっていない → 端末側
  if (same(b, l)) return r;   // 端末側は変わっていない → サーバー側
  if (isObj(l) && isObj(r) && isObj(b)) {
    const out = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) { const v = mergeVal(b[k], l[k], r[k], localWins, st); if (v !== undefined) out[k] = v; }
    return out;
  }
  st.conflict = true; return localWins ? l : r;
}
async function resolveConflicts(list, up) {
  const byId = new Map((await remoteGet(list.map(p => p.id))).map(r => [r.id, r]));
  for (const p of list) {
    const row = byId.get(p.id);
    if (!row) { up.push(p); continue; }                          // サーバーから消えていた → 端末側を送り直す
    const localWins = p.updatedAt >= row.updated_ms;
    const local = { name: p.name, memo: p.memo, data: structuredClone(p.data) };
    const remote = { name: row.name, memo: row.memo, data: merge(row.data) };
    const st = { conflict: false };
    let merged;
    if (p.base) merged = mergeVal({ name: p.base.name, memo: p.base.memo, data: merge(p.base.data) }, local, remote, localWins, st);
    else { st.conflict = true; merged = localWins ? local : remote; } // 基準がない古いデータは、新しい方を採用
    if (st.conflict) { // 同じ項目を両方が変えていた: 採用しなかった側を「競合コピー」として残す
      const loser = localWins ? remote : local;
      const c = newProfile((loser.name || "名前未設定") + "(競合コピー)", loser.data); c.memo = loser.memo;
      store.profiles.push(c); up.push(c);
    }
    p.name = merged.name; p.memo = merged.memo; p.data = merge(merged.data);
    p.updatedAt = Math.max(Date.now(), row.updated_ms + 1); p.dirty = true;
    up.push(p);
    if (p.id === store.currentId) { persist(); switchProfileLoaded(); }
  }
}

async function syncNow() {
  if (!session) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true; setSync("syncing");
  let applied = 0;
  try {
    save(); // 入力中の内容を先に保存
    // 端末側に未送信の変更がなく、サーバー側にも更新がなければ、ここで終了(読み取り1回)
    const hasLocalChanges = store.deleted.length > 0 || store.profiles.some(p => p.dirty && !isPristine(p));
    const rev = await remoteRev();
    if (!hasLocalChanges && rev !== null && rev === store.remoteRev) { setSync("idle", { at: Date.now() }); return; }

    // 1. サーバー側の一覧(更新時刻だけ)を取得して、差分を判定
    const remote = await remoteList();
    store.remoteCount = remote.length;
    const rmap = new Map(remote.map(r => [r.id, r.updated_ms]));
    const delIds = store.deleted.filter(id => rmap.has(id));   // 端末で削除したプラン(サーバーに残っているもの)
    for (const id of delIds) rmap.delete(id);
    const up = [], down = [], conflicts = [];
    for (const p of store.profiles.slice()) {
      const r = rmap.get(p.id);
      if (r === undefined) {
        if (p.syncedMs) { p.dirty ? up.push(p) : removeLocal(p.id); applied++; } // 別の端末で削除された(未送信の変更があれば残して送り直す)
        else if (!isPristine(p)) up.push(p);                                       // まだ送っていない新しいプラン
      } else if (r > (p.syncedMs || 0)) {                                          // サーバー側が更新されている
        if (!p.dirty) down.push(p.id);
        else conflicts.push(p);                                                    // 両方更新: 項目ごとに合わせる
      } else if (p.dirty && !isPristine(p)) up.push(p);                            // 端末側だけ更新
      rmap.delete(p.id);
    }
    for (const id of rmap.keys()) down.push(id);                                   // 他の端末で作られたプラン
    if (conflicts.length) { await resolveConflicts(conflicts, up); applied += conflicts.length; }
    lastSync = { up: up.filter(p => !p.syncedMs).length, down: down.length };
    // 2. 送信(追加・更新・削除)
    let newRev = rev;
    if (up.length || delIds.length) {
      const sent = up.map(p => ({ p, ms: p.updatedAt, base: { name: p.name, memo: p.memo, data: structuredClone(p.data) } }));
      await remoteCommit(up, delIds);
      newRev = null; // 書き込んだ直後は目印を記録しない(同時に他の端末が書いた更新を、次回の同期で必ず確認するため)
      for (const { p, ms, base } of sent) { p.syncedMs = ms; p.base = base; if (p.updatedAt === ms) p.dirty = false; } // 送信中にさらに編集されていたら、dirty のまま次回送る
    }
    store.deleted = []; // 削除はサーバー反映済み(サーバーにもともと無かったものも含む)
    // 3. 受信
    if (down.length) {
      for (const row of await remoteGet(down)) {
        let p = store.profiles.find(x => x.id === row.id);
        if (!p) { p = newProfile(row.name); p.id = row.id; store.profiles.push(p); }
        p.name = row.name; p.memo = row.memo; p.data = merge(row.data);
        p.createdAt = row.created_ms; p.updatedAt = p.syncedMs = row.updated_ms; p.dirty = false;
        p.base = { name: row.name, memo: row.memo, data: structuredClone(p.data) };
        if (p.id === store.currentId) { persist(); switchProfileLoaded(); }
        applied++;
      }
    }
    // 4. 何も入力していない初期プランが残っていたら、他にプランがあるときは片付ける
    if (store.profiles.length > 1) for (const p of store.profiles.filter(isPristine)) { removeLocal(p.id); applied++; }
    store.remoteRev = newRev; persist();
    setSync("idle", { at: Date.now() });
    if (applied && typeof profDlg !== "undefined" && profDlg.open) renderProfiles();
    updateProfileUI();
    // 初回起動のかんたん入力が開いたままなら、ログインで読み込めたので閉じる
    if (down.length && !document.getElementById("wizard").hidden && typeof wzStep !== "undefined" && wzStep === 0) closeWizard();
  } catch (e) {
    if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(e.message)) setSync("offline");
    else setSync("error", { msg: jpError(e.fbStatus === "PERMISSION_DENIED" ? "PERMISSION_DENIED" : e.message) });
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}
function scheduleSync(delay = 2000) {
  if (!SYNC_ON || !session) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, delay);
}

// ---------- 表示 ----------
function setSync(kind, extra = {}) { syncState = { ...syncState, kind, msg: "", ...extra }; updateAuthButton(); renderAuth(); }
const timeOf = t => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
function updateAuthButton() {
  if (!SYNC_ON) return;
  const label = !session ? "ログイン" : {
    syncing: "同期中…", error: "同期エラー", offline: "オフライン", idle: "同期済み", out: "ログイン",
  }[syncState.kind];
  el("syncLabel").textContent = label;
  el("openAuth").classList.toggle("warn", session && (syncState.kind === "error" || syncState.kind === "offline"));
}
function renderAuth() {
  if (!SYNC_ON) return;
  el("authOut").hidden = !!session;
  el("authIn").hidden = !session;
  el("authTitle").textContent = session ? "☁️ アカウント" : "☁️ ログイン";
  if (session) {
    el("authEmailOut").textContent = session.user.email;
    const unsynced = store.profiles.filter(p => p.dirty && !isPristine(p)).length;
    el("authCounts").textContent = `この端末のプラン: ${store.profiles.length}件` + (store.remoteCount !== undefined ? ` / サーバー上のプラン: ${store.remoteCount}件` : "") + ` / 未送信の変更: ${unsynced}件`;
    el("authStatus").textContent = ({
      syncing: "同期しています…", idle: syncState.at ? `同期済み(${timeOf(syncState.at)})` : "同期済み",
      offline: "オフラインです。ネットワークにつながると自動で同期します。", error: "同期できませんでした: " + (syncState.msg || ""), out: "",
    })[syncState.kind];
  }
}
function authMsg(t, bad) { const m = el("authMsg"); m.textContent = t || ""; m.classList.toggle("bad", !!bad); }
function openAuth() { authMsg(""); renderAuth(); el("authDlg").showModal ? el("authDlg").showModal() : el("authDlg").setAttribute("open", ""); }
const closeAuth = () => (el("authDlg").close ? el("authDlg").close() : el("authDlg").removeAttribute("open"));

async function busy(btn, fn) {
  btn.disabled = true; authMsg("");
  try { await fn(); } catch (e) { authMsg(jpError(e.message), true); } finally { btn.disabled = false; }
}

// ---------- 起動 ----------
if (SYNC_ON) {
  el("openAuth").hidden = false;
  if (el("wzLogin")) el("wzLogin").hidden = false;
  updateAuthButton();
  el("openAuth").onclick = openAuth;
  if (el("wzLogin")) el("wzLogin").onclick = openAuth;
  el("authClose").onclick = closeAuth;
  el("authDlg").addEventListener("click", e => { if (e.target === el("authDlg")) closeAuth(); });

  const creds = () => ({ email: el("authEmail").value.trim(), password: el("authPass").value });
  el("authForm").addEventListener("submit", ev => { ev.preventDefault();
    busy(el("authLogin"), async () => { const { email, password } = creds(); await signIn(email, password); if (session) { el("authPass").value = ""; closeAuth(); } }); });
  el("authSignup").onclick = ev => busy(ev.target, async () => {
    const { email, password } = creds();
    if (!el("authForm").reportValidity()) return;
    await signUp(email, password);
    if (session) { el("authPass").value = ""; closeAuth(); }
  });
  el("authForgot").onclick = ev => busy(ev.target, async () => {
    const email = el("authEmail").value.trim();
    if (!email) { authMsg("上のメールアドレス欄に、登録したメールアドレスを入れてください。", true); return; }
    await identity("accounts:sendOobCode", { requestType: "PASSWORD_RESET", email });
    authMsg("パスワード再設定のメールを送りました。メール内のリンクで新しいパスワードを設定してから、ここでログインしてください。");
  });
  el("authSyncNow").onclick = ev => busy(ev.target, () => { store.remoteRev = null; return syncNow(); });
  el("authLogout").onclick = async ev => {
    if (!confirm("ログアウトしますか?")) return;
    const wipe = confirm("この端末に保存されている受講生のプランも削除しますか?\n\n・OK: 削除する(共有の端末向け。アカウントにはデータが残るので、再ログインで復元できます)\n・キャンセル: この端末に残す");
    await busy(ev.target, () => signOut(wipe)); closeAuth();
  };

  // 自動で同期するタイミング: 開いたとき・画面に戻ったとき・オンラインに戻ったとき・開いている間は定期的に
  if (session) syncNow();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  addEventListener("online", () => syncNow());
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 60000);
  renderAuth();
}
