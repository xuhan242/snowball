// book-checkup.mjs - 账本口径数值体检（v7.1.0 入库存档，保证文档数字可复现）
// 输出两窗口 × 三频率体检表：账本盈亏 / 两腿 / 归因四项 / |ε/账本盈亏|，
// 并附 ε 分解列：L（对冲腿一日滞后项，legacy 时序）与 TE（盯市 Taylor 余项），
// 恒等式 ε = L − TE 由本脚本逐格复核（docs/book-accounting.md §4/§8）。
// 用法：node tools/book-checkup.mjs
import { buildGreeksTable, lookupGreeksTable } from '../src/core/table.js';
import { backtestHedge } from '../src/core/backtest.js';
import { loadHistData } from '../src/data/hist.js';

function preset500() {
    const P = {
        s0: 8745.26, koPct: 1.00, kiPct: 0.75,
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

const P = preset500();
const all = await loadHistData('000905.SH');
const windows = [
    ['2024H1', '20240101', '20240630'],
    ['2025H1', '20250101', '20250630'],
];
const N = P.notional * 10000;
let pass20 = 0, pass50 = 0, fail = 0;

console.log(`账本口径数值体检 | notional N = ${N} 元 | 单边成本 5bps | 建表 = UI 同款自适应网格（btP.s0 = 窗口首日价）`);
for (const [label, start, end] of windows) {
    const slice = all.filter(([d]) => d >= start && d <= end);
    if (slice.length < 20) throw new Error(`${label} 切片仅 ${slice.length} 条`);
    const histPrices = slice.map(d => d[1]);
    const btS0 = histPrices[0];
    const btP = Object.assign({}, P, { s0: btS0 });
    const table = await buildGreeksTable(btP, null, histPrices);

    // 逐日全量分解（与引擎同查表）：D_same / ΣΔV / Σ½γdS² / Σθ/12 → L 与 TE
    const prices = histPrices;
    const totalDays = prices.length - 1;
    let Dsame = 0, sumHalfGamma = 0, sumTheta = 0, sumDeltaV = 0;
    for (let i = 0; i < totalDays; i++) {
        const S_cur = prices[i], S_next = prices[i + 1];
        const dS = S_next - S_cur;
        const g = lookupGreeksTable(table, S_cur / btS0, Math.max(1, (totalDays - i) / 252 * 12));
        const gN = lookupGreeksTable(table, S_next / btS0, Math.max(1, (totalDays - i - 1) / 252 * 12));
        Dsame += g.delta * dS * N;
        sumHalfGamma += 0.5 * g.gamma * dS * dS * N;
        sumTheta += g.theta * N / 12;
        sumDeltaV += (gN.p - g.p) * N;
    }
    const TE = sumDeltaV - Dsame - sumHalfGamma - sumTheta;

    for (const freq of ['daily', 'weekly', 'monthly']) {
        const r = await backtestHedge(P, slice, table, freq, 5);
        const L = r.cumPnL - Dsame;
        const ident = r.bookResidual - (L - TE);
        const epsPct = Math.abs(r.bookResidual) / Math.max(Math.abs(r.bookPnL), 1) * 100;
        if (epsPct < 20) pass20++; else if (epsPct < 50) pass50++; else fail++;
        const flag = epsPct < 20 ? '优秀' : epsPct < 50 ? '可接受' : '超标';
        console.log(`${label} ${freq.padEnd(7)} n=${r.n} s0=${r.s0.toFixed(1)} | bookPnL=${r.bookPnL.toFixed(0)} (${(r.bookPnL / N * 100).toFixed(2)}%N) 负债腿=${r.liabPnL.toFixed(0)} (${(r.liabPnL / N * 100).toFixed(2)}%N) 对冲腿=${r.hedgePnL.toFixed(0)} (${(r.hedgePnL / N * 100).toFixed(2)}%N)`);
        console.log(`    Γ=${r.bookGammaPnL.toFixed(0)} (${(r.bookGammaPnL / N * 100).toFixed(2)}%N) Θ=${r.bookThetaPnL.toFixed(0)} (${(r.bookThetaPnL / N * 100).toFixed(2)}%N) cost=${r.totalCost.toFixed(0)} ε=${r.bookResidual.toFixed(0)} (${(r.bookResidual / N * 100).toFixed(2)}%N) |ε/book|=${epsPct.toFixed(1)}% ${flag}`);
        console.log(`    ε分解: L(滞后)=${L.toFixed(0)} (${(L / N * 100).toFixed(2)}%N) TE(盯市余项)=${TE.toFixed(0)} (${(TE / N * 100).toFixed(2)}%N) 恒等式ε−(L−TE)=${ident.toFixed(6)}`);
    }
}
console.log(`\n阈值判定（验收标准2）：<20% 优秀 ${pass20} 格 | 20~50% 可接受 ${pass50} 格 | ≥50% 超标 ${fail} 格（共 ${pass20 + pass50 + fail} 格）`);
