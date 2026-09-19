// 黄金基准值提取：以 snowball-v5 legacy 运行时为唯一事实源，
// 在 Node 中复算 中证500标准预设 的定价/Greeks/曲面/查表/回测/压测，
// 产出 tests/golden.json 供 v7 回归对比。
// 仅收录确定性结果：jump 模式（Math.random 泊松流）与日内对冲（Math.random 子时段）不列入。
import fs from 'node:fs';
import { generateNormals } from '../../../snowball-v5/src/legacy/sobol.js';
import { priceSnowball, priceWithNormals, computeGreeks, findCouponForPrice, buildGreeksSurface } from '../../../snowball-v5/src/legacy/gbm.js';
import { buildGreeksTable, backtestHedge, sliceHist } from '../../../snowball-v5/src/legacy/backtest.js';
import { buildVolScenarios, buildSpotScenarios, buildMatrixScenarios, buildCrisisScenarios, runStressTest } from '../../../snowball-v5/src/legacy/stress.js';
// 批次二A：scaled 基线提取使用 v7 的查表与历史数据（二者已被 golden 回归证明与 v5 逐位一致）
import { buildGreeksTable as buildGreeksTableV7, lookupGreeksTable, buildGrids } from '../../src/core/table.js';
import { generateNormals as generateNormalsV7 } from '../../src/core/sobol.js';
import { loadHistData } from '../../src/data/hist.js';

// 中证500标准预设（v5 data.js PRESETS[0]），字段口径与 legacy/main.js:buildParamsFromForm 一致
export function preset500() {
    const P = {
        s0: 8745.26,
        koPct: 1.00, kiPct: 0.75,
        couponRate: 0.18, couponDiv: 0.18, couponTiered: false,
        couponEarly: 0, couponLate: 0, couponSwitchMonth: 12,
        tenorMonths: 24, lockoutMonths: 3,
        vol: 0.18, rf: 0.02, div: 0.0124,
        marginRate: 1.0, notional: 1000, nPaths: 8192,
        useLocalVol: true, useJump: false,
        jumpLambda: 0.5, jumpMean: 0, jumpStd: 0.08,
        koMode: 'fixed', koStartPct: 1.0, koStepPct: 0.005,
        useBB: true,
    };
    P.tenorYears = P.tenorMonths / 12;
    P.nSteps = Math.max(Math.round(P.tenorYears * 252), 1);
    P.strikeRef = P.s0;
    return P;
}

const round = (x, d = 10) => Number(x.toFixed(d));

