// backtest.js - 对冲回测引擎，逐字移植 v5（数据函数移至 data/hist.js）
// 方案：预计算 Greeks 查表（自适应价格网格 + 24期 + CRN跨期连续）→ 回测双线性插值
// 逐日Delta对冲模拟：每天查表得Delta → 调仓至Delta中性 → 累积盈亏
// 日内多次对冲：GBM模拟子时段价格，子时段真正调仓
// 盈亏归因：Gamma PnL / Theta PnL / 交易成本 / 未归因项（离散调仓偏差+Delta漂移；Vega 归因已移除，无真实 IV 时间序列）
// 账本（book）口径：负债腿逐日盯市入账（查表 PV 双线性），归因恒等式落在账本上，见 docs/book-accounting.md

import { lookupGreeksTable } from './table.js';

// 区间已实现波动率（全区间对数收益率年化，定性参考用）
export function intervalRealizedVol(prices) {
    const n = prices.length;
    if (n < 2) return 0;
    let sumSq = 0, cnt = 0;
    for (let i = 1; i < n; i++) {
        if (prices[i - 1] > 0) {
            const r = Math.log(prices[i] / prices[i - 1]);
            sumSq += r * r;
            cnt++;
        }
    }
    if (cnt === 0) return 0;
    return Math.sqrt(sumSq / cnt * 252);
}

// 滚动已实现波动率：计算每个窗口期（window日）的年化已实现波动率
// 返回 [{idx, date, rv}, ...]
export function rollingRealizedVol(prices, dates, windowDays) {
    const n = prices.length;
    if (n < windowDays + 1) return [];
    const result = [];
    for (let i = windowDays; i < n; i++) {
        let sumSq = 0;
        for (let j = i - windowDays + 1; j <= i; j++) {
            if (prices[j - 1] > 0) {
                const r = Math.log(prices[j] / prices[j - 1]);
                sumSq += r * r;
            }
        }
        const rv = Math.sqrt(sumSq / windowDays * 252);
        result.push({ idx: i, date: dates[i], rv });
    }
    return result;
}

