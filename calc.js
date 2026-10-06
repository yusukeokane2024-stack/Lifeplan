// ライフプランのシミュレーション(純粋関数)。金額の単位は「万円」。
(function (root) {
  // 学費の概算(年額・万円)。文部科学省「子供の学習費調査」等の平均値をもとにした目安。
  const EDU_COURSES = {
    pub:         { label: "すべて公立(大学は国公立)",   k: 17, e: 35,  j: 54,  h: 51,  u: 80 },
    univPrivArts:{ label: "大学のみ私立文系",           k: 17, e: 35,  j: 54,  h: 51,  u: 120 },
    univPrivSci: { label: "大学のみ私立理系",           k: 17, e: 35,  j: 54,  h: 51,  u: 160 },
    highPriv:    { label: "高校から私立(大学は私立文系)", k: 17, e: 35,  j: 54,  h: 105, u: 120 },
    allPriv:     { label: "すべて私立(大学は私立文系)",   k: 31, e: 167, j: 144, h: 105, u: 120 },
  };

  function eduCost(course, c) {
    const t = EDU_COURSES[course] || EDU_COURSES.pub;
    if (c >= 3 && c <= 5) return t.k;
    if (c >= 6 && c <= 11) return t.e;
    if (c >= 12 && c <= 14) return t.j;
    if (c >= 15 && c <= 17) return t.h;
    if (c >= 18 && c <= 21) return t.u;
    return 0;
  }

  // 元利均等返済の年間返済額
  function annualPayment(loan, ratePct, years) {
    if (loan <= 0 || years <= 0) return 0;
    const r = ratePct / 100;
    return r === 0 ? loan / years : (loan * r) / (1 - Math.pow(1 + r, -years));
  }

  // 公的年金の概算(年額・万円)。令和7年度の満額・乗率をもとにした目安で、物価・賃金スライドや加給年金等は含まない。
  const BASIC_FULL = 83.1;      // 老齢基礎年金(満額・40年加入)
  const KOUSEI_RATE = 0.005481; // 老齢厚生年金の乗率(平均標準報酬額 × 乗率 × 加入月数)
  function estimatePension(o) {
    // o: { job: "employee" | "self" | "none", startAge, kouseiEnd(0=退職まで), avgGross, retireAge, pensionAge }
    let total = BASIC_FULL; // 20〜60歳の40年間、保険料を納付した(または第3号)前提
    if (o.job === "employee") {
      // 会社員を途中でやめた場合(kouseiEnd)は、その年齢までが厚生年金の加入期間
      const end = o.kouseiEnd > 0 ? Math.min(o.kouseiEnd, o.retireAge) : o.retireAge;
      const months = Math.max(0, (Math.min(end, 70) - o.startAge) * 12);
      const avgMonthly = Math.min(o.avgGross / 12, 100); // 標準報酬(賞与込み)の上限をざっくり反映
      total += avgMonthly * KOUSEI_RATE * months;
    }
    // 繰上げ: 1か月あたり-0.4%(最大60か月) / 繰下げ: 1か月あたり+0.7%(最大120か月)
    const diff = Math.max(60, Math.min(75, o.pensionAge)) - 65;
    total *= diff < 0 ? 1 + 0.004 * diff * 12 : 1 + 0.007 * diff * 12;
    return Math.round(total * 10) / 10;
  }
  // 公的年金の手取り率(%)の目安。年金額(額面・年額・万円)が多いほど、税金・国民健康保険料・介護保険料の割合が増える。
  // 65歳以上・公的年金のみ・扶養なしの概算で、自治体や家族構成によって前後する。
  const PENSION_NET_TABLE = [[0, 100], [100, 97], [150, 94], [200, 91.5], [300, 88], [400, 85.5], [600, 82]];
  function pensionNetRate(gross) {
    const t = PENSION_NET_TABLE;
    if (gross <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++) if (gross <= t[i][0]) return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * (gross - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
    return t[t.length - 1][1];
  }
  // 年金の手取り額。mode: "auto"(年金額に応じた目安) / "rate"(一律の率) / "none"(換算しない)
  function pensionNet(gross, mode, rate) {
    if (mode === "none") return gross;
    const r = mode === "rate" ? Math.max(0, Math.min(100, rate)) : pensionNetRate(gross);
    return Math.round(gross * r) / 100;
  }
  function pensionOf(person) {
    return person.pensionMode === "manual" ? person.pension : estimatePension(person);
  }

  // 返済開始から k 年経過した時点のローン残高(annualPayment と同じ、年1回払いの前提)
  function loanBalance(principal, ratePct, years, k) {
    if (principal <= 0 || k >= years) return 0;
    if (k <= 0) return principal;
    const r = ratePct / 100, P = annualPayment(principal, ratePct, years);
    return r === 0 ? principal - P * k : principal * Math.pow(1 + r, k) - P * (Math.pow(1 + r, k) - 1) / r;
  }

  // ローンの現在の状態。mode:"auto" は「借入額・借入した年(西暦)・返済期間(総年数)・金利」から、
  // それ以外は「いまの残高・残り年数」から求める。k は返済開始から現在までの経過年数。
  function loanStatus(o, nowYear) {
    const rate = o.rate || 0;
    if (o.mode === "auto") {
      const term = Math.max(0, Math.round(o.term || 0)), borrow = o.borrow || 0;
      const k = Math.max(0, Math.min(term, nowYear - Math.round(o.borrowYear || nowYear)));
      return { principal: borrow, term, k, balance: loanBalance(borrow, rate, term, k), remaining: term - k, payment: annualPayment(borrow, rate, term) };
    }
    const years = Math.max(0, Math.round(o.years || 0)), bal = o.balance || 0;
    return { principal: bal, term: years, k: 0, balance: bal, remaining: years, payment: annualPayment(bal, rate, years) };
  }

  function simulate(p) {
    const sp = p.spouse && p.spouse.enabled ? p.spouse : null;
    const h = p.housing;
    // 住まいの状態: 賃貸(kind:"rent") か 持ち家(kind:"own": ローン+維持費)。住み替えで年ごとに切り替わる
    const nowYear = p.nowYear || new Date().getFullYear();
    let cur = { kind: "rent", rent: h.rent };
    if (h.type === "own") {
      const st = loanStatus({ mode: h.ownMode === "auto" ? "auto" : "balance", borrow: h.ownBorrow, borrowYear: h.ownBorrowYear, term: h.ownTerm, rate: h.ownRate, balance: h.ownLoan, years: h.ownYears }, nowYear);
      // 返済開始を「いまから k 年前」に置くことで、返済済みの年数がそのまま売却時の残債計算に使える
      cur = { kind: "own", principal: st.principal, rate: h.ownRate, years: st.term, startAge: p.age - st.k, upkeep: h.ownMgmt * 12 + h.ownTax + h.ownRepair };
    }
    // 住み替え: 「将来購入する」(従来の設定)も、最初の住み替えとして扱う
    const moves = [];
    if (h.type === "buy") moves.push({ age: h.buyAge, name: "住宅購入", type: "buy", price: h.price, down: h.down, closing: h.closing, rate: h.rate, years: h.years, upkeep: h.upkeep, salePrice: 0, sellCost: 0 });
    for (const m of Array.isArray(p.moves) ? p.moves : []) moves.push({ name: "住み替え", ...m });
    moves.sort((a, b) => a.age - b.age); // 同じ年齢なら入力順(sort は安定)
    const myPension = pensionOf(p);                         // 額面
    const spousePension = sp ? pensionOf(sp) : 0;
    const netMode = p.pensionNetMode || "none";             // 未設定の古いデータは換算しない(旧版と同じ結果)
    const myPensionNet = pensionNet(myPension, netMode, p.pensionNetRate);
    const spousePensionNet = pensionNet(spousePension, netMode, p.pensionNetRate);
    const rows = [];
    // 資産は口座ごとに管理する。毎月の積立は各口座へ、収支の余りは最初の預貯金口座へ入れ、
    // 足りない分は預貯金 → 投資の順に取り崩す。
    const buckets = (Array.isArray(p.assets) ? p.assets : [{ amount: p.savings, rate: p.returnRate, type: "cash" }])
      .map(a => ({ amount: a.amount, rate: a.rate, monthly: a.monthly || 0, until: a.until > 0 ? a.until : p.retireAge, cash: a.type !== "invest" }));
    if (!buckets.some(x => x.cash)) buckets.push({ amount: 0, rate: 0, monthly: 0, until: 0, cash: true });
    const sink = buckets.find(x => x.cash);
    const withdrawOrder = [...buckets.filter(x => x.cash), ...buckets.filter(x => !x.cash)];
    const sumOf = f => buckets.reduce((t, x) => t + f(x), 0);
    const assetTotal = sumOf(x => x.amount);
    const returnRate = assetTotal > 0 ? sumOf(x => x.amount * x.rate) / assetTotal : 0; // 表示用の加重平均
    const monthlyContrib = sumOf(x => (p.age < x.until ? x.monthly : 0));
    const debts = Array.isArray(p.debts) ? p.debts : [];
    // 収入の変化(フリーランス・転職・育休・休職など)。期間外は、元の「年収×昇給率」の道すじに戻る
    const changes = (Array.isArray(p.incomeChanges) ? p.incomeChanges : []).map(c => ({ who: "me", ...c })).sort((a, b) => a.from - b.from);
    const salaryOf = (who, baseIncome, baseRaise, personAge, n, retireAge) => {
      let v = baseIncome * Math.pow(1 + baseRaise / 100, n);
      for (const c of changes) {
        if (c.who !== who) continue;
        const to = c.to > 0 ? c.to : retireAge;
        if (personAge >= c.from && personAge < to) v = c.income * Math.pow(1 + (c.raise || 0) / 100, personAge - c.from);
      }
      return v;
    };
    const debtStates = debts.map(d => loanStatus(d, p.nowYear || new Date().getFullYear()));
    let depletedAge = null, prevBalance = assetTotal;

    for (let age = p.age; age <= p.endAge; age++) {
      const n = age - p.age;
      const working = age < p.retireAge;
      const infl = Math.pow(1 + p.inflation / 100, n);

      const salary = working ? salaryOf("me", p.income, p.raise, age, n, p.retireAge) : 0;
      let pension = age >= p.pensionAge ? myPensionNet : 0;
      let severance = age === p.retireAge ? p.severance : 0;
      let spouseSalary = 0, spouseAge = null;
      if (sp) {
        spouseAge = sp.age + n;
        if (spouseAge < sp.retireAge) spouseSalary = salaryOf("spouse", sp.income, sp.raise, spouseAge, n, sp.retireAge);
        if (spouseAge >= sp.pensionAge) pension += spousePensionNet;
        if (spouseAge === sp.retireAge) severance += sp.severance;
      }

      const living = (working ? p.living : p.living * (p.retireLivingRatio / 100)) * infl;

      // 住み替え(この年齢の分を先に反映)
      let moveCash = 0; const moveNames = [];
      for (const m of moves) {
        if (m.age !== age) continue;
        if (cur.kind === "own") { // 旧居が持ち家: 売却価格 - ローン残債 - 売却費用 が手元に入る(不足なら支出)
          const bal = loanBalance(cur.principal, cur.rate, cur.years, age - cur.startAge);
          moveCash -= (m.salePrice || 0) - bal - (m.sellCost || 0);
        }
        if (m.type === "buy") {
          moveCash += (m.down || 0) + (m.closing || 0);
          cur = { kind: "own", principal: Math.max(0, m.price - m.down), rate: m.rate, years: m.years, startAge: age, upkeep: m.upkeep };
        } else cur = { kind: "rent", rent: m.rent };
        moveNames.push(m.name || "住み替え");
      }
      // 住居費: 賃貸=家賃 / 持ち家=ローン返済(返済期間中)+維持費(物価に連動)
      let housing = 0;
      if (cur.kind === "rent") housing = cur.rent;
      else {
        if (age - cur.startAge < cur.years) housing += annualPayment(cur.principal, cur.rate, cur.years);
        housing += cur.upkeep * infl;
      }
      let child = 0;
      for (const c of p.children) {
        const ca = c.age + n;
        if (ca >= 0 && ca <= 21) child += p.childCost * infl;
        child += eduCost(c.course, ca) * infl;
      }

      let debt = 0;
      for (const st of debtStates) if (n < st.remaining) debt += st.payment;

      const events = p.events.filter(e => e.age === age);
      const eventCost = events.reduce((s, e) => s + e.amount, 0) + moveCash;
      // 運用益(年初の残高に対して)→ 積立(年末に積み増し)→ 収支の余り/不足を口座に反映
      let invest = 0;
      for (const x of buckets) if (x.amount > 0) { const i = x.amount * x.rate / 100; x.amount += i; invest += i; }
      let contrib = 0;
      for (const x of buckets) if (age < x.until && x.monthly > 0) { x.amount += x.monthly * 12; contrib += x.monthly * 12; }
      const cashIn = salary + spouseSalary + pension + severance;
      const outgoTotal = living + housing + child + debt + eventCost;
      const incomeTotal = cashIn; // 現金で入る収入。運用益は資産に積み上がるだけなので、収入には含めない
      const flow = cashIn - outgoTotal - contrib;
      if (flow >= 0) sink.amount += flow;
      else {
        let need = -flow;
        for (const x of withdrawOrder) { const take = Math.min(Math.max(x.amount, 0), need); x.amount -= take; need -= take; }
        if (need > 0) sink.amount -= need;
      }
      const balance = sumOf(x => x.amount);
      const assetChange = balance - prevBalance; prevBalance = balance; // 資産の増減 = 年間収支(現金) + 運用益
      if (balance < 0 && depletedAge === null) depletedAge = age;
      const cashBal = buckets.filter(x => x.cash).reduce((t, x) => t + x.amount, 0);

      const names = events.map(e => e.name);
      for (const c of changes) if ((c.who === "me" ? age : spouseAge) === c.from) names.push(c.name || "収入の変化");
      names.push(...moveNames);
      rows.push({
        age, spouseAge, salary, spouseSalary, pension, severance, invest,
        incomeTotal, living, housing, child, debt, eventCost, outgoTotal, contrib,
        net: incomeTotal - outgoTotal, assetChange, balance, cashBal, investBal: balance - cashBal, eventNames: names.join("、"),
      });
    }
    const atRetire = rows.find(r => r.age === p.retireAge);
    return {
      rows, depletedAge, assetTotal, returnRate, monthlyContrib, myPension, spousePension, myPensionNet, spousePensionNet,
      debtTotal: debtStates.reduce((s, st) => s + st.balance, 0), debtStates,
      retireBalance: atRetire ? atRetire.balance : null,
      finalBalance: rows[rows.length - 1].balance,
    };
  }

  const api = { simulate, estimatePension, loanBalance, loanStatus, pensionNet, pensionNetRate, EDU_COURSES, annualPayment, eduCost };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LifePlan = api;
})(typeof window !== "undefined" ? window : globalThis);