export async function main(outPath) {
    const P = preset500();
    const g = { meta: {
        source: 'snowball-v5 v5.1.0 src/legacy (v4.101 运行时同源)',
        preset: '中证500标准: s0=8745.26 ki=75% ko=100% vol=18% rf=2% div=1.24% tenor=24M lockout=3M coupon=18% nPaths=8192 CEV',
        extractedAt: new Date().toISOString().slice(0, 10),
        notes: [
            'jump 模式泊松计数用 Math.random，不可复现，不入基准',
            'intraday2/4 对冲子时段用 Math.random，不可复现，不入基准',
            'v5 hist_data 窗口 2021-01-04 起，2015/2020 危机区间切片为空被静默跳过，仅 2024 可用',
        ],
    } };

    // Sobol 序列指纹（方向数表必须逐位一致）
    g.sobol = {
        first8_of_8192x504: Array.from(generateNormals(8192, 504).slice(0, 8), x => round(x, 12)),
        first4_of_64x8: Array.from(generateNormals(64, 8).slice(0, 4), x => round(x, 12)),
    };

    // 定价（CEV 默认路径，v7 修复不涉及，应逐位一致）
    const mc = priceSnowball(P);
    g.pricing_cev = {
        price: round(mc.price), koProb: round(mc.koProb, 8), kiProb: round(mc.kiProb, 8),
        kiLossProb: round(mc.kiLossProb, 8), surviveProb: round(mc.surviveProb, 8), priceSE: round(mc.priceSE, 10),
    };

    // GBM / GBM+BB（BB 桥噪声在 v7 中修复，此两项 v7 重立基线）
    const Pg = { ...P, useLocalVol: false, useBB: false };
    g.pricing_gbm = { price: round(priceSnowball(Pg).price) };
    g.greeks_gbm = mapGreeks(computeGreeks(Pg));
    const Pb = { ...P, useLocalVol: false, useBB: true };
    g.pricing_bb = { price: round(priceSnowball(Pb).price) };

    // Greeks（CEV 默认路径）
    g.greeks_cev = mapGreeks(computeGreeks(P));

    // 反推票息：目标 PV = 1.0（平价发行）
    const cs = findCouponForPrice(1.0, P);
    g.coupon_solve = { target: 1.0, coupon: round(cs.coupon, 8), verifyPrice: round(cs.verifyPrice, 8), iterations: cs.iterations };

    // Greeks 二维曲面（10 价 × N 期，delta/gamma 全网格）
    const surf = await buildGreeksSurface(P, null, null);
    g.surface = {
        priceGrid: surf.priceGrid.map(x => round(x, 6)),
        tenorGrid: surf.tenorGrid,
        delta: surf.rowData.map(r => r.row.map(c => round(c.g.delta))),
        gamma: surf.rowData.map(r => r.row.map(c => round(c.g.gamma))),
    };

    // Greeks 查表 24×24（默认网格 [0.70,1.15]，与历史数据无关）
    const table = await buildGreeksTable(P, null, null);
    g.table = {
        priceGrid: table.priceGrid.map(x => round(x, 6)),
        tenorGrid: table.tenorGrid,
        cells: Object.fromEntries(Object.entries(table.data).map(([k, v]) => [k, {
            d: round(v.delta), gm: round(v.gamma), v: round(v.vega), t: round(v.theta),
        }])),
    };

    // 对冲回测（daily/weekly/monthly 确定频率，2024 上半年，成本 5bps）
    const btSlice = sliceHist('000905.SH', '20240101', '20240630');
    g.bt_window = { code: '000905.SH', start: '20240101', end: '20240630', n: btSlice.length };
    const bt = {};
    for (const freq of ['daily', 'weekly', 'monthly']) {
        const r = await backtestHedge(P, btSlice, table, freq, 5);
        const last = r.path[r.path.length - 1];
        bt[freq] = {
            s0: round(r.s0, 4), totalReturn: round(r.totalReturn, 8), realizedVol: round(r.realizedVol, 8),
            cumPnL: round(r.cumPnL, 4), gammaPnL: round(r.gammaPnL, 4), thetaPnL: round(r.thetaPnL, 4),
            totalCost: round(r.totalCost, 4), residual: round(r.residual, 4),
            pathLast: { date: last.date, delta: round(last.delta, 8), cumPnL: round(last.cumPnL, 4) },
        };
    }
    g.backtest = bt;

    // 压力测试（CRN 共享 normals）
    const normals = generateNormals(P.nPaths, P.nSteps);
    const pack = rs => rs.map(r => ({
        label: r.scenario.label,
        pv: round(r.pv ?? NaN), delta_pv: round(r.delta_pv ?? NaN),
        delta: r.greeks ? round(r.greeks.delta) : null, vega: r.greeks ? round(r.greeks.vega) : null,
    }));
    g.stress = {
        base_pv: round(priceWithNormals(P, normals)),
        vol: pack(runStressTest(P, buildVolScenarios(P), normals)),
        spot: pack(runStressTest(P, buildSpotScenarios(P), normals)),
        matrix: pack(runStressTest(P, buildMatrixScenarios(P), normals)),
    };
    const crises = await buildCrisisScenarios(P);
    g.crisis = crises.map(c => ({
        label: c.label, crisisVol: round(c.crisisVol, 6),
        delta_pv: round(runStressTest(P, [c], normals)[0].delta_pv),
    }));

    fs.writeFileSync(outPath, JSON.stringify(g, null, 1));
    return Object.keys(g);
}

function mapGreeks(x) {
    return {
        delta: round(x.delta), gamma: round(x.gamma), vega: round(x.vega), theta: round(x.theta),
        rho: round(x.rho, 12), rhoQ: round(x.rhoQ, 12), vegaKI: round(x.vegaKI), vegaKO: round(x.vegaKO),
    };
}

