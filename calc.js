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

  // 養育費(1人あたり年額)。食費を生活費に入れている場合は、その分を除く
  function childCostOf(p) { return Math.max(0, p.childCost - (p.childFoodInLiving ? (p.childFood ?? 30) : 0)); }

  // 元利均等返済の年間返済額
  function annualPayment(loan, ratePct, years) {
    if (loan <= 0 || years <= 0) return 0;
    const r = ratePct / 100;
    return r === 0 ? loan / years : (loan * r) / (1 - Math.pow(1 + r, -years));
  }

  // 公的年金の概算(年額・万円)。令和7年度の満額・乗率をもとにした目安で、物価・賃金スライドや加給年金等は含まない。
  const BASIC_FULL = 83.1;      // 老齢基礎年金(満額・40年加入)
  const KOUSEI_RATE = 0.005481; // 老齢厚生年金の乗率(平均標準報酬額 × 乗率 × 加入月数)
  const KID_ADD12 = 23.93;      // 遺族基礎・障害基礎年金の子の加算(第1・2子、1人あたり年額)
  const KID_ADD3 = 7.97;        // 同(第3子以降)
  // 基礎年金・厚生年金(報酬比例)と、繰上げ・繰下げの係数
  function pensionParts(o) {
    let kosei = 0;
    if (o.job === "employee") {
      // 会社員を途中でやめた場合(kouseiEnd)は、その年齢までが厚生年金の加入期間
      const end = o.kouseiEnd > 0 ? Math.min(o.kouseiEnd, o.retireAge) : o.retireAge;
      const months = Math.max(0, (Math.min(end, 70) - o.startAge) * 12);
      const avgMonthly = Math.min(o.avgGross / 12, 100); // 標準報酬(賞与込み)の上限をざっくり反映
      kosei = avgMonthly * KOUSEI_RATE * months;
    }
    // 繰上げ: 1か月あたり-0.4%(最大60か月) / 繰下げ: 1か月あたり+0.7%(最大120か月)
    const diff = Math.max(60, Math.min(75, o.pensionAge)) - 65;
    return { basic: BASIC_FULL, kosei, factor: diff < 0 ? 1 + 0.004 * diff * 12 : 1 + 0.007 * diff * 12 };
  }
  function estimatePension(o) {
    // o: { job: "employee" | "self" | "none", startAge, kouseiEnd(0=退職まで), avgGross, retireAge, pensionAge }
    const t = pensionParts(o); // 20〜60歳の40年間、保険料を納付した(または第3号)前提
    return Math.round((t.basic + t.kosei) * t.factor * 10) / 10;
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
    const prot = { funeral: 200, livingRatio: 75, disabilityLossRate: 100, disabilityMedical: 10, disabilityYears: 0, disabilityPension: true, dankin: true, loanHolder: "me", ...(p.protection || {}) };
    // 住まいの状態: 賃貸(kind:"rent") か 持ち家(kind:"own": ローン+維持費)。住み替えで年ごとに切り替わる
    const nowYear = p.nowYear || new Date().getFullYear();
    // ローンは配列で持つ(ペアローンは2本)。holder は債務者(団信は、亡くなった債務者のローンだけを完済する)
    const holder1 = prot.loanHolder === "spouse" ? "spouse" : "me", holder2 = holder1 === "me" ? "spouse" : "me";
    const mkLoan = (st, rate, holder) => ({ principal: st.principal, rate, years: st.term, startAge: p.age - st.k, holder });
    let cur = { kind: "rent", rent: h.rent, parking: h.parking || 0 };
    if (h.type === "own") {
      const mode = h.ownMode === "auto" ? "auto" : "balance";
      const st = loanStatus({ mode, borrow: h.ownBorrow, borrowYear: h.ownBorrowYear, term: h.ownTerm, rate: h.ownRate, balance: h.ownLoan, years: h.ownYears }, nowYear);
      // 返済開始を「いまから k 年前」に置くことで、返済済みの年数がそのまま売却時の残債計算に使える
      cur = { kind: "own", loans: [mkLoan(st, h.ownRate, holder1)], upkeep: h.ownMgmt * 12 + h.ownTax + h.ownRepair, parking: h.parking || 0 };
      if (h.ownPair && sp) {
        const st2 = loanStatus({ mode, borrow: h.ownBorrow2, borrowYear: h.ownBorrowYear2, term: h.ownTerm2, rate: h.ownRate2, balance: h.ownLoan2, years: h.ownYears2 }, nowYear);
        cur.loans.push(mkLoan(st2, h.ownRate2, holder2));
      }
    }
    // 住み替え: 「将来購入する」(従来の設定)も、最初の住み替えとして扱う
    const moves = [];
    if (h.type === "buy") moves.push({ age: h.buyAge, name: "住宅購入", type: "buy", price: h.price, down: h.down, closing: h.closing, rate: h.rate, years: h.years, upkeep: h.upkeep, salePrice: 0, sellCost: 0, parking: h.buyParking || 0, loanKind: h.pair ? "pair" : "single", pairRatio: h.pairRatio });
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
    // 車の購入・買い替え。価格は「いまの価格」で入力し、購入時点の物価上昇率で将来の価格にする。
    // 購入は「最初の年齢」から「周期」ごと(周期0は1回だけ)で、「乗るのをやめる年齢」より前まで。
    const cars = (Array.isArray(p.cars) ? p.cars : []).map(c => ({ cycle: 0, until: 75, useLoan: "cash", loanYears: 5, rate: 0, ...c }));
    const carBuyAges = c => { const out = []; const until = c.until > 0 ? c.until : p.endAge + 1; for (let b = c.age; b < until && b <= p.endAge; b = c.cycle > 0 ? b + c.cycle : Infinity) out.push(b); return out; };
    const carDeal = (c, b) => { // b歳で買うときの、一括で払う額(頭金など)とローンの借入額
      const f = Math.pow(1 + p.inflation / 100, b - p.age), need = Math.max(0, (c.price - (c.trade || 0)) * f);
      const principal = c.useLoan === "loan" ? Math.max(0, need - (c.down || 0) * f) : 0;
      return { cash: need - principal, principal };
    };
    // 万が一(本人・配偶者の死亡 / 長期の就業不能)。sc.age は、その人本人の、発生時の年齢
    const policies = Array.isArray(p.policies) ? p.policies : [];
    let sc = p.scenario || null;
    if (sc && (sc.who === "spouse" || sc.type === "death") && !sp) sc = null; // 配偶者がいないと、配偶者の万が一も、死亡後の遺族も成り立たない
    const evtMyAge = sc ? (sc.who === "me" ? sc.age : sc.age - sp.age + p.age) : null;
    const person = who => (who === "me" ? p : sp);
    const partsOf = o => { const t = pensionParts(o); return { kosei: t.kosei * t.factor }; };
    let scenarioInfo = null;

    for (let age = p.age; age <= p.endAge; age++) {
      const n = age - p.age;
      const working = age < p.retireAge;
      const infl = Math.pow(1 + p.inflation / 100, n);

      let salary = working ? salaryOf("me", p.income, p.raise, age, n, p.retireAge) : 0;
      let myPen = age >= p.pensionAge ? myPensionNet : 0;
      let mySev = age === p.retireAge ? p.severance : 0;
      let spouseSalary = 0, spouseAge = null, spPen = 0, spSev = 0;
      if (sp) {
        spouseAge = sp.age + n;
        if (spouseAge < sp.retireAge) spouseSalary = salaryOf("spouse", sp.income, sp.raise, spouseAge, n, sp.retireAge);
        if (spouseAge >= sp.pensionAge) spPen = spousePensionNet;
        if (spouseAge === sp.retireAge) spSev = sp.severance;
      }
      const ageOf = who => (who === "me" ? age : spouseAge);

      // ---- 万が一の影響(収入面) ----
      let benefit = 0, insIncome = 0, riskCash = 0, riskCost = 0, livingMult = 1; const riskNames = [];
      const active = !!sc && age >= evtMyAge, evtYear = !!sc && age === evtMyAge;
      let dankinNow = false;
      if (active) {
        const D = person(sc.who), Sv = person(sc.who === "me" ? "spouse" : "me"), dAge = ageOf(sc.who), sAge = ageOf(sc.who === "me" ? "spouse" : "me");
        const kids = p.children.filter(c => { const ca = c.age + n; return ca >= 0 && ca <= 17; }).length; // 18歳の年度末まで(目安)
        const kidAdd = k => Math.min(k, 2) * KID_ADD12 + Math.max(0, k - 2) * KID_ADD3;
        const mine = policies.filter(x => x.who === sc.who);
        // 厚生年金の報酬比例(平均年収と加入月数。在職中の発生は、300月に満たなくても300月とみなす)
        const koseiMonths = Math.max(0, (Math.min(sc.age, D.kouseiEnd > 0 ? D.kouseiEnd : D.retireAge, 70) - D.startAge) * 12);
        const workingAtEvent = sc.age < D.retireAge;
        const koseiBase = D.job === "employee" ? Math.min(D.avgGross / 12, 100) * KOUSEI_RATE : 0;
        if (sc.type === "death") {
          if (sc.who === "me") { salary = 0; myPen = 0; mySev = 0; } else { spouseSalary = 0; spPen = 0; spSev = 0; }
          livingMult = prot.livingRatio / 100;
          const basicSurv = kids > 0 ? BASIC_FULL + kidAdd(kids) : 0;                 // 遺族基礎年金(18歳未満の子がいる間)
          const months = workingAtEvent ? Math.max(300, koseiMonths) : koseiMonths;
          let koseiSurv = months >= 300 ? koseiBase * months * 0.75 : 0;              // 遺族厚生年金(報酬比例の3/4)
          if (sAge >= Sv.pensionAge) koseiSurv = Math.max(0, koseiSurv - partsOf(Sv).kosei); // 自分の老齢厚生年金が出る年齢からは、その分を差し引く
          benefit += basicSurv + koseiSurv;
          for (const x of mine) if (x.incomeProtect > 0 && dAge <= (x.incomeUntil || 0)) insIncome += x.incomeProtect * 12; // 収入保障保険
          if (evtYear) {
            riskCash -= mine.reduce((t, x) => t + (x.death || 0), 0);                 // 死亡保険金(一時金)
            riskCost += prot.funeral;                                                 // 葬儀費用
            riskNames.push("万が一(" + (sc.who === "me" ? "本人" : "配偶者") + "死亡)");
            dankinNow = !!prot.dankin;                                                // 団信: 亡くなった債務者のローンの残りが消える
            scenarioInfo = { type: "death", who: sc.who, evtMyAge, lump: mine.reduce((t, x) => t + (x.death || 0), 0), funeral: prot.funeral,
              survivorBasic: basicSurv, survivorKosei: koseiSurv, incomeProtect: mine.reduce((t, x) => t + (x.incomeProtect > 0 && dAge <= (x.incomeUntil || 0) ? x.incomeProtect * 12 : 0), 0),
              loanCleared: 0, livingRatio: prot.livingRatio };
          }
        } else { // 就業不能
          const end = prot.disabilityYears > 0 ? sc.age + prot.disabilityYears : D.retireAge;
          if (dAge < end) {
            const k = 1 - prot.disabilityLossRate / 100;
            if (sc.who === "me") salary *= k; else spouseSalary *= k;
            for (const x of mine) insIncome += (x.disabilityBenefit || 0) * 12;       // 就業不能保険
            let dp = 0;
            if (prot.disabilityPension) {                                             // 障害年金(2級の目安)
              dp = BASIC_FULL + kidAdd(kids);
              if (D.job === "employee" && workingAtEvent) dp += koseiBase * Math.max(300, koseiMonths);
              benefit += dp;
            }
            riskCost += prot.disabilityMedical * 12 * infl;                           // 追加の医療費
            if (evtYear) riskNames.push("万が一(" + (sc.who === "me" ? "本人" : "配偶者") + "が就業不能)");
            if (evtYear) scenarioInfo = { type: "disability", who: sc.who, evtMyAge, lump: 0, disabilityPension: dp, benefit: mine.reduce((t, x) => t + (x.disabilityBenefit || 0) * 12, 0),
              medical: prot.disabilityMedical * 12, lossRate: prot.disabilityLossRate };
          }
        }
        if (evtYear && sc.extra) riskCash -= sc.extra; // 不足額を求めるための仮の追加資金
      }
      let pension = myPen + spPen;
      let severance = mySev + spSev;

      // 子どもが全員独立(22歳以上)したら、生活費が減る
      const kidsGone = p.children.length > 0 && p.children.every(c => c.age + n > 21);
      const kidsMult = kidsGone ? 1 - (p.childLeaveCut || 0) / 100 : 1;
      const living = (working ? p.living : p.living * (p.retireLivingRatio / 100)) * infl * livingMult * kidsMult;

      // 住み替え(この年齢の分を先に反映)
      let moveCash = 0; const moveNames = [];
      for (const m of moves) {
        if (m.age !== age) continue;
        if (cur.kind === "own") { // 旧居が持ち家: 売却価格 - ローン残債 - 売却費用 が手元に入る(不足なら支出)
          const bal = cur.loans.reduce((t, l) => t + loanBalance(l.principal, l.rate, l.years, age - l.startAge), 0);
          moveCash -= (m.salePrice || 0) - bal - (m.sellCost || 0);
        }
        if (m.type === "buy") {
          moveCash += (m.down || 0) + (m.closing || 0);
          const total = Math.max(0, m.price - m.down), pair = m.loanKind === "pair" && sp;
          const share = pair ? Math.max(0, Math.min(100, m.pairRatio == null ? 50 : m.pairRatio)) / 100 : 1;
          const loans = [{ principal: total * share, rate: m.rate, years: m.years, startAge: age, holder: holder1 }];
          if (pair) loans.push({ principal: total - total * share, rate: m.rate, years: m.years, startAge: age, holder: holder2 });
          cur = { kind: "own", loans, upkeep: m.upkeep, parking: m.parking || 0 };
        } else cur = { kind: "rent", rent: m.rent, parking: m.parking || 0 };
        moveNames.push(m.name || "住み替え");
      }
      if (dankinNow && cur.kind === "own") { // 団信: 債務者が亡くなると、その人のローンの残りが保険金で完済される(ペアローンは、亡くなった人の分だけ)
        const gone = cur.loans.filter(l => l.holder === sc.who);
        if (scenarioInfo) scenarioInfo.loanCleared = gone.reduce((t, l) => t + loanBalance(l.principal, l.rate, l.years, age - l.startAge), 0);
        cur = { ...cur, loans: cur.loans.filter(l => l.holder !== sc.who) };
      }
      // 住居費: 賃貸=家賃 / 持ち家=ローン返済(返済期間中)+維持費(物価に連動)
      let housing = 0;
      if (cur.kind === "rent") housing = cur.rent + (cur.parking || 0) * 12;
      else {
        for (const l of cur.loans) if (age - l.startAge < l.years) housing += annualPayment(l.principal, l.rate, l.years);
        housing += (cur.upkeep + (cur.parking || 0) * 12) * infl;
      }
      let child = 0;
      for (const c of p.children) {
        const ca = c.age + n;
        if (ca >= 0 && ca <= 21) child += childCostOf(p) * infl;
        child += eduCost(c.course, ca) * infl;
      }

      let debt = 0;
      for (const st of debtStates) if (n < st.remaining) debt += st.payment;
      // 車: 購入時の支出(一括・頭金)、維持費、ローンの返済
      let carCost = 0; const carNames = [];
      for (const c of cars) {
        const ages = carBuyAges(c), until = c.until > 0 ? c.until : p.endAge + 1;
        if (age >= c.age && age < until) carCost += (c.upkeep || 0) * infl;
        if (ages.includes(age) && age >= p.age) { carCost += carDeal(c, age).cash; carNames.push(c.name || "車の購入"); }
        if (c.useLoan === "loan") for (const b of ages) {
          if (b < p.age || b > age || age - b >= c.loanYears) continue; // 現在より前のローンは、入力された既存ローンの側で扱う
          debt += annualPayment(carDeal(c, b).principal, c.rate, c.loanYears);
        }
      }

      const events = p.events.filter(e => e.age === age);
      const eventCost = events.reduce((s, e) => s + e.amount, 0) + moveCash + riskCash + riskCost;
      // 運用益(年初の残高に対して)→ 積立(年末に積み増し)→ 収支の余り/不足を口座に反映
      let invest = 0;
      for (const x of buckets) if (x.amount > 0) { const i = x.amount * x.rate / 100; x.amount += i; invest += i; }
      let contrib = 0;
      for (const x of buckets) if (age < x.until && x.monthly > 0) { x.amount += x.monthly * 12; contrib += x.monthly * 12; }
      const cashIn = salary + spouseSalary + pension + severance + benefit + insIncome;
      const outgoTotal = living + housing + child + debt + eventCost + carCost;
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
      names.push(...moveNames, ...riskNames, ...carNames);
      rows.push({
        age, spouseAge, salary, spouseSalary, pension, severance, invest, benefit, insIncome,
        incomeTotal, living, housing, child, debt, eventCost, car: carCost, outgoTotal, contrib,
        net: incomeTotal - outgoTotal, assetChange, balance, cashBal, investBal: balance - cashBal, eventNames: names.join("、"),
      });
    }
    const atRetire = rows.find(r => r.age === p.retireAge);
    return {
      rows, depletedAge, scenarioInfo, assetTotal, returnRate, monthlyContrib, myPension, spousePension, myPensionNet, spousePensionNet,
      debtTotal: debtStates.reduce((s, st) => s + st.balance, 0), debtStates,
      retireBalance: atRetire ? atRetire.balance : null,
      finalBalance: rows[rows.length - 1].balance,
    };
  }

  // 万が一のまとめ。通常の場合との比較と、「保障があといくら足りないか(追加で必要な額)」を求める。
  // 不足額 = 発生時に追加で受け取れば、最後まで資産が尽きなくなる最小の金額(万円)。
  function riskSummary(p, scenario) {
    const base = simulate({ ...p, scenario: null });
    const scn = simulate({ ...p, scenario });
    if (!scn.scenarioInfo) return { valid: false, base, scn, shortfall: 0 };
    const ok = extra => simulate({ ...p, scenario: { ...scenario, extra }, }).depletedAge === null;
    let shortfall = 0;
    if (scn.depletedAge !== null) {
      let lo = 0, hi = 300000;
      if (!ok(hi)) shortfall = hi;
      else { for (let i = 0; i < 40 && hi - lo > 0.5; i++) { const mid = (lo + hi) / 2; ok(mid) ? (hi = mid) : (lo = mid); } shortfall = Math.ceil(hi); }
    }
    return { valid: true, base, scn, shortfall, info: scn.scenarioInfo };
  }

  const api = { simulate, riskSummary, pensionParts, estimatePension, loanBalance, loanStatus, pensionNet, pensionNetRate, EDU_COURSES, annualPayment, eduCost, childCostOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LifePlan = api;
})(typeof window !== "undefined" ? window : globalThis);
