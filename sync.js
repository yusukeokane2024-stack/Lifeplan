// ログインと端末間の同期(Supabase の認証・データベースを REST で直接利用)。
// 方針: 端末内の保存を常に正とし(オフラインでも使える)、ログイン中は変更をサーバーに送り、他の端末の変更を取り込む。
// 同じプランを複数の端末で同時に編集して食い違った場合は、新しい方を残し、古い方は「(競合コピー)」として別プランに残す。
const CFG = window.LIFEPLAN_CONFIG || {};
const SYNC_ON = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
const AUTH_KEY = "lifeplan.auth";
const el = id => document.getElementById(id);

let session = (() => { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) { return null; } })();
let syncing = false, syncAgain = false, syncTimer = null;
let syncState = { kind: session ? "idle" : "out", at: 0, msg: "" }; // out | idle | syncing | error | offline

function saveSession(s) {
  session = s;
  try { s ? localStorage.setItem(AUTH_KEY, JSON.stringify(s)) : localStorage.removeItem(AUTH_KEY); } catch (e) {}
}
const jpError = m => {
  const t = String(m || "");
  if (/Invalid login credentials/i.test(t)) return "メールアドレスまたはパスワードが違います。";
  if (/already registered|already been registered/i.test(t)) return "このメールアドレスはすでに登録されています。ログインしてください。";
  if (/at least \d+ characters|weak/i.test(t)) return "パスワードは6文字以上にしてください(推測されやすいものは使えません)。";
  if (/Email not confirmed/i.test(t)) return "メールの確認が完了していません。届いたメールのリンクを開いてください。";
  if (/rate limit|too many/i.test(t)) return "短時間に操作が多すぎます。しばらくしてからもう一度お試しください。";
  if (/valid email|invalid.*email/i.test(t)) return "メールアドレスの形式を確認してください。";
  if (/Failed to fetch|NetworkError|Load failed/i.test(t)) return "通信できませんでした。ネットワークを確認してください。";
  return t || "エラーが発生しました。";
};

