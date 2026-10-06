// PDFレポートの生成。画面の state / result を読み取り、A4横のページ(DOM)を組み立てて画像化し、PDFにまとめる。
// 配色は検証済みのカテゴリカルパレット(ライト)を、並びを変えずに使う。
const RP = {
  cats: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  ink: "#0b0b0b", sub: "#52514e", grid: "#e4e8f1", axis: "#9aa3b5",
};
const rpNum = v => { const r = Math.round(v); return r === 0 ? "-" : r.toLocaleString("ja-JP"); };
const rpMoney = v => Math.round(v).toLocaleString("ja-JP") + "万円";
const rpAxis = v => Math.abs(v) >= 10000 ? (v / 10000).toFixed(1).replace(/\.0$/, "") + "億" : Math.round(v).toLocaleString("ja-JP") + (v === 0 ? "" : "万");

// ---------- 軸の目盛り・グラフの共通部品 ----------
function niceScale(min, max, n = 5) {
  if (max === min) max = min + 1;
  const raw = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}
// rows: 横軸の各年。draw({y, xc, slot, n}) が中身のSVG文字列を返す。
function rpPlot({ w, h, rows, min, max, draw }) {
  const m = { l: 62, r: 14, t: 10, b: 40 }, pw = w - m.l - m.r, ph = h - m.t - m.b, n = rows.length;
  const sc = niceScale(min, max), slot = pw / n;
  const y = v => m.t + ph * (1 - (v - sc.lo) / (sc.hi - sc.lo));
  const xc = i => m.l + slot * (i + 0.5);
  let g = "";
  for (const t of sc.ticks) {
    g += `<line x1="${m.l}" x2="${w - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? RP.axis : RP.grid}" stroke-width="1"/>` +
         `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" font-size="12" fill="${RP.sub}" font-family="sans-serif">${rpAxis(t)}</text>`;
  }
  const every = Math.max(1, Math.ceil(n / 12));
  rows.forEach((r, i) => {
    if (i % every) return;
    g += `<text x="${xc(i)}" y="${h - 22}" text-anchor="middle" font-size="12" fill="${RP.sub}" font-family="sans-serif">${r.year}</text>` +
         `<text x="${xc(i)}" y="${h - 7}" text-anchor="middle" font-size="11" fill="#7a8294" font-family="sans-serif">${r.age}歳</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${g}${draw({ y, xc, slot, n })}</svg>`;
}
const rpLegend = items => `<div class="rp-legend">${items.map(([c, t, line]) => `<span><i class="${line ? "ln" : ""}" style="background:${c}"></i>${t}</span>`).join("")}</div>`;
const areaPath = (pts, base) => "M" + pts.map(p => `${p[0]},${p[1]}`).join("L") +
  pts.map((p, i) => `L${pts[pts.length - 1 - i][0]},${base[pts.length - 1 - i]}`).join("") + "Z";

// 資産推移: 預貯金 + 投資 の積み上げ面と、合計の線
function chartAssets(rows, w, h) {
  const min = Math.min(0, ...rows.map(r => r.balance)), max = Math.max(1, ...rows.map(r => r.balance));
  return rpPlot({ w, h, rows, min, max, draw: ({ y, xc }) => {
    const cash = rows.map(r => Math.max(r.cashBal, 0)), inv = rows.map(r => Math.max(r.investBal, 0));
    const P = (arr) => rows.map((_, i) => [xc(i), y(arr[i])]);
    const cashTop = P(cash), top = P(cash.map((c, i) => c + inv[i]));
    const zero = rows.map(() => y(0)), cashBase = cashTop.map(p => p[1]);
    return `<path d="${areaPath(cashTop, zero)}" fill="${RP.cats[0]}" fill-opacity=".85" stroke="#fff" stroke-width="1.5"/>` +
      `<path d="${areaPath(top, cashBase)}" fill="${RP.cats[1]}" fill-opacity=".85" stroke="#fff" stroke-width="1.5"/>` +
      `<path d="M${rows.map((r, i) => `${xc(i)},${y(r.balance)}`).join("L")}" fill="none" stroke="${RP.ink}" stroke-width="2"/>`;
  } });
}
// キャッシュフロー: 支出の積み上げ棒 + 収入の線
const OUT_KEYS = [["living", "生活費"], ["housing", "住居費"], ["child", "子ども費用"], ["debt", "ローン返済"], ["eventCost", "イベント・その他"]];
function chartCashflow(rows, w, h) {
  const tot = r => OUT_KEYS.reduce((t, [k]) => t + Math.max(r[k], 0), 0);
  const max = Math.max(1, ...rows.map(r => Math.max(tot(r), r.incomeTotal)));
  return rpPlot({ w, h, rows, min: 0, max, draw: ({ y, xc, slot }) => {
    const bw = Math.max(2, slot * 0.68);
    let out = "";
    rows.forEach((r, i) => {
      let acc = 0;
      OUT_KEYS.forEach(([k], ci) => {
        const v = Math.max(r[k], 0); if (v <= 0) return;
        out += `<rect x="${xc(i) - bw / 2}" y="${y(acc + v)}" width="${bw}" height="${Math.max(0, y(acc) - y(acc + v))}" fill="${RP.cats[ci]}" stroke="#fff" stroke-width="1"/>`;
        acc += v;
      });
    });
    return out + `<path d="M${rows.map((r, i) => `${xc(i)},${y(r.incomeTotal)}`).join("L")}" fill="none" stroke="${RP.ink}" stroke-width="2"/>` +
      rows.map((r, i) => (rows.length <= 40 || i % 2 === 0) ? `<circle cx="${xc(i)}" cy="${y(r.incomeTotal)}" r="2.8" fill="${RP.ink}" stroke="#fff" stroke-width="1"/>` : "").join("");
  } });
}
// 投資運用: 元本 + 運用収益(面の積み上げ)
function chartInvest(rows, w, h, initInvest) {
  let cum = initInvest;
  const data = rows.map(r => { cum += r.contrib; const inv = Math.max(r.investBal, 0), p = Math.min(cum, inv); return { p, g: inv - p }; });
  const max = Math.max(1, ...data.map(d => d.p + d.g));
  return rpPlot({ w, h, rows, min: 0, max, draw: ({ y, xc }) => {
    const base = rows.map(() => y(0));
    const pr = data.map((d, i) => [xc(i), y(d.p)]), tp = data.map((d, i) => [xc(i), y(d.p + d.g)]);
    return `<path d="${areaPath(pr, base)}" fill="${RP.cats[0]}" fill-opacity=".85" stroke="#fff" stroke-width="1.5"/>` +
      `<path d="${areaPath(tp, pr.map(p => p[1]))}" fill="${RP.cats[1]}" fill-opacity=".85" stroke="#fff" stroke-width="1.5"/>`;
  } });
}
// 子ども費用の推移: 子どもごとの積み上げ棒
function chartChildren(rows, w, h, perChild) {
  const tot = i => perChild.reduce((t, c) => t + c.vals[i], 0);
  const max = Math.max(1, ...rows.map((_, i) => tot(i)));
  return rpPlot({ w, h, rows, min: 0, max, draw: ({ y, xc, slot }) => {
    const bw = Math.max(4, slot * 0.72); let out = "";
    rows.forEach((_, i) => {
      let acc = 0;
      perChild.forEach((c, ci) => {
        const v = c.vals[i]; if (v <= 0) return;
        out += `<rect x="${xc(i) - bw / 2}" y="${y(acc + v)}" width="${bw}" height="${Math.max(0, y(acc) - y(acc + v))}" fill="${RP.cats[ci % RP.cats.length]}" stroke="#fff" stroke-width="1"/>`;
        acc += v;
      });
    });
    return out;
  } });
}

// ---------- ページの部品 ----------
function rpPage(title, { unit = false, cls = "" } = {}) {
  const el = document.createElement("section");
  el.className = "rp-page " + cls;
  el.innerHTML = `<div class="rp-head"><div class="rp-brand">ライフプランシミュレーター</div><div class="rp-title">${esc(title)}</div><div class="rp-date">${RP_DATE} 作成</div></div>${unit ? '<div class="rp-unit">(単位:万円)</div>' : ""}<div class="rp-foot"></div>`;
  return el;
}
let RP_DATE = "";
const rpTable = (head, rows, opt = {}) => `<table class="rp-t ${opt.kv ? "rp-kv" : ""}">` +
  (head ? `<tr>${head.map(h => `<th>${h}</th>`).join("")}</tr>` : "") +
  rows.map(r => `<tr class="${r.sum ? "sum" : ""}">${(r.cells || r).map((c, i) => {
    const cls = opt.kv ? "" : (opt.align && opt.align[i]) || "";
    return opt.kv && i === 0 ? `<th>${c}</th>` : `<td class="${cls}">${c}</td>`;
  }).join("")}</tr>`).join("") + "</table>";
const rpCard = (title, body) => { const d = document.createElement("div"); d.className = "rp-card"; d.innerHTML = `<h3>${title}</h3><div class="rp-body">${body}</div>`; return d; };

// ---------- レポート全体 ----------
function buildReport() {
  const S = state, R = result, rows0 = R.rows;
  const now = new Date(), y0 = now.getFullYear();
  RP_DATE = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const rows = rows0.map((r, i) => ({ ...r, year: y0 + i }));
  const name = (currentProfile().name || "").trim();
  const who = name ? `${esc(name)}さま` : "あなた";
  const root = document.createElement("div"); root.className = "rp-root";
  const pages = [];
  const add = p => { root.append(p); pages.push(p); return p; };
  document.body.append(root);

  // 1. 表紙
  const cover = document.createElement("section"); cover.className = "rp-page";
  cover.innerHTML = `<div class="rp-cover"><div class="bar"></div><h1>ライフプラン<br>シミュレーションレポート</h1>
    <div class="for">【${who}のライフプラン】</div><div class="when">${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 作成</div></div><div class="rp-foot"></div>`;
  add(cover);

  // 2. 結果サマリー
  const sum = rpPage("シミュレーション結果");
  const ok = R.depletedAge === null;
  const effect = R.monthlyContrib > 0 ? (() => {
    const base = LifePlan.simulate({ ...S, assets: S.assets.map(x => ({ ...x, monthly: 0 })) });
    const d = R.finalBalance - base.finalBalance;
    return `毎月${(Math.round(R.monthlyContrib * 10) / 10).toLocaleString("ja-JP")}万円の積立で、積立をしない場合より最終資産が<b>約${rpMoney(Math.abs(d))}${d >= 0 ? "多く" : "少なく"}</b>なる見込みです。`;
  })() : "毎月の積立は設定されていません。";
  const initInvest = S.assets.filter(a => a.type === "invest").reduce((t, a) => t + a.amount, 0);
  sum.insertAdjacentHTML("beforeend", `
    <div class="rp-sum">
      <div class="rp-verdict ${ok ? "ok" : "ng"}"><div class="ic">${ok ? "🎉" : "⚠️"}</div><div>
        <b>${ok ? `${S.endAge}歳まで、資産は尽きない見込みです` : `${R.depletedAge}歳ごろに、資産が尽きる見込みです`}</b>
        <span>${ok ? "条件を変えたときの結果は、アプリでいつでも確認できます。" : "生活費・住居費の見直し、働く期間の延長、積立の増額などで改善できます。"}</span></div></div>
      <div class="rp-kpis">
        <div class="rp-kpi"><small>現在の資産</small><strong>${rpMoney(R.assetTotal)}</strong></div>
        <div class="rp-kpi"><small>退職時の資産(${S.retireAge}歳)</small><strong class="${(R.retireBalance ?? 0) < 0 ? "neg" : ""}">${R.retireBalance === null ? "-" : rpMoney(R.retireBalance)}</strong></div>
        <div class="rp-kpi"><small>最終資産(${S.endAge}歳)</small><strong class="${R.finalBalance < 0 ? "neg" : ""}">${rpMoney(R.finalBalance)}</strong></div>
      </div></div>
    <div class="rp-effect">📈 ${effect}</div>
    <div class="rp-chart"><h3>資産推移グラフ</h3>${chartAssets(rows, 1040, 420)}${rpLegend([[RP.cats[0], "預貯金"], [RP.cats[1], "投資"], [RP.ink, "資産合計", true]])}</div>`);
  add(sum);

  // 3〜. 入力データ一覧(2列に流し込み、はみ出したら次のページへ)
  const cards = [];
  const age = (a) => a < 0 ? `${-a}年後に誕生予定` : `${a}歳`;
  cards.push(rpCard("基本設定", rpTable(null, [
    ["開始年", `${y0}年`], ["現在の年齢", `${S.age}歳`], ["退職年齢", `${S.retireAge}歳`],
    ["シミュレーション終了", `${S.endAge}歳`], ["昇給率", `${S.raise}%`], ["物価上昇率", `${S.inflation}%`],
  ], { kv: true })));
  const fam = [["本人", `${S.age}歳`, "-"]];
  if (S.spouse.enabled) fam.push(["配偶者", `${S.spouse.age}歳`, "-"]);
  S.children.forEach(c => fam.push([esc(c.name || "子ども"), age(c.age), esc(LifePlan.EDU_COURSES[c.course]?.label || "")]));
  cards.push(rpCard("ご家族構成", rpTable(["続柄", "年齢", "進路"], fam, { align: ["", "c", ""] })));
  const pensionRow = (p, est) => p.pensionMode === "manual" ? ["年金(手入力)", `${rpMoney(p.pension)}/年`] : ["年金(自動見積り)", `${rpMoney(est)}/年`];
  const incKv = (p, est, title) => rpCard(title, rpTable(null, [
    ["年間手取り収入", rpMoney(p.income)], ["昇給率", `${p.raise}%`], ["就労期間", `〜${p.retireAge}歳`], ["退職金", `${rpMoney(p.severance)}(${p.retireAge}歳)`],
    ["年金受給開始", `${p.pensionAge}歳`], pensionRow(p, est),
  ], { kv: true }) + (p.pensionMode !== "manual" ? `<p class="rp-note">${{ employee: "会社員・公務員", self: "自営業・フリーランス", none: "専業主婦(夫)など" }[p.job]}${p.job === "employee" ? `/厚生年金 ${p.startAge}〜${p.kouseiEnd > 0 ? Math.min(p.kouseiEnd, p.retireAge) : p.retireAge}歳/平均年収${rpMoney(p.avgGross)}` : ""}</p>` : ""));
  cards.push(incKv(S, R.myPension, "本人の収入・年金"));
  if (S.spouse.enabled) cards.push(incKv(S.spouse, R.spousePension, "配偶者の収入・年金"));
  const asset = S.assets.map(a => [esc(a.name), a.type === "invest" ? "投資" : "預貯金", rpMoney(a.amount), `${a.rate}%`, a.monthly ? `${a.monthly}万円/月` : "-", a.monthly ? `〜${a.until > 0 ? a.until : S.retireAge}歳` : "-"]);
  asset.push({ sum: true, cells: ["合計", "", rpMoney(R.assetTotal), "", R.monthlyContrib ? `${Math.round(R.monthlyContrib * 10) / 10}万円/月` : "-", ""] });
  cards.push(rpCard("現在の資産・毎月の積立", rpTable(["口座", "種類", "金額", "利回り", "積立", "積立期間"], asset, { align: ["", "c", "n", "n", "n", "c"] })));
  if (S.debts.length) cards.push(rpCard("既存のローン", rpTable(["名称", "残高", "金利", "残り年数"], S.debts.map(d => [esc(d.name), rpMoney(d.balance), `${d.rate}%`, `${d.years}年`]), { align: ["", "n", "n", "c"] })));
  const living = S.livingItems.map(it => [esc(it.name || "-"), `${it.monthly}万円`]);
  living.push({ sum: true, cells: ["月額合計", `${Math.round(S.livingItems.reduce((t, i) => t + i.monthly, 0) * 10) / 10}万円(年額${rpMoney(S.living)})`] });
  cards.push(rpCard("生活費(月額)", rpTable(["項目", "月額"], living, { align: ["", "n"] }) + `<p class="rp-note">退職後は生活費を${S.retireLivingRatio}%として計算しています。</p>`));
  const h = S.housing;
  const house = h.type === "rent" ? [["住まい", "賃貸(住み続ける)"], ["家賃", `${rpMoney(h.rent)}/年`]]
    : h.type === "own" ? [["住まい", "持ち家(購入済み)"], ["ローン残高", rpMoney(h.ownLoan)], ["金利/残り年数", `${h.ownRate}% / ${h.ownYears}年`],
        ["管理費・修繕積立金", `${h.ownMgmt}万円/月`], ["固定資産税等", `${rpMoney(h.ownTax)}/年`], ["修繕・メンテナンス費", `${rpMoney(h.ownRepair)}/年`]]
    : [["住まい", `賃貸 → ${h.buyAge}歳で購入`], ["賃貸中の家賃", `${rpMoney(h.rent)}/年`], ["物件価格 / 頭金", `${rpMoney(h.price)} / ${rpMoney(h.down)}`], ["諸費用", rpMoney(h.closing)],
        ["借入額", rpMoney(h.price - h.down)], ["金利 / 返済年数", `${h.rate}% / ${h.years}年`], ["管理・修繕・税", `${rpMoney(h.upkeep)}/年`]];
  cards.push(rpCard("住居", rpTable(null, house, { kv: true })));
  // 子ども費用(養育費+学費、物価上昇込み)を子どもごとに集計
  const perChild = S.children.map((c, ci) => ({ name: c.name || "子ども" + (ci + 1), vals: rows.map((_, n) => {
    const infl = Math.pow(1 + S.inflation / 100, n), ca = c.age + n;
    return ((ca >= 0 && ca <= 21 ? S.childCost : 0) + LifePlan.eduCost(c.course, ca)) * infl;
  }) }));
  if (S.children.length) cards.push(rpCard("子どもの費用", rpTable(["子ども", "進路", "総額(目安)"], S.children.map((c, i) => [esc(c.name || "子ども"), esc(LifePlan.EDU_COURSES[c.course]?.label || ""), rpMoney(perChild[i].vals.reduce((t, v) => t + v, 0))]), { align: ["", "", "n"] }) +
    `<p class="rp-note">養育費(1人あたり年${S.childCost}万円・0〜21歳)と、進路に応じた学費の目安の合計です。</p>`));
  if (S.events.length) cards.push(rpCard("ライフイベント", rpTable(["年齢", "内容", "金額"], S.events.map(e => [`${e.age}歳`, esc(e.name), e.amount >= 0 ? `-${rpMoney(e.amount)}` : `+${rpMoney(-e.amount)}`]), { align: ["c", "", "n"] })));

  const inputPages = [];
  const newInputPage = () => {
    const p = rpPage("入力データ一覧"); const cols = document.createElement("div"); cols.className = "rp-cols";
    cols.innerHTML = '<div class="rp-col"></div><div class="rp-col"></div>'; p.insertBefore(cols, p.querySelector(".rp-foot"));
    root.append(p); pages.push(p); inputPages.push(p); return p;
  };
  let pg = newInputPage(), ci = 0;
  for (const card of cards) {
    for (;;) {
      const col = pg.querySelectorAll(".rp-col")[ci];
      col.append(card);
      if (col.scrollHeight <= col.clientHeight + 1 || col.children.length === 1) break; // 収まった/1枚だけなら確定
      card.remove();
      if (ci === 0) ci = 1; else { pg = newInputPage(); ci = 0; }
    }
  }
  inputPages.forEach((p, i) => { p.querySelector(".rp-title").textContent = `入力データ一覧 ${i + 1}/${inputPages.length}`; });

  // キャッシュフロー表(1ページ20年ずつ。年を横に並べる)
  const nTab = Math.ceil(rows.length / 20), PER = Math.ceil(rows.length / nTab); // 1ページ20列まで。ページ間で列数を均等にする
  const sp = S.spouse.enabled;
  const rowDefs = [
    ["sec age", "家族年齢"],
    ["l", "本人", r => r.age],
    ...(sp ? [["l", "配偶者", r => r.spouseAge]] : []),
    ...S.children.map((c, i) => ["l", esc(c.name || "子ども" + (i + 1)), (r, n) => c.age + n]),
    ["sec inc", "収入"],
    ["s", "給与(本人)", r => r.salary], ...(sp ? [["s", "給与(配偶者)", r => r.spouseSalary]] : []),
    ["s", "年金", r => r.pension], ["s", "退職金", r => r.severance], ["s", "運用益", r => r.invest], ["tot", "収入合計", r => r.incomeTotal],
    ["sec out", "支出"],
    ["s", "生活費", r => r.living], ["s", "住居費", r => r.housing], ["s", "子ども費用", r => r.child], ["s", "ローン返済", r => r.debt],
    ["s", "イベント・その他", r => r.eventCost], ["tot", "支出合計", r => r.outgoTotal],
    ["sec bal", "収支・資産"],
    ["s", "年間収支", r => r.net], ["s", "積立額(投資へ)", r => r.contrib], ["s", "預貯金残高", r => r.cashBal], ["s", "投資残高", r => r.investBal], ["tot", "資産合計", r => r.balance],
  ];
  const rh = Math.max(15, Math.min(22, Math.floor(600 / (rowDefs.length + 2))));
  const fs = rh >= 19 ? 12 : rh >= 17 ? 11 : 10;
  for (let t = 0; t < nTab; t++) {
    const slice = rows.slice(t * PER, (t + 1) * PER), pad = PER - slice.length;
    const p = rpPage(`キャッシュフロー表 ${t + 1}/${nTab}`, { unit: true });
    const empty = '<td></td>'.repeat(pad);
    let html = `<table class="rp-cf" style="font-size:${fs}px"><colgroup><col style="width:132px">${'<col>'.repeat(PER)}</colgroup>` +
      `<tr style="height:${rh}px"><th class="l">西暦</th>${slice.map(r => `<th>${r.year}</th>`).join("")}${'<th></th>'.repeat(pad)}</tr>`;
    for (const [cls, label, f] of rowDefs) {
      if (cls.startsWith("sec")) { html += `<tr class="${cls}" style="height:${rh}px"><td colspan="${PER + 1}">${label}</td></tr>`; continue; }
      html += `<tr class="${cls === "tot" ? "tot" : ""}" style="height:${rh}px"><td class="${cls === "s" ? "sub" : "l"}">${cls === "s" ? "├ " : ""}${label}</td>` +
        slice.map((r, k) => {
          const v = f(r, t * PER + k);
          if (cls === "l") return `<td>${v === null || v === undefined ? "-" : v}</td>`;
          return `<td class="${v < -0.5 ? "neg" : ""}">${rpNum(v)}</td>`;
        }).join("") + empty + "</tr>";
    }
    p.querySelector(".rp-foot").insertAdjacentHTML("beforebegin", html + "</table>");
    add(p);
  }

  // グラフ
  const g1 = rpPage("グラフ 1");
  g1.insertAdjacentHTML("beforeend", `<div class="rp-chart"><h3>キャッシュフローグラフ</h3><p class="sub">支出の内訳(積み上げ)と、収入合計(線)。単位:万円</p>${chartCashflow(rows, 1040, 270)}${rpLegend([...OUT_KEYS.map(([, l], i) => [RP.cats[i], l]), [RP.ink, "収入合計", true]])}</div>` +
    (R.assetTotal > 0 || rows.some(r => r.investBal > 1) ? `<div class="rp-chart"><h3>投資運用グラフ</h3><p class="sub">投資残高の内訳(元本=現在の投資+積立の累計)。単位:万円</p>${chartInvest(rows, 1040, 230, initInvest)}${rpLegend([[RP.cats[0], "元本"], [RP.cats[1], "運用収益"]])}</div>` : ""));
  add(g1);
  if (S.children.length) {
    const last = Math.max(0, ...perChild.map(c => c.vals.reduce((m, v, i) => v > 0 ? i : m, 0)));
    const first = Math.min(...perChild.map(c => Math.max(0, c.vals.findIndex(v => v > 0))));
    const sl = rows.slice(first, last + 1), pc = perChild.slice(0, 8).map(c => ({ name: c.name, vals: c.vals.slice(first, last + 1) }));
    const total = perChild.reduce((t, c) => t + c.vals.reduce((a, v) => a + v, 0), 0);
    const g2 = rpPage("グラフ 2");
    g2.insertAdjacentHTML("beforeend", `<div class="rp-chart"><h3>子ども費用の推移(養育費+学費)</h3><p class="sub">総額 <b>${rpMoney(total)}</b>(内訳: ${perChild.map(c => `${esc(c.name)} ${rpMoney(c.vals.reduce((a, v) => a + v, 0))}`).join(" / ")})</p>${chartChildren(sl, 1040, 470, pc)}${rpLegend(pc.map((c, i) => [RP.cats[i], esc(c.name)]))}</div>`);
    add(g2);
  }

  // 前提と注意事項
  const note = rpPage("シミュレーションの前提と注意事項");
  note.insertAdjacentHTML("beforeend", `<div class="rp-card" style="margin-top:14px"><h3>この試算について</h3><div class="rp-body" style="font-size:14px;line-height:1.85">
    <ul style="margin:6px 0 4px 0;padding:0 0 0 22px;list-style:disc">
      <li style="margin:0 0 4px">本レポートは、入力された条件にもとづく<b>概算</b>です。将来の収入・支出・運用成績を保証するものではありません。</li>
      <li style="margin:0 0 4px">収入は<b>手取り額</b>で入力した前提で、所得税・住民税・社会保険料の計算は行っていません。</li>
      <li style="margin:0 0 4px">公的年金は、基礎年金の満額と厚生年金の計算式による簡易な見積もりです(加給年金・経過的加算・年金額の改定は含みません)。正確な見込額は「ねんきんネット」等でご確認ください。</li>
      <li style="margin:0 0 4px">運用利回りは名目値で、運用にかかる税金・手数料は含みません。物価上昇率は生活費などの支出に反映しています(年金額は物価に連動させていません)。</li>
      <li style="margin:0 0 4px">資産は口座ごとに管理しています。毎月の積立は各口座へ積み増し、収支の余りは最初の「預貯金」口座に入れ、不足分は預貯金 → 投資の順に取り崩す前提です。</li>
      <li style="margin:0 0 4px">学費・養育費は平均的な目安の金額です。住宅ローン控除・繰り上げ返済・金利の見直し・住み替え・介護・相続などは含みません。</li>
      <li style="margin:0 0 4px">重要な意思決定の際は、ファイナンシャルプランナーなどの専門家にご相談ください。</li>
    </ul></div></div>`);
  add(note);

  // ページ番号
  pages.forEach((p, i) => { p.querySelector(".rp-foot").textContent = `${i + 1} / ${pages.length}`; });
  return { root, pages };
}

// ---------- PDF出力 ----------
function loadScript(src) {
  return new Promise((ok, ng) => {
    if (document.querySelector(`script[data-lib="${src}"]`)) return ok();
    const s = document.createElement("script"); s.src = src; s.dataset.lib = src; s.onload = ok; s.onerror = () => ng(new Error(src));
    document.head.append(s);
  });
}
// ブラウザ標準のダウンロード(日本語のファイル名でも確実に付く)
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function exportPdf() {
  const btn = document.getElementById("pdfBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  const overlay = document.createElement("div"); overlay.className = "rp-overlay";
  overlay.innerHTML = '<div class="rp-spin"></div><div id="rpMsg">レポートを準備しています…</div><small>完了するまで、この画面を閉じないでください</small>';
  document.body.append(overlay);
  const msg = t => { document.getElementById("rpMsg").textContent = t; };
  let root = null;
  const scrollY = window.scrollY;
  try {
    await Promise.all([loadScript("vendor/html2canvas.min.js"), loadScript("vendor/jspdf.umd.min.js")]);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    window.scrollTo(0, 0);
    const built = buildReport(); root = built.root;
    await new Promise(r => setTimeout(r, 50));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    for (let i = 0; i < built.pages.length; i++) {
      msg(`PDFを作成しています… ${i + 1} / ${built.pages.length}`);
      await new Promise(r => setTimeout(r, 20)); // 進捗表示を更新させる
      const canvas = await html2canvas(built.pages[i], { scale: 2, backgroundColor: "#ffffff", logging: false, windowWidth: 1200, scrollX: 0, scrollY: 0 });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 297, 210, undefined, "FAST");
      canvas.width = canvas.height = 0;
    }
    const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    downloadBlob(pdf.output("blob"), `lifeplan-report_${stamp}.pdf`); // 環境によって日本語のファイル名が付かないことがあるため、英数字にしている
  } catch (e) {
    console.error(e);
    alert("PDFを作成できませんでした。通信状況を確認して、もう一度お試しください。");
  } finally {
    if (root) root.remove();
    overlay.remove();
    window.scrollTo(0, scrollY);
    btn.disabled = false;
  }
}