// ====== 批次二A：回测口径复刻验证 + scaled 基线提取 ======
// replicaBacktest：逐日对冲回测循环的独立复刻（不调用 v5/v7 的 backtestHedge）。
//   mode='legacy'：golden.json 提取时的旧口径——盈亏 ×(N/btS0)、Gamma 用相对涨幅 (dS/btS0)²、
//                  交易成本按份额计费 |Δδ×N|×rate、Theta ÷252；
//   mode='scaled'：仅应用 docs/backtest-scaling-fix.md 的四处单位修正——
//                  盈亏 ×N、Gamma 绝对点位 dS²、成本按成交金额 |Δδ×N|×S_t×rate、Theta ÷12（交易日）。
// 仅支持确定性频率 daily/weekly/monthly（intraday2/4 依赖 Math.random）。
// 语句顺序与 v7 src/core/backtest.js 逐日分支保持一致，浮点累加顺序不变。
function replicaBacktest(P, histSlice, greeksTable, freq, costBps, mode) {
    const n = histSlice.length;
    if (n < 20) throw new Error('历史数据不足 20 条');
    const prices = histSlice.map(d => d[1]);
    const dates = histSlice.map(d => d[0]);
    const btS0 = prices[0];
    const N = P.notional * 10000;
    const costRate = costBps / 10000;
    const rebalanceDays = { weekly: 5, monthly: 21 }[freq] || 1;

    let position = 0;
    let cumPnL = 0;
    let totalCost = 0;
    let gammaPnL = 0;
    let thetaPnL = 0;
    let prevGamma = 0, prevTheta = 0;
    const totalDays = n - 1;
    const path = [];

    for (let i = 0; i < totalDays; i++) {
        const S_cur = prices[i];
        const S_next = prices[i + 1];
        const dS = S_next - S_cur;
        const ratio = S_cur / btS0;

        const remainingDays = totalDays - i;
        const remainingMonths = Math.max(1, remainingDays / 252 * 12);
        const g = lookupGreeksTable(greeksTable, ratio, remainingMonths);

        const subPnL = position * dS;

        if (i > 0) {
            gammaPnL += mode === 'scaled'
                ? 0.5 * prevGamma * dS * dS * N
                : 0.5 * prevGamma * (dS / btS0) * (dS / btS0) * N;
            thetaPnL += mode === 'scaled' ? prevTheta * N / 12 : prevTheta * N / 252;
        }

        if (i % rebalanceDays === 0) {
            const tradeShares = (g.delta - position) * N;
            const cost = mode === 'scaled'
                ? Math.abs(tradeShares) * S_cur * costRate
                : Math.abs(tradeShares) * costRate;
            totalCost += cost;
            position = g.delta;
        }

        cumPnL += mode === 'scaled' ? subPnL * N : subPnL * (N / btS0);

        path.push({ t: i, date: dates[i], S: S_cur, ratio, delta: g.delta, gamma: g.gamma, theta: g.theta, cumPnL, position });
        prevGamma = g.gamma;
        prevTheta = g.theta;
    }

    let sumSq = 0, cnt = 0;
    for (let i = 1; i < n; i++) {
        if (prices[i - 1] > 0) {
            const r = Math.log(prices[i] / prices[i - 1]);
            sumSq += r * r;
            cnt++;
        }
    }
    const realizedVol = cnt > 0 ? Math.sqrt(sumSq / cnt * 252) : 0;
    const residual = cumPnL - gammaPnL - thetaPnL + totalCost;
    const last = path[path.length - 1];
    return {
        s0: btS0, totalReturn: prices[n - 2] / btS0 - 1, realizedVol,
        cumPnL, gammaPnL, thetaPnL, totalCost, residual,
        pathLast: { date: last.date, delta: last.delta, cumPnL: last.cumPnL },
    };
}

function packBacktest(r) {
    return {
        s0: round(r.s0, 4), totalReturn: round(r.totalReturn, 8), realizedVol: round(r.realizedVol, 8),
        cumPnL: round(r.cumPnL, 4), gammaPnL: round(r.gammaPnL, 4), thetaPnL: round(r.thetaPnL, 4),
        totalCost: round(r.totalCost, 4), residual: round(r.residual, 4),
        pathLast: { date: r.pathLast.date, delta: round(r.pathLast.delta, 8), cumPnL: round(r.pathLast.cumPnL, 4) },
    };
}

