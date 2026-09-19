// stress.js - 压力测试引擎，逐字移植 v5
// 构建波动率/spot/危机/矩阵情景，用 CRN（共享 Sobol 随机数）计算各情景下 PV 与 Greeks 变化
// 危机切片经 sliceFn 注入（默认 data/hist.js，测试可注入内存数组），2015 起数据窗口三档全部实算。

import { priceWithNormals } from './pricing.js';
import { computeGreeks } from './greeks.js';

// ====== 情景构建 ======

// 波动率冲击情景：7 档（含基准 0）
// shocks = [-0.20, -0.10, -0.05, 0, 0.05, 0.10, 0.20]（单位：pp，即 0.20 = +20pp）
// 实际 vol = max(P.vol + shock, 0.01)
export function buildVolScenarios(P) {
    const shocks = [-0.20, -0.10, -0.05, 0, 0.05, 0.10, 0.20];
    return shocks.map(shock => ({
        type: 'vol',
        label: shock === 0 ? '基准' : (shock > 0 ? `+${(shock * 100).toFixed(0)}pp` : `${(shock * 100).toFixed(0)}pp`),
        shock,
        P_prime: { ...P, vol: Math.max(P.vol + shock, 0.01) }
    }));
}

// spot 跳跃情景：7 档（含基准 0）
// jumps = [-0.20, -0.10, -0.05, 0, 0.05, 0.10, 0.20]
// 实际 s0 = P.s0 * (1 + jump)
export function buildSpotScenarios(P) {
    const jumps = [-0.20, -0.10, -0.05, 0, 0.05, 0.10, 0.20];
    return jumps.map(jump => ({
        type: 'spot',
        label: jump === 0 ? '基准' : (jump > 0 ? `+${(jump * 100).toFixed(0)}%` : `${(jump * 100).toFixed(0)}%`),
        shock: jump,
        P_prime: { ...P, s0: P.s0 * (1 + jump) }
    }));
}

// 历史危机情景：3 个
// 2015 股灾：000905.SH, 2015-06-12 ~ 2015-09-15
// 2020 新冠：000300.SH, 2020-02-20 ~ 2020-04-30
// 2024 量化风暴：000852.SH, 2024-01-29 ~ 2024-03-08
// 数据窗口覆盖不到的区间自动跳过（切片 <2 条或波动率为 0）。
export async function buildCrisisScenarios(P, sliceFn) {
    const slice = sliceFn || (async (code, start, end) => {
        const { sliceHist } = await import('../data/hist.js');
        return sliceHist(code, start, end);
    });
    const crises = [
        { name: '2015 股灾', code: '000905.SH', start: '2015-06-12', end: '2015-09-15' },
        { name: '2020 新冠', code: '000300.SH', start: '2020-02-20', end: '2020-04-30' },
        { name: '2024 量化风暴', code: '000852.SH', start: '2024-01-29', end: '2024-03-08' },
    ];
    const results = [];
    for (const c of crises) {
        try {
            // 日期为 8 位字符串（如 '20150612'），需去掉横线
            const start = c.start.replace(/-/g, '');
            const end = c.end.replace(/-/g, '');
            const sliced = await slice(c.code, start, end);
            if (!sliced || sliced.length < 2) continue;
            const prices = sliced.map(d => d[1]);
            // 日对数收益率标准差 × √252 = 年化波动率（与 backtest.js intervalRealizedVol 一致）
            let sumSq = 0, cnt = 0;
            for (let i = 1; i < prices.length; i++) {
                if (prices[i - 1] > 0) {
                    const r = Math.log(prices[i] / prices[i - 1]);
                    sumSq += r * r;
                    cnt++;
                }
            }
            if (cnt === 0) continue;
            const crisisVol = Math.sqrt(sumSq / cnt * 252);
            results.push({
                type: 'crisis',
                label: c.name,
                crisisVol,
                P_prime: { ...P, vol: crisisVol }
            });
        } catch (e) {
            // 数据加载失败，静默跳过该危机（不包含在返回数组中）
            continue;
        }
    }
    return results;
}

// 5×5 网格：vol -10/-5/0/+5/+10pp × spot -10/-5/0/+5/+10%
export function buildMatrixScenarios(P) {
    const volShocks = [-0.10, -0.05, 0, 0.05, 0.10];
    const spotJumps = [-0.10, -0.05, 0, 0.05, 0.10];
    const scenarios = [];
    for (const vshock of volShocks) {
        for (const sjump of spotJumps) {
            scenarios.push({
                type: 'matrix',
                volShock: vshock,
                spotJump: sjump,
                label: `vol${vshock * 100 > 0 ? '+' : ''}${(vshock * 100).toFixed(0)}pp × spot${sjump * 100 > 0 ? '+' : ''}${(sjump * 100).toFixed(0)}%`,
                P_prime: {
                    ...P,
                    vol: Math.max(P.vol + vshock, 0.01),
                    s0: P.s0 * (1 + sjump)
                }
            });
        }
    }
    return scenarios; // 25 个
}

// ====== 主运行函数 ======
// 对每个情景计算 PV 和 Greeks，返回结果数组
// normals 是共享的 Sobol 随机数（CRN），由调用方通过 generateNormals(P.nPaths, P.nSteps) 传入
export function runStressTest(P, scenarios, normals) {
    // 基准计算（无冲击）
    const basePv = priceWithNormals(P, normals);
    const baseGreeks = computeGreeks(P, normals);

    const results = [];
    for (const sc of scenarios) {
        try {
            // 用同一组 normals 计算 P' 的 PV 和 Greeks（CRN）
            const pv = priceWithNormals(sc.P_prime, normals);
            const greeks = computeGreeks(sc.P_prime, normals);
            results.push({
                scenario: sc,
                pv,
                greeks,
                delta_pv: pv - basePv,
                delta_greeks: {
                    delta: greeks.delta - baseGreeks.delta,
                    gamma: greeks.gamma - baseGreeks.gamma,
                    vega: greeks.vega - baseGreeks.vega,
                    theta: greeks.theta - baseGreeks.theta,
                },
                // computeGreeks 不返回 kiProb，priceWithNormals 返回数字亦无 kiProb，故取 0
                ki_prob: greeks.kiProb || 0,
                base_pv: basePv,
                base_ki_prob: 0,
            });
        } catch (e) {
            // 情景计算失败：返回错误信息，pv 为 NaN
            results.push({
                scenario: sc,
                pv: NaN,
                error: e.message,
            });
        }
    }
    return results;
}