// ---------- HTTP ----------
async function api(path, { method = "GET", body, headers = {}, auth = true } = {}) {
  if (auth && session) await ensureFresh();
  const res = await fetch(CFG.supabaseUrl.replace(/\/$/, "") + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { apikey: CFG.supabaseAnonKey, "Content-Type": "application/json", ...(auth && session ? { Authorization: "Bearer " + session.access_token } : {}), ...headers },
  });
  const text = await res.text(); let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok) {
    const err = new Error((json && (json.error_description || json.msg || json.message || json.error)) || `HTTP ${res.status}`);
    err.status = res.status; throw err;
  }
  return json;
}
function toSession(j) {
  return { access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: { id: j.user.id, email: j.user.email } };
}
let refreshing = null;
async function ensureFresh() {
  if (!session || session.expires_at * 1000 - Date.now() > 60000) return;
  refreshing = refreshing || (async () => {
    try {
      const j = await api("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token }, auth: false });
      saveSession(toSession(j));
    } catch (e) {
      if (e.status === 400 || e.status === 401 || e.status === 403) { saveSession(null); setSync("out"); renderAuth(); } // ログインの有効期限切れ
      throw e;
    } finally { refreshing = null; }
  })();
  await refreshing;
}

// ---------- ログイン・登録 ----------
async function signIn(email, password) {
  const j = await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password }, auth: false });
  await onSignedIn(toSession(j));
}
async function signUp(email, password) {
  const j = await api("/auth/v1/signup", { method: "POST", body: { email, password }, auth: false });
  if (j && j.access_token) { await onSignedIn(toSession(j)); return "ok"; }
  return "confirm"; // メール確認が必要な設定のとき
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
}
function wipeLocal() {
  const n = newProfile("受講生 1");
  store.profiles = [n]; store.currentId = n.id; store.deleted = []; store.owner = null; persist();
  switchProfileLoaded();
}
async function signOut(wipe) {
  if (wipe) await syncNow().catch(() => {}); // 消す前に、送れていない変更をできるだけ送る
  try { await api("/auth/v1/logout", { method: "POST" }); } catch (e) {}
  saveSession(null); setSync("out");
  if (wipe) wipeLocal();
  renderAuth(); updateAuthButton();
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
const inList = ids => `(${ids.map(encodeURIComponent).join(",")})`;

async function syncNow() {
  if (!session) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true; setSync("syncing");
  let applied = 0;
  try {
    save(); // 入力中の内容を先に保存
    // 1. 端末で削除したプランを、サーバーからも削除
    if (store.deleted.length) {
      await api(`/rest/v1/plans?id=in.${inList(store.deleted)}`, { method: "DELETE" });
      store.deleted = []; persist();
    }
    // 2. サーバー側の一覧(更新時刻だけ)を取得して、差分を判定
    const remote = await api("/rest/v1/plans?select=id,updated_ms");
    const rmap = new Map((remote || []).map(r => [r.id, Number(r.updated_ms)]));
    const up = [], down = [];
    for (const p of store.profiles.slice()) {
      const r = rmap.get(p.id);
      if (r === undefined) {
        if (p.syncedMs) { p.dirty ? up.push(p) : removeLocal(p.id); applied++; } // 別の端末で削除された(未送信の変更があれば残して送り直す)
        else if (!isPristine(p)) up.push(p);                                       // まだ送っていない新しいプラン
      } else if (r > (p.syncedMs || 0)) {                                          // サーバー側が更新されている
        if (!p.dirty) down.push(p.id);
        else if (p.updatedAt >= r) up.push(p);                                     // 両方更新: 端末側が新しければ端末側を残す
        else { const c = newProfile((p.name || "名前未設定") + "(競合コピー)", structuredClone(p.data)); c.memo = p.memo; store.profiles.push(c); up.push(c); down.push(p.id); applied++; }
      } else if (p.dirty && !isPristine(p)) up.push(p);                            // 端末側だけ更新
      rmap.delete(p.id);
    }
    for (const id of rmap.keys()) if (!store.deleted.includes(id)) down.push(id);  // 他の端末で作られたプラン
    // 3. 送信
    if (up.length) {
      const snap = up.map(p => ({ p, ms: p.updatedAt }));
      await api("/rest/v1/plans?on_conflict=user_id,id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: up.map(p => ({ user_id: session.user.id, id: p.id, name: p.name || "", memo: p.memo || "", data: p.data, created_ms: p.createdAt, updated_ms: p.updatedAt })) });
      for (const { p, ms } of snap) { p.syncedMs = ms; if (p.updatedAt === ms) p.dirty = false; } // 送信中にさらに編集されていたら、dirty のまま次回送る
      persist();
    }
    // 4. 受信
    if (down.length) {
      const rows = await api(`/rest/v1/plans?select=id,name,memo,data,created_ms,updated_ms&id=in.${inList(down)}`);
      for (const row of rows || []) {
        let p = store.profiles.find(x => x.id === row.id);
        if (!p) { p = newProfile(row.name); p.id = row.id; store.profiles.push(p); }
        p.name = row.name; p.memo = row.memo; p.data = merge(row.data);
        p.createdAt = Number(row.created_ms); p.updatedAt = p.syncedMs = Number(row.updated_ms); p.dirty = false;
        if (p.id === store.currentId) { persist(); switchProfileLoaded(); }
        applied++;
      }
      persist();
    }
    // 5. 何も入力していない初期プランが残っていたら、他にプランがあるときは片付ける
    if (store.profiles.length > 1) for (const p of store.profiles.filter(isPristine)) { removeLocal(p.id); applied++; }
    setSync("idle", { at: Date.now() });
    if (applied && typeof profDlg !== "undefined" && profDlg.open) renderProfiles();
    updateProfileUI();
    // 初回起動のかんたん入力が開いたままなら、ログインで読み込めたので閉じる
    if (down.length && !document.getElementById("wizard").hidden && typeof wzStep !== "undefined" && wzStep === 0) closeWizard();
  } catch (e) {
    if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(e.message)) setSync("offline");
    else setSync("error", { msg: jpError(e.message) });
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
  const mode = el("authDlg").dataset.mode || "out";
  el("authOut").hidden = !!session || mode === "newpass";
  el("authNew").hidden = mode !== "newpass";
  el("authIn").hidden = !session || mode === "newpass";
  el("authTitle").textContent = mode === "newpass" ? "🔑 新しいパスワード" : session ? "☁️ アカウント" : "☁️ ログイン";
  if (session) {
    el("authEmailOut").textContent = session.user.email;
    el("authStatus").textContent = ({
      syncing: "同期しています…", idle: syncState.at ? `同期済み(${timeOf(syncState.at)})` : "同期済み",
      offline: "オフラインです。ネットワークにつながると自動で同期します。", error: "同期できませんでした: " + (syncState.msg || ""), out: "",
    })[syncState.kind];
  }
}
function authMsg(t, bad) { const m = el("authMsg"); m.textContent = t || ""; m.classList.toggle("bad", !!bad); }
function openAuth(mode) { el("authDlg").dataset.mode = mode || ""; authMsg(""); renderAuth(); el("authDlg").showModal ? el("authDlg").showModal() : el("authDlg").setAttribute("open", ""); }
const closeAuth = () => (el("authDlg").close ? el("authDlg").close() : el("authDlg").removeAttribute("open"));

async function busy(btn, fn) {
  const label = btn.textContent; btn.disabled = true; authMsg("");
  try { await fn(); } catch (e) { authMsg(jpError(e.message), true); } finally { btn.disabled = false; btn.textContent = label; }
}

// ---------- 起動 ----------
if (SYNC_ON) {
  el("openAuth").hidden = false;
  if (el("wzLogin")) el("wzLogin").hidden = false;
  updateAuthButton();
  el("openAuth").onclick = () => openAuth(session ? "in" : "out");
  if (el("wzLogin")) el("wzLogin").onclick = () => openAuth("out");
  el("authClose").onclick = closeAuth;
  el("authDlg").addEventListener("click", e => { if (e.target === el("authDlg")) closeAuth(); });

  const creds = () => ({ email: el("authEmail").value.trim(), password: el("authPass").value });
  el("authForm").addEventListener("submit", ev => { ev.preventDefault();
    busy(el("authLogin"), async () => { const { email, password } = creds(); await signIn(email, password); if (session) { el("authPass").value = ""; closeAuth(); } }); });
  el("authSignup").onclick = ev => busy(ev.target, async () => {
    const { email, password } = creds();
    if (!el("authForm").reportValidity()) return;
    const r = await signUp(email, password);
    if (r === "confirm") authMsg("確認メールを送りました。メール内のリンクを開いてから、ログインしてください。");
    else { el("authPass").value = ""; closeAuth(); }
  });
  el("authForgot").onclick = ev => busy(ev.target, async () => {
    const email = el("authEmail").value.trim();
    if (!email) { authMsg("上のメールアドレス欄に、登録したメールアドレスを入れてください。", true); return; }
    const redirect = encodeURIComponent(location.origin + location.pathname);
    await api(`/auth/v1/recover?redirect_to=${redirect}`, { method: "POST", body: { email }, auth: false });
    authMsg("パスワード再設定のメールを送りました。メール内のリンクを開いてください。");
  });
  el("authNewForm").addEventListener("submit", ev => { ev.preventDefault();
    busy(el("authNewBtn"), async () => {
      await api("/auth/v1/user", { method: "PUT", body: { password: el("authNewPass").value } });
      el("authDlg").dataset.mode = ""; el("authNewPass").value = "";
      await onSignedIn(session); closeAuth();
    }); });
  el("authSyncNow").onclick = ev => busy(ev.target, () => syncNow());
  el("authLogout").onclick = async ev => {
    if (!confirm("ログアウトしますか?")) return;
    const wipe = confirm("この端末に保存されている受講生のプランも削除しますか?\n\n・OK: 削除する(共有の端末向け。アカウントにはデータが残るので、再ログインで復元できます)\n・キャンセル: この端末に残す");
    await busy(ev.target, () => signOut(wipe)); closeAuth();
  };

  // メールのリンク(登録確認・パスワード再設定)から戻ってきたとき
  (async () => {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (h.get("access_token") && h.get("refresh_token")) {
      history.replaceState(null, "", location.pathname + location.search);
      try {
        const tmp = { access_token: h.get("access_token"), refresh_token: h.get("refresh_token"), expires_at: Number(h.get("expires_at")) || Math.floor(Date.now() / 1000) + Number(h.get("expires_in") || 3600), user: { id: "", email: "" } };
        saveSession(tmp);
        const u = await api("/auth/v1/user");
        saveSession({ ...tmp, user: { id: u.id, email: u.email } });
        if (h.get("type") === "recovery") { openAuth("newpass"); }
        else { await onSignedIn(session); }
      } catch (e) { saveSession(null); openAuth("out"); authMsg("リンクの有効期限が切れています。もう一度お試しください。", true); }
    }
  })();

  // 自動で同期するタイミング: 開いたとき・画面に戻ったとき・オンラインに戻ったとき・開いている間は定期的に
  if (session) syncNow();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  addEventListener("online", () => syncNow());
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 60000);
  renderAuth();
}
