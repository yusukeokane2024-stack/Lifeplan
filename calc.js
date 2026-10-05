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

  function simulate(p) {
    const sp = p.spouse && p.spouse.enabled ? p.spouse : null;
    const h = p.housing;
    const buying = h.type === "buy";
    const payment = buying ? annualPayment(h.price - h.down, h.rate, h.years) : 0;
    const rows = [];
    // 現在の資産(内訳があれば合計、なければ savings)と、その加重平均利回り
    const assets = Array.isArray(p.assets) ? p.assets : null;
    const assetTotal = assets ? assets.reduce((s, a) => s + a.amount, 0) : p.savings;
    const returnRate = assets && assetTotal > 0
      ? assets.reduce((s, a) => s + a.amount * a.rate, 0) / assetTotal
      : p.returnRate;
    const debts = Array.isArray(p.debts) ? p.debts : [];
    let balance = assetTotal;
    let depletedAge = null;

    for (let age = p.age; age <= p.endAge; age++) {
      const n = age - p.age;
      const working = age < p.retireAge;
      const raiseF = Math.pow(1 + p.raise / 100, n);
      const infl = Math.pow(1 + p.inflation / 100, n);

      const salary = working ? p.income * raiseF : 0;
      let pension = age >= p.pensionAge ? p.pension : 0;
      let severance = age === p.retireAge ? p.severance : 0;
      let spouseSalary = 0, spouseAge = null;
      if (sp) {
        spouseAge = sp.age + n;
        if (spouseAge < sp.retireAge) spouseSalary = sp.income * Math.pow(1 + sp.raise / 100, n);
        if (spouseAge >= sp.pensionAge) pension += sp.pension;
        if (spouseAge === sp.retireAge) severance += sp.severance;
      }

      const living = (working ? p.living : p.living * (p.retireLivingRatio / 100)) * infl;

      let housing = 0;
      if (!buying || age < h.buyAge) {
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
      const invest = balance > 0 ? balance * (returnRate / 100) : 0;
      const incomeTotal = salary + spouseSalary + pension + severance + invest;
      const outgoTotal = living + housing + child + debt + eventCost;
      balance = balance + incomeTotal - outgoTotal;
      if (balance < 0 && depletedAge === null) depletedAge = age;

      const names = events.map(e => e.name);
      if (housingOnce) names.push("住宅購入");
      rows.push({
        age, spouseAge, salary, spouseSalary, pension, severance, invest,
        incomeTotal, living, housing, child, debt, eventCost, outgoTotal,
        net: incomeTotal - outgoTotal, balance, eventNames: names.join("、"),
      });
    }
    const atRetire = rows.find(r => r.age === p.retireAge);
    return {
      rows, depletedAge, assetTotal, returnRate,
      debtTotal: debts.reduce((s, d) => s + d.balance, 0),
      retireBalance: atRetire ? atRetire.balance : null,
      finalBalance: rows[rows.length - 1].balance,
    };
  }

  const api = { simulate, EDU_COURSES, annualPayment, eduCost };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LifePlan = api;
})(typeof window !== "undefined" ? window : globalThis);
