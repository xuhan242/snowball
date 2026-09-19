// table.js - Greeks 查表（24×24 自适应网格 + 4096 路径 + CRN 跨期截断 + 双线性插值）
// 逐字移植 v5 backtest.js 对应部分；网格构建与单列计算拆出供 Worker 并行复用。

import { generateNormals } from './sobol.js';
import { computeGreeks } from './greeks.js';

const TABLE_NPATHS = 4096;  // 固定 4096 路径（CRN 后 Delta SEM 足够）

// 网格构建：自适应价格网格 + 24 期非线性期限网格
export function buildGrids(P, histPrices) {
    let pMin = 0.70, pMax = 1.15;
    if (histPrices && histPrices.length > 0) {
        const ratios = histPrices.map(p => p / P.s0);
        const rMin = Math.min(...ratios), rMax = Math.max(...ratios);
        // 网格覆盖实际区间 ±5% 缓冲，但保证至少覆盖 [KI, KO]
        pMin = Math.min(pMin, rMin * 0.95, P.kiPct * 0.98);
        pMax = Math.max(pMax, rMax * 1.05, (P.koMode === 'descending' ? P.koStartPct : P.koPct) * 1.02);
        // 限制极端值
        pMin = Math.max(0.5, pMin);
        pMax = Math.min(1.3, pMax);
    }
    const nP = 24;  // 价格维度 24 格（细化）
    const priceGrid = [];
    for (let i = 0; i < nP; i++) {
        priceGrid.push(pMin + (pMax - pMin) * i / (nP - 1));
    }

    // 期限网格（24期，前密后疏捕捉短期Theta衰减）
    const nT = 24;
    const tenorGrid = [];
    for (let i = 0; i < nT; i++) {
        // 非线性分布：t_i = tenor * (i+1)^0.85 / nT^0.85，早期网格密、后期稍稀
        const t = Math.max(1, Math.round(P.tenorMonths * Math.pow((i + 1) / nT, 0.85)));
        if (i === 0 || t !== tenorGrid[i - 1]) tenorGrid.push(t);
    }
    const finalTenorGrid = [...new Set(tenorGrid)].sort((a, b) => a - b);

    // 最大步数（CRN 跨期截断的统一长度）
    const maxTenor = finalTenorGrid[finalTenorGrid.length - 1];
    const maxSteps = Math.max(20, Math.round(maxTenor / 12 * 252));
    return { priceGrid, finalTenorGrid, maxSteps, nPaths: TABLE_NPATHS };
}

// 单列（固定期限）准备：生成共享 Sobol normals → 截断到该列步数。
// 与主线程串行版逐位一致（每列独立重建 normals 与截断缓冲，同 v5）。
export function prepareTableColumn(P, grids, ti) {
    const { finalTenorGrid, maxSteps, nPaths } = grids;
    const tenor = finalTenorGrid[ti];
    const nSteps = Math.max(20, Math.round(tenor / 12 * 252));

    const sharedNormals = generateNormals(nPaths, maxSteps);
    const truncBuf = new Float64Array(nPaths * nSteps);
    for (let p = 0; p < nPaths; p++) {
        const srcBase = p * maxSteps;
        const dstBase = p * nSteps;
        for (let j = 0; j < nSteps; j++) {
            truncBuf[dstBase + j] = sharedNormals[srcBase + j];
        }
    }
    return { tenor, nSteps, truncBuf, nPaths };
}

// 单格计算：prepareTableColumn 的准备件 + 价格点索引 → Greeks
export function computeTableCell(P, grids, prep, pi) {
    const s = grids.priceGrid[pi] * P.s0;
    const pp = Object.assign({}, P, {
        nPaths: prep.nPaths,
        s0: s,
        tenorMonths: prep.tenor,
        tenorYears: prep.tenor / 12,
        nSteps: prep.nSteps,
        strikeRef: P.s0,
    });
    return computeGreeks(pp, prep.truncBuf);
}