// Box-Muller 正态随机数（日内子时段模拟用）
function boxMuller() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ====== 核心回测引擎 ======
// P: 雪球参数
// histSlice: [[dateStr, price], ...] 升序
// greeksTable: buildGreeksTable 输出
// freq: 'intraday2' | 'intraday4' | 'daily' | 'weekly' | 'monthly'
// costBps: 单边交易成本(bps)
// onProgress: (current, total) => void
export async function backtestHedge(P, histSlice, greeksTable, freq, costBps, onProgress) {
    const n = histSlice.length;
    if (n < 20) throw new Error('历史数据不足 20 条，请扩大区间');

    const prices = histSlice.map(d => d[1]);
    const dates = histSlice.map(d => d[0]);
    // 回测s0 = 回测区间第一天价格（假设当天发行雪球）
    const btS0 = prices[0];
    const N = P.notional * 10000;
    const costRate = costBps / 10000;

    // 频率配置
    const subPoints = { intraday2: 2, intraday4: 4, daily: 1, weekly: 1, monthly: 1 }[freq] || 1;
    const rebalanceDays = { weekly: 5, monthly: 21 }[freq] || 1;
    const intradayRebalance = subPoints > 1;

    let position = 0;
    let cumPnL = 0;
    let totalCost = 0;
    let gammaPnL = 0;
    let thetaPnL = 0;
    let prevGamma = 0, prevTheta = 0;
    let liabPnL = 0;
    let bookGammaPnL = 0;
    let bookThetaPnL = 0;
    let bookPnL = 0;

    // 障碍价基于btS0计算
    const kiPrice = P.kiPct * btS0;
    const koPrice = (P.koMode === 'descending' ? P.koStartPct : P.koPct) * btS0;

    const path = [];
    const totalDays = n - 1;

    for (let i = 0; i < totalDays; i++) {
        const S_cur = prices[i];
        const S_next = prices[i + 1];
        const dS = S_next - S_cur;
        const ratio = S_cur / btS0;          // 回测s0计算偏离度

        const remainingDays = totalDays - i;
        const remainingMonths = Math.max(1, remainingDays / 252 * 12);

        const g = lookupGreeksTable(greeksTable, ratio, remainingMonths);
        const curDelta = g.delta;
        const curGamma = g.gamma;
        const curTheta = g.theta;
        // 负债腿移动终点盯市值 V(S_{i+1}, T_{i+1})，与下一迭代 g 同点
        const gNext = lookupGreeksTable(greeksTable, S_next / btS0, Math.max(1, (totalDays - i - 1) / 252 * 12));

        const shouldRebalance = (i % rebalanceDays === 0);

        let subPnL = 0;
        let subCost = 0;
        let dayCost = 0;
        if (intradayRebalance) {
            const dailyRet = S_next / S_cur - 1;
            const volPerSub = (P.vol / Math.sqrt(252 * subPoints));
            let subPrice = S_cur;
            let subPosition = position;
            for (let s = 0; s < subPoints; s++) {
                const z = boxMuller();
                const subReturn = dailyRet / subPoints + volPerSub * z;
                const prevSubPrice = subPrice;
                subPrice = subPrice * (1 + subReturn);
                subPnL += subPosition * (subPrice - prevSubPrice);
                const subRatio = subPrice / btS0;
                const subG = lookupGreeksTable(greeksTable, subRatio, remainingMonths);
                const subTarget = subG.delta;
                const subTrade = (subTarget - subPosition) * N;
                subCost += Math.abs(subTrade) * subPrice * costRate;
                subPosition = subTarget;
            }
            position = subPosition;  // 日内模式最终持仓
            totalCost += subCost;
            dayCost = subCost;
        } else {
            subPnL = position * dS;
        }

        // ====== 盈亏归因（用前一日收市的Greeks计算） ======
        if (i > 0) {
            // Gamma PnL = 0.5 * Gamma * ΔS² * N（绝对点位）
            gammaPnL += 0.5 * prevGamma * dS * dS * N;
            // Theta PnL = Theta/12 × N（每交易日，与 Greeks 卡片 g/12×N 口径一致）
            thetaPnL += prevTheta * N / 12;
        }

        // ====== 调仓（日间模式或非日内模式） ======
        if (!intradayRebalance && shouldRebalance) {
            const targetDelta = curDelta;
            const tradeShares = (targetDelta - position) * N;
            const cost = Math.abs(tradeShares) * S_cur * costRate;
            totalCost += cost;
            dayCost = cost;
            position = targetDelta;
        }

        // ====== 累计盈亏 ======
        // 持仓盈亏 = 份额(delta×N) × 点位变动，cumPnL += subPnL × N
        if (intradayRebalance) {
            cumPnL += subPnL * N;
        } else {
            cumPnL += subPnL * N;
        }

        // ====== 账本口径：负债腿盯市 + 账本归因（docs/book-accounting.md §5） ======
        const liabMove = (g.p - gNext.p) * N;
        liabPnL += liabMove;
        bookGammaPnL += -0.5 * curGamma * dS * dS * N;
        bookThetaPnL += -curTheta * N / 12;
        bookPnL += subPnL * N + liabMove - dayCost;

        // 记录路径
        path.push({
            t: i,
            date: dates[i],
            S: S_cur,
            ratio: ratio,
            delta: curDelta,
            gamma: curGamma,
            theta: curTheta,
            cumPnL: cumPnL,
            bookCumPnL: bookPnL,
            liabCumPnL: liabPnL,
            position: position,
        });

        prevGamma = curGamma;
        prevTheta = curTheta;

        // 每 200 天 yield 一次（后台Tab节流后 1s/yield，200天≈1s）
        if (i % 200 === 0) {
            if (onProgress) onProgress(i + 1, totalDays);
            await new Promise(r => setTimeout(r, 0));
        }
    }

    const realizedVol = intervalRealizedVol(prices);
    const residual = cumPnL - gammaPnL - thetaPnL + totalCost;
    const bookResidual = bookPnL - bookGammaPnL - bookThetaPnL + totalCost;

    // 滚动已实现波动率（20日和60日窗口）
    const rv20 = rollingRealizedVol(prices, dates, 20);
    const rv60 = rollingRealizedVol(prices, dates, 60);

    if (onProgress) onProgress(totalDays, totalDays);

    return {
        s0: btS0,
        sEnd: prices[n - 2],
        s0Date: dates[0],
        sEndDate: dates[n - 2],
        totalReturn: prices[n - 2] / btS0 - 1,
        realizedVol: realizedVol,
        cumPnL: cumPnL,
        gammaPnL: gammaPnL,
        thetaPnL: thetaPnL,
        totalCost: totalCost,
        residual: residual,
        bookPnL: bookPnL,
        hedgePnL: cumPnL,
        liabPnL: liabPnL,
        bookGammaPnL: bookGammaPnL,
        bookThetaPnL: bookThetaPnL,
        bookResidual: bookResidual,
        rv20: rv20,
        rv60: rv60,
        path: path,
        n: path.length,
    };
}
