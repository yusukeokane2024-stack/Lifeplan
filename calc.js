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
  function pensionOf(person) {
    return person.pensionMode === "manual" ? person.pension : estimatePension(person);
  }

  function simulate(p) {
    const sp = p.spouse && p.spouse.enabled ? p.spouse : null;
    const h = p.housing;
    const buying = h.type === "buy";
    const owning = h.type === "own";
    const ownPayment = owning ? annualPayment(h.ownLoan, h.ownRate, h.ownYears) : 0;
    const payment = buying ? annualPayment(h.price - h.down, h.rate, h.years) : 0;
    const myPension = pensionOf(p);
    const spousePension = sp ? pensionOf(sp) : 0;
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
    let depletedAge = null;

    for (let age = p.age; age <= p.endAge; age++) {
      const n = age - p.age;
      const working = age < p.retireAge;
      const raiseF = Math.pow(1 + p.raise / 100, n);
      const infl = Math.pow(1 + p.inflation / 100, n);

      const salary = working ? p.income * raiseF : 0;
      let pension = age >= p.pensionAge ? myPension : 0;
      let severance = age === p.retireAge ? p.severance : 0;
      let spouseSalary = 0, spouseAge = null;
      if (sp) {
        spouseAge = sp.age + n;
        if (spouseAge < sp.retireAge) spouseSalary = sp.income * Math.pow(1 + sp.raise / 100, n);
        if (spouseAge >= sp.pensionAge) pension += spousePension;
        if (spouseAge === sp.retireAge) severance += sp.severance;
      }

      const living = (working ? p.living : p.living * (p.retireLivingRatio / 100)) * infl;

      let housing = 0;
      if (owning) {
        // 持ち家(購入済み): 残りのローン返済 + 管理費・修繕積立金 + 固定資産税 + 修繕費
        if (n < h.ownYears) housing += ownPayment;
        housing += (h.ownMgmt * 12 + h.ownTax + h.ownRepair) * infl;
      } else if (!buying || age < h.buyAge) {
        housing = h.rent;
      } else {
        if (age < h.buyAge + h.years) housing += payment;
        housing += h.upkeep * infl;
      }
      const housingOnce = buying && age === h.buyAge ? h.down + h.closing : 0;

      let child = 0;
      for (const c of p.children) {
        const ca = c.age + n;
        if (ca >= 0 && ca <= 21) child += p.childCost * infl;
        child += eduCost(c.course, ca) * infl;
      }

      let debt = 0;
      for (const d of debts) if (n < d.years) debt += annualPayment(d.balance, d.rate, d.years);

      const events = p.events.filter(e => e.age === age);
      const eventCost = events.reduce((s, e) => s + e.amount, 0) + housingOnce;
      // 運用益(年初の残高に対して)→ 積立(年末に積み増し)→ 収支の余り/不足を口座に反映
      let invest = 0;
      for (const x of buckets) if (x.amount > 0) { const i = x.amount * x.rate / 100; x.amount += i; invest += i; }
      let contrib = 0;
      for (const x of buckets) if (age < x.until && x.monthly > 0) { x.amount += x.monthly * 12; contrib += x.monthly * 12; }
      const cashIn = salary + spouseSalary + pension + severance;
      const outgoTotal = living + housing + child + debt + eventCost;
      const incomeTotal = cashIn + invest;
      const flow = cashIn - outgoTotal - contrib;
      if (flow >= 0) sink.amount += flow;
      else {
        let need = -flow;
        for (const x of withdrawOrder) { const take = Math.min(Math.max(x.amount, 0), need); x.amount -= take; need -= take; }
        if (need > 0) sink.amount -= need;
      }
      const balance = sumOf(x => x.amount);
      if (balance < 0 && depletedAge === null) depletedAge = age;
      const cashBal = buckets.filter(x => x.cash).reduce((t, x) => t + x.amount, 0);

      const names = events.map(e => e.name);
      if (housingOnce) names.push("住宅購入");
      rows.push({
        age, spouseAge, salary, spouseSalary, pension, severance, invest,
        incomeTotal, living, housing, child, debt, eventCost, outgoTotal, contrib,
        net: incomeTotal - outgoTotal, balance, cashBal, investBal: balance - cashBal, eventNames: names.join("、"),
      });
    }
    const atRetire = rows.find(r => r.age === p.retireAge);
    return {
      rows, depletedAge, assetTotal, returnRate, monthlyContrib, myPension, spousePension,
      debtTotal: debts.reduce((s, d) => s + d.balance, 0),
      retireBalance: atRetire ? atRetire.balance : null,
      finalBalance: rows[rows.length - 1].balance,
    };
  }

  const api = { simulate, estimatePension, EDU_COURSES, annualPayment, eduCost };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LifePlan = api;
})(typeof window !== "undefined" ? window : globalThis);