// 单列（固定期限）计算：Worker 分片用（同步，整列一次算完）
export function computeTableColumn(P, grids, ti) {
    const prep = prepareTableColumn(P, grids, ti);
    const cells = {};
    for (let pi = 0; pi < grids.priceGrid.length; pi++) {
        cells[pi] = computeTableCell(P, grids, prep, pi);
    }
    return { ti, cells };
}

// 主线程串行版（Worker 不可用降级 / Node 测试 / golden 回归）
// histPrices: 可选，回测区间价格数组（用于自适应网格）
// onProgress: (current, total) => void
export async function buildGreeksTable(P, onProgress, histPrices) {
    const grids = buildGrids(P, histPrices);
    const { priceGrid, finalTenorGrid } = grids;
    const total = priceGrid.length * finalTenorGrid.length;
    let done = 0;
    const table = { priceGrid, tenorGrid: finalTenorGrid, data: {} };

    const YIELD_INTERVAL = 24;   // 每24个点（一列）才yield一次
    let yieldCounter = 0;

    for (let ti = 0; ti < finalTenorGrid.length; ti++) {
        const { cells } = computeTableColumn(P, grids, ti);
        for (const pi of Object.keys(cells)) {
            table.data[pi + '_' + ti] = cells[pi];
            done++;
            if (onProgress) onProgress(done, total);
            yieldCounter++;
            if (yieldCounter >= YIELD_INTERVAL) {
                yieldCounter = 0;
                await new Promise(r => setTimeout(r, 0));
            }
        }
    }

    if (yieldCounter > 0) await new Promise(r => setTimeout(r, 0));
    return table;
}

// 双线性插值查 Greeks
export function lookupGreeksTable(table, ratio, tenorMonths) {
    const { priceGrid, tenorGrid, data } = table;
    if (!priceGrid || priceGrid.length === 0) {
        return { delta: 0, gamma: 0, vega: 0, theta: 0, p: 0 };
    }

    // clamp 到网格范围
    ratio = Math.max(priceGrid[0], Math.min(priceGrid[priceGrid.length - 1], ratio));
    tenorMonths = Math.max(tenorGrid[0], Math.min(tenorGrid[tenorGrid.length - 1], tenorMonths));

    let pi = 0;
    while (pi < priceGrid.length - 1 && priceGrid[pi + 1] < ratio) pi++;
    const pFrac = pi < priceGrid.length - 1
        ? (ratio - priceGrid[pi]) / (priceGrid[pi + 1] - priceGrid[pi])
        : 0;

    let ti = 0;
    while (ti < tenorGrid.length - 1 && tenorGrid[ti + 1] < tenorMonths) ti++;
    const tFrac = ti < tenorGrid.length - 1
        ? (tenorMonths - tenorGrid[ti]) / (tenorGrid[ti + 1] - tenorGrid[ti])
        : 0;

    const g00 = data[pi + '_' + ti];
    const g10 = data[(pi + 1) + '_' + ti];
    const g01 = data[pi + '_' + (ti + 1)];
    const g11 = data[(pi + 1) + '_' + (ti + 1)];
    if (!g00 || !g10 || !g01 || !g11) {
        return { delta: 0, gamma: 0, vega: 0, theta: 0, p: 0 };
    }

    const intp = (a, b, f) => a + (b - a) * f;
    return {
        delta: intp(intp(g00.delta, g10.delta, pFrac), intp(g01.delta, g11.delta, pFrac), tFrac),
        gamma: intp(intp(g00.gamma, g10.gamma, pFrac), intp(g01.gamma, g11.gamma, pFrac), tFrac),
        vega: intp(intp(g00.vega, g10.vega, pFrac), intp(g01.vega, g11.vega, pFrac), tFrac),
        theta: intp(intp(g00.theta, g10.theta, pFrac), intp(g01.theta, g11.theta, pFrac), tFrac),
        p: intp(intp(g00.p, g10.p, pFrac), intp(g01.p, g11.p, pFrac), tFrac),
    };
}