// 步骤一（复刻验证）+ 步骤二（仅改缩放重取）：
// 1) legacy 复刻必须先与 tests/golden.json 现有回测键逐位一致（舍入 Number(x.toFixed(d))）；
// 2) 通过后以 scaled 口径重取回测键，写 tests/golden-v7-scaled.json（其余键原样复制 golden.json）。
export async function mainScaled(outPath, goldenPath) {
    const P = preset500();
    const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    const slice = (await loadHistData('000905.SH')).filter(([d]) => d >= '20240101' && d <= '20240630');
    if (slice.length !== golden.bt_window.n) throw new Error(`切片 ${slice.length} 条 ≠ golden bt_window.n ${golden.bt_window.n}`);

    const table = await buildGreeksTableV7(P, null, null);
    const freqs = ['daily', 'weekly', 'monthly'];

    // 复刻验证：legacy 口径 vs golden.json 逐位
    for (const freq of freqs) {
        const got = packBacktest(replicaBacktest(P, slice, table, freq, 5, 'legacy'));
        const exp = golden.backtest[freq];
        for (const k of ['s0', 'totalReturn', 'realizedVol', 'cumPnL', 'gammaPnL', 'thetaPnL', 'totalCost', 'residual']) {
            if (got[k] !== exp[k]) throw new Error(`复刻失真 ${freq}.${k}: replica=${got[k]} golden=${exp[k]}`);
        }
        if (got.pathLast.date !== exp.pathLast.date || got.pathLast.delta !== exp.pathLast.delta || got.pathLast.cumPnL !== exp.pathLast.cumPnL) {
            throw new Error(`复刻失真 ${freq}.pathLast: replica=${JSON.stringify(got.pathLast)} golden=${JSON.stringify(exp.pathLast)}`);
        }
    }
    console.log('复刻验证通过：daily/weekly/monthly 全部回测键与 golden.json 逐位一致');

    // 仅改缩放：scaled 口径重取
    const bt = {};
    for (const freq of freqs) {
        bt[freq] = packBacktest(replicaBacktest(P, slice, table, freq, 5, 'scaled'));
    }

    const out = JSON.parse(JSON.stringify(golden));
    out.backtest = bt;
    out.scaled_v7 = {
        generatedAt: new Date().toISOString().slice(0, 10),
        diff: '与 golden.json 唯一差异 = backtest 键（bt_window 及其余键原样复制）',
        fixes: [
            'cumPnL：subPnL×N（去掉 ÷btS0），对冲份额 = delta×N',
            'gammaPnL：0.5×gamma×dS²×N（绝对点位，不再用相对涨幅）',
            'totalCost：|Δdelta×N|×S_t×costRate（按成交金额计费，日内子时段同理）',
            'thetaPnL：theta×N/12（每交易日，与 Greeks 卡片 g/12×N 口径一致；原为 /252）',
        ],
        derivation: 'docs/backtest-scaling-fix.md',
        verification: 'legacy 复刻先与 golden.json 回测键逐位一致，再仅应用口径修正重取',
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
    console.log('golden-v7-scaled.json written: backtest keys re-based');
    return Object.keys(bt);
}

// ====== v7.1.0：账本级基线提取（golden-v7-book.json，三步法） ======
// 账本复刻循环：独立实现（不调用 v7 backtestHedge），时序与 docs/book-accounting.md §5 一致；
// 腿级语句序与 replicaBacktest('scaled') 相同，账本累加序与 v7 引擎逐语句对应（浮点逐位一致的前提）。
function replicaBookBacktest(P, histSlice, greeksTable, freq, costBps) {
    const n = histSlice.length;
    if (n < 20) throw new Error('历史数据不足 20 条');
    const prices = histSlice.map(d => d[1]);
    const dates = histSlice.map(d => d[0]);
    void dates;
    const btS0 = prices[0];
    const N = P.notional * 10000;
    const costRate = costBps / 10000;
    const rebalanceDays = { weekly: 5, monthly: 21 }[freq] || 1;

    let position = 0;
    let cumPnL = 0, totalCost = 0, gammaPnL = 0, thetaPnL = 0;
    let prevGamma = 0, prevTheta = 0;
    let liabPnL = 0, bookGammaPnL = 0, bookThetaPnL = 0, bookPnL = 0;
    const totalDays = n - 1;

    for (let i = 0; i < totalDays; i++) {
        const S_cur = prices[i];
        const S_next = prices[i + 1];
        const dS = S_next - S_cur;
        const ratio = S_cur / btS0;
        const remainingDays = totalDays - i;
        const remainingMonths = Math.max(1, remainingDays / 252 * 12);
        const g = lookupGreeksTable(greeksTable, ratio, remainingMonths);
        const gNext = lookupGreeksTable(greeksTable, S_next / btS0, Math.max(1, (totalDays - i - 1) / 252 * 12));

        const subPnL = position * dS;

        if (i > 0) {
            gammaPnL += 0.5 * prevGamma * dS * dS * N;
            thetaPnL += prevTheta * N / 12;
        }

        let dayCost = 0;
        if (i % rebalanceDays === 0) {
            const tradeShares = (g.delta - position) * N;
            const cost = Math.abs(tradeShares) * S_cur * costRate;
            totalCost += cost;
            dayCost = cost;
            position = g.delta;
        }

        cumPnL += subPnL * N;

        const liabMove = (g.p - gNext.p) * N;
        liabPnL += liabMove;
        bookGammaPnL += -0.5 * g.gamma * dS * dS * N;
        bookThetaPnL += -g.theta * N / 12;
        bookPnL += subPnL * N + liabMove - dayCost;

        prevGamma = g.gamma;
        prevTheta = g.theta;
    }

    const residual = cumPnL - gammaPnL - thetaPnL + totalCost;
    const bookResidual = bookPnL - bookGammaPnL - bookThetaPnL + totalCost;
    return {
        cumPnL, gammaPnL, thetaPnL, totalCost, residual,
        bookPnL, hedgePnL: cumPnL, liabPnL, bookGammaPnL, bookThetaPnL, bookResidual,
    };
}

function packBookBacktest(r) {
    return {
        bookPnL: round(r.bookPnL, 4), hedgePnL: round(r.hedgePnL, 4), liabPnL: round(r.liabPnL, 4),
        bookGammaPnL: round(r.bookGammaPnL, 4), bookThetaPnL: round(r.bookThetaPnL, 4),
        bookResidual: round(r.bookResidual, 4),
    };
}

// 步骤一（每格 p 与 v5 legacy 直接一致）+ 步骤二（腿级复刻 vs golden-v7-scaled 逐位）
// + 步骤三（账本复刻提取），产出 tests/golden-v7-book.json。
export async function mainBook(outPath, scaledPath) {
    const P = preset500();
    const scaled = JSON.parse(fs.readFileSync(scaledPath, 'utf8'));
    const slice = (await loadHistData('000905.SH')).filter(([d]) => d >= '20240101' && d <= '20240630');
    if (slice.length !== scaled.bt_window.n) throw new Error(`切片 ${slice.length} 条 ≠ scaled bt_window.n ${scaled.bt_window.n}`);

    const table = await buildGreeksTableV7(P, null, null);

    // 步骤一：每格 p 与 v5 legacy priceWithNormals（同 CRN 截断、同参数）一致
    const grids = buildGrids(P, null);
    const { priceGrid, finalTenorGrid, maxSteps, nPaths } = grids;
    let checked = 0;
    for (let ti = 0; ti < finalTenorGrid.length; ti++) {
        const tenor = finalTenorGrid[ti];
        const nSteps = Math.max(20, Math.round(tenor / 12 * 252));
        const sharedNormals = generateNormalsV7(nPaths, maxSteps);
        const truncBuf = new Float64Array(nPaths * nSteps);
        for (let p = 0; p < nPaths; p++) {
            const srcBase = p * maxSteps, dstBase = p * nSteps;
            for (let j = 0; j < nSteps; j++) truncBuf[dstBase + j] = sharedNormals[srcBase + j];
        }
        const baseP = Object.assign({}, P, { nPaths });
        for (let pi = 0; pi < priceGrid.length; pi++) {
            const pp = Object.assign({}, baseP, {
                s0: priceGrid[pi] * P.s0, tenorMonths: tenor, tenorYears: tenor / 12,
                nSteps, strikeRef: P.s0,
            });
            const legacyP = priceWithNormals(pp, truncBuf);
            const cellP = table.data[pi + '_' + ti].p;
            if (Number(legacyP.toFixed(12)) !== Number(cellP.toFixed(12))) {
                throw new Error(`格 ${pi}_${ti} p 失真: legacy=${legacyP} table=${cellP}`);
            }
            checked++;
        }
    }
    if (checked !== 552) throw new Error(`p 校验格数 ${checked} ≠ 552`);
    console.log(`步骤一通过：${checked} 格 p 与 v5 legacy priceWithNormals 一致（Number(x.toFixed(12)) 口径）`);

    // 步骤二：腿级复刻与 golden-v7-scaled.json 逐位一致
    for (const freq of ['daily', 'weekly', 'monthly']) {
        const got = packBacktest(replicaBacktest(P, slice, table, freq, 5, 'scaled'));
        const exp = scaled.backtest[freq];
        for (const k of ['s0', 'totalReturn', 'realizedVol', 'cumPnL', 'gammaPnL', 'thetaPnL', 'totalCost', 'residual']) {
            if (got[k] !== exp[k]) throw new Error(`步骤二失真 ${freq}.${k}: replica=${got[k]} scaled=${exp[k]}`);
        }
        if (got.pathLast.date !== exp.pathLast.date || got.pathLast.delta !== exp.pathLast.delta || got.pathLast.cumPnL !== exp.pathLast.cumPnL) {
            throw new Error(`步骤二失真 ${freq}.pathLast: replica=${JSON.stringify(got.pathLast)} scaled=${JSON.stringify(exp.pathLast)}`);
        }
    }
    console.log('步骤二通过：腿级复刻与 golden-v7-scaled.json 回测键逐位一致');

    // 步骤三：账本复刻提取
    const bt = {};
    for (const freq of ['daily', 'weekly', 'monthly']) {
        bt[freq] = packBookBacktest(replicaBookBacktest(P, slice, table, freq, 5));
    }

    const out = {
        meta: {
            generatedAt: new Date().toISOString().slice(0, 10),
            diff: '与 golden.json / golden-v7-scaled.json 并存的新基线：仅含 table_p（查表 552 格 PV）与 backtest（账本级键）；不改动既有两基线任何键',
            method: 'extractor 三步法：每格 p 与 v5 legacy priceWithNormals（同 CRN 截断）一致 → 腿级复刻与 golden-v7-scaled 逐位一致 → 账本复刻循环提取；v7 引擎独立实现，golden.test.mjs 断言两者逐位一致',
            derivation: 'docs/book-accounting.md',
        },
        table_p: {
            priceGrid: table.priceGrid.map(x => round(x, 6)),
            tenorGrid: table.tenorGrid,
            cells: Object.fromEntries(Object.entries(table.data).map(([k, v]) => [k, round(v.p, 10)])),
        },
        backtest: bt,
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
    console.log('golden-v7-book.json written');
    return Object.keys(out);
}

// 数值体检表：两个窗口 × 三频率，scaled 引擎（v7 backtestHedge，须先完成 src 修正），
// 建表走 UI 同款自适应管线（btP.s0 = 窗口首日价 + histPrices 自适应网格）。
export async function mainCheckup() {
    const { backtestHedge: btV7 } = await import('../../src/core/backtest.js');
    const P = preset500();
    const windows = [
        ['2024H1', '20240101', '20240630'],
        ['2025H1', '20250101', '20250630'],
    ];
    const all = await loadHistData('000905.SH');
    const rows = [];
    for (const [label, start, end] of windows) {
        const slice = all.filter(([d]) => d >= start && d <= end);
        if (slice.length < 20) throw new Error(`${label} 切片仅 ${slice.length} 条`);
        const histPrices = slice.map(d => d[1]);
        const btP = Object.assign({}, P, { s0: histPrices[0] });
        const table = await buildGreeksTableV7(btP, null, histPrices);
        for (const freq of ['daily', 'weekly', 'monthly']) {
            const r = await btV7(P, slice, table, freq, 5);
            rows.push({ label, freq, n: r.n, s0: r.s0, cumPnL: r.cumPnL, gammaPnL: r.gammaPnL, thetaPnL: r.thetaPnL, totalCost: r.totalCost, residual: r.residual });
        }
    }
    const N = P.notional * 10000;
    console.log(`notional N = ${N} 元（±10% 边界 = ${N * 0.1} 元）`);
    for (const r of rows) {
        const resPct = Math.abs(r.residual) / Math.max(Math.abs(r.cumPnL), 1e-9) * 100;
        console.log(`${r.label} ${r.freq.padEnd(7)} n=${r.n} s0=${r.s0.toFixed(1)} | cumPnL=${r.cumPnL.toFixed(0)} (${(r.cumPnL / N * 100).toFixed(3)}%N) gammaPnL=${r.gammaPnL.toFixed(0)} (${(r.gammaPnL / N * 100).toFixed(3)}%N) thetaPnL=${r.thetaPnL.toFixed(0)} (${(r.thetaPnL / N * 100).toFixed(3)}%N) cost=${r.totalCost.toFixed(0)} (${(r.totalCost / N * 100).toFixed(4)}%N) residual=${r.residual.toFixed(0)} (|res/cumPnL|=${resPct.toFixed(1)}%)`);
    }
    return rows;
}
