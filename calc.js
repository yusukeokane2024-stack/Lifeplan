// ライフプランのシミュレーション(純粋関数)。金額の単位は「万円」。
(function (root) {
  function simulate(p) {
    const rows = [];
    let balance = p.savings;
    let depletedAge = null;
    for (let age = p.age; age <= p.endAge; age++) {
      const n = age - p.age;
      const working = age < p.retireAge;
      const salary = working ? p.income * Math.pow(1 + p.raise / 100, n) : 0;
      const pension = age >= p.pensionAge ? p.pension : 0;
      const severance = age === p.retireAge ? p.severance : 0;
      const infl = Math.pow(1 + p.inflation / 100, n);
      const base = working ? p.living : p.living * (p.retireLivingRatio / 100);
      const living = base * infl;
      const events = p.events.filter(e => e.age === age);
      const eventCost = events.reduce((s, e) => s + e.amount, 0);
      const invest = balance > 0 ? balance * (p.returnRate / 100) : 0;
      const income = salary + pension + severance;
      const outgo = living + eventCost;
      balance = balance + invest + income - outgo;
      if (balance < 0 && depletedAge === null) depletedAge = age;
      rows.push({
        age, income, invest, living, eventCost, balance,
        eventNames: events.map(e => e.name).join("、"),
      });
    }
    const atRetire = rows.find(r => r.age === p.retireAge);
    return {
      rows,
      depletedAge,
      retireBalance: atRetire ? atRetire.balance : null,
      finalBalance: rows[rows.length - 1].balance,
    };
  }
  const api = { simulate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LifePlan = api;
})(typeof window !== "undefined" ? window : globalThis);
