// payoff.js - Payoff 判定（四分类 + ACT/365 计息），逐字移植 v5
// 1) 敲出 → 提前结束，按持有月份折算票息
// 2) 未敲出未敲入 → 到期拿满票息（红利票息）
// 3) 敲入且到期亏损 → 承担跌幅
// 4) 敲入但到期赎回 → 拿回本金（不赚不赔）
// 所有收益用无风险利率贴现到 T=0，计息基准固定 ACT/365（ty = 月数 / 12）

export function evaluatePaths(prices, P) {
    const { nPaths, nSteps, koPct, kiPct, couponRate, couponDiv, lockoutMonths, tenorMonths, rf, strikeRef, koMode, koStartPct, koStepPct } = P;
    // 红利票息(未敲入未敲出到期)：若未指定则等于敲出票息
    const cDiv = couponDiv !== undefined ? couponDiv : couponRate;
    // 分段票息：若启用则按观察月序号切换早期/晚期票息
    const tiered = P.couponTiered;
    const cEarly = tiered ? (P.couponEarly !== undefined ? P.couponEarly : couponRate) : couponRate;
    const cLate = tiered ? (P.couponLate !== undefined ? P.couponLate : couponRate) : couponRate;
    const cSwitch = tiered ? (P.couponSwitchMonth || 1) : 1;
    const ref = strikeRef || P.s0;
    const kiBar = ref * kiPct;
    const spm = nSteps / tenorMonths;
    const lastM = Math.floor(tenorMonths + 1e-9);

    // 敲出价模式：固定(单一 koBar) 或 递减(每个观察日不同 koBar)
    const koSteps = [];
    for (let mm = lockoutMonths + 1; mm <= lastM; mm++) {
        const s = Math.round(mm * spm);
        if (s >= 1 && s <= nSteps) {
            const bar = koMode === 'descending' ? ref * (koStartPct - (mm - lockoutMonths - 1) * koStepPct) : ref * koPct;
            koSteps.push([s, bar, mm - lockoutMonths]);
        }
    }

    let tp = 0, tpSq = 0, kc = 0, kic = 0, klc = 0;
    const pvs = new Array(nPaths);
    const koTimes = new Array(nPaths);
    const kiTimes = new Array(nPaths);

    for (let i = 0; i < nPaths; i++) {
        const off = i * (nSteps + 1);
        let pmin = Infinity, firstKI = Infinity;
        for (let j = 1; j <= nSteps; j++) {
            const v = prices[off + j];
            if (v < pmin) pmin = v;
            if (firstKI === Infinity && v <= kiBar) firstKI = j;
        }
        const everKI = firstKI !== Infinity;
        let ko = false, pathPV = 0, koStepIdx = Infinity;

        // 敲出判定
        for (const [st, bar, obsIdx] of koSteps) {
            if (prices[off + st] >= bar) {
                const mo = st / spm;
                const ty = mo / 12;  // ACT/365
                const cpRate = tiered ? (obsIdx >= cSwitch ? cLate : cEarly) : couponRate;
                const cp = cpRate * ty;
                const pv = (1 + cp) * Math.exp(-rf * ty);
                tp += pv; tpSq += pv * pv; pathPV = pv; kc++; ko = true; koStepIdx = st;
                break;
            }
        }
        if (ko) {
            pvs[i] = pathPV;
            koTimes[i] = koStepIdx;
            kiTimes[i] = (everKI && firstKI < koStepIdx) ? firstKI : Infinity;
            continue;
        }

        // 到期判定
        const ty = tenorMonths / 12;  // ACT/365
        const disc = Math.exp(-rf * ty);
        if (!everKI) {
            // 未敲入：本金 + 红利票息
            const pv = (1 + cDiv * ty) * disc;
            tp += pv; tpSq += pv * pv; pvs[i] = pv;
            koTimes[i] = Infinity; kiTimes[i] = Infinity;
        } else {
            kic++;
            const tr = prices[off + nSteps] / ref - 1;
            if (tr < 0) {
                klc++;
                const pv = (1 + Math.max(tr, -1)) * disc;
                tp += pv; tpSq += pv * pv; pvs[i] = pv;
            } else {
                tp += disc; tpSq += disc * disc; pvs[i] = disc;
            }
            koTimes[i] = Infinity; kiTimes[i] = firstKI;
        }
    }
    const mean = tp / nPaths;
    const variance = (tpSq / nPaths) - (mean * mean);
    const std = Math.sqrt(Math.max(0, variance));
    return {
        price: mean,
        priceSE: std / Math.sqrt(nPaths),
        koProb: kc / nPaths,
        kiProb: kic / nPaths,
        kiLossProb: klc / nPaths,
        surviveProb: 1 - kc / nPaths - kic / nPaths,
        pvs, koTimes, kiTimes,
        pathStd: std,
        pathCount: nPaths,
    };
}

// 计算蒙特卡洛标准误
export function mcStandardError(pvs) {
    const n = pvs.length;
    if (n < 2) return 0;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += pvs[i];
    mean /= n;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
        const d = pvs[i] - mean;
        sumSq += d * d;
    }
    const variance = sumSq / (n - 1);
    return Math.sqrt(variance / n);
}

// 单路径贴现收益：复制 evaluatePaths 的判定逻辑，但只算一条路径
// 返回该路径的现值(本金=1)，用于 VaR 分布统计
export function payoffSinglePath(prices, nSteps, P) {
    const ref = P.strikeRef || P.s0;
    const kiBar = ref * P.kiPct;
    const spm = nSteps / P.tenorMonths;
    const lastM = Math.floor(P.tenorMonths + 1e-9);
    const cDiv = P.couponDiv !== undefined ? P.couponDiv : P.couponRate;
    const tiered = P.couponTiered;
    const cEarly = tiered ? (P.couponEarly !== undefined ? P.couponEarly : P.couponRate) : P.couponRate;
    const cLate = tiered ? (P.couponLate !== undefined ? P.couponLate : P.couponRate) : P.couponRate;
    const cSwitch = tiered ? (P.couponSwitchMonth || 1) : 1;

    const koSteps = [];
    for (let mm = P.lockoutMonths + 1; mm <= lastM; mm++) {
        const s = Math.round(mm * spm);
        if (s >= 1 && s <= nSteps) {
            const bar = P.koMode === 'descending' ? ref * (P.koStartPct - (mm - P.lockoutMonths - 1) * P.koStepPct) : ref * P.koPct;
            koSteps.push([s, bar, mm - P.lockoutMonths]);
        }
    }

    let pmin = Infinity;
    for (let j = 1; j <= nSteps; j++) { const v = prices[j]; if (v < pmin) pmin = v; }
    const everKI = pmin <= kiBar;

    for (const [st, bar, obsIdx] of koSteps) {
        if (prices[st] >= bar) {
            const mo = st / spm, ty = mo / 12;
            const cpRate = tiered ? (obsIdx >= cSwitch ? cLate : cEarly) : P.couponRate;
            const cp = cpRate * ty;
            return (1 + cp) * Math.exp(-P.rf * ty);
        }
    }
    const ty = P.tenorMonths / 12, disc = Math.exp(-P.rf * ty);
    if (!everKI) return (1 + cDiv * ty) * disc;
    const tr = prices[nSteps] / ref - 1;
    if (tr < 0) return (1 + Math.max(tr, -1)) * disc;
    return disc;
}
