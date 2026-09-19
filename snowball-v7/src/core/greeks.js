// greeks.js - Greeks (CRN 有限差分) 与 Greeks 曲面构建，逐字移植 v5
// 扰动量：ΔS=1%·S₀、Δσ=1pp、ΔT=12/252 保持 nSteps、Δr=Δq=10bp

import { generateNormals } from './sobol.js';
import { priceWithNormals } from './pricing.js';

// CRN（Common Random Numbers）共享随机数法计算 Greeks。
// Delta/Gamma：扰动 s0 用同组随机数差分，消去 MC 噪声 → 收敛更快
// Vega：扰动波动率
// Theta：减少期限（约12个交易日），保持 nSteps 不变只缩小 dt，实现真正 CRN
// Rho：利率敏感度；RhoQ：股息率敏感度
export function computeGreeks(P, externNormals) {
    const normals = externNormals || generateNormals(P.nPaths, P.nSteps);
    const ref = P.strikeRef || P.s0;
    const base = Object.assign({}, P, { strikeRef: ref });
    const epsS = 0.01, ds = P.s0 * epsS;

    const vBase = priceWithNormals(base, normals);
    const vUp = priceWithNormals(Object.assign({}, base, { s0: P.s0 + ds }), normals);
    const vDown = priceWithNormals(Object.assign({}, base, { s0: P.s0 - ds }), normals);
    const delta = (vUp - vDown) / (2 * ds);
    const gamma = (vUp - 2 * vBase + vDown) / (ds * ds);

    const epsV = 0.01;
    const vVU = priceWithNormals(Object.assign({}, P, { vol: P.vol + epsV }), normals);
    const vVD = priceWithNormals(Object.assign({}, P, { vol: Math.max(P.vol - epsV, 1e-4) }), normals);
    const vega = (vVU - vVD) / (2 * epsV) / 100;

    // Theta：期限缩短约12个交易日(0.5个月)，保持 nSteps 不变，dt 自动变小，CRN 严格成立
    const odm = 12 / 252;
    let theta = 0;
    if (P.tenorMonths - odm > 0) {
        const newTenor = P.tenorMonths - odm;
        const vTD = priceWithNormals(Object.assign({}, P, { tenorMonths: newTenor, tenorYears: newTenor / 12 }), normals);
        theta = vTD - vBase;
    }

    // Rho：利率 ± 10bp 中心差分，结果 ÷100 转"每1bp"
    const epsR = 0.001;
    const vRU = priceWithNormals(Object.assign({}, P, { rf: P.rf + epsR }), normals);
    const vRD = priceWithNormals(Object.assign({}, P, { rf: Math.max(P.rf - epsR, 1e-4) }), normals);
    const rho = (vRU - vRD) / (2 * epsR) / 100;

    // RhoQ：股息率 ± 10bp 中心差分
    const vQU = priceWithNormals(Object.assign({}, P, { div: P.div + epsR }), normals);
    const vQD = priceWithNormals(Object.assign({}, P, { div: Math.max(P.div - epsR, 1e-4) }), normals);
    const rhoQ = (vQU - vQD) / (2 * epsR) / 100;

    // Vega 分桶：额外计算 KI 价和 KO 价处的 Vega，反映波动率偏斜敞口
    // 仅在非网格调用（externNormals 为 undefined）时计算
    let vegaKI = 0, vegaKO = 0;
    if (!externNormals) {
        const refS = P.strikeRef || P.s0;
        const kiS = refS * P.kiPct;
        const koS = P.koMode === 'descending' ? refS * P.koStartPct : refS * P.koPct;
        if (Math.abs(kiS - P.s0) / P.s0 > 0.005) {
            const P_KI = Object.assign({}, P, { s0: kiS });
            const vKI_U = priceWithNormals(Object.assign({}, P_KI, { vol: P.vol + epsV }), normals);
            const vKI_D = priceWithNormals(Object.assign({}, P_KI, { vol: Math.max(P.vol - epsV, 1e-4) }), normals);
            vegaKI = (vKI_U - vKI_D) / (2 * epsV) / 100;
        }
        if (Math.abs(koS - P.s0) / P.s0 > 0.005) {
            const P_KO = Object.assign({}, P, { s0: koS });
            const vKO_U = priceWithNormals(Object.assign({}, P_KO, { vol: P.vol + epsV }), normals);
            const vKO_D = priceWithNormals(Object.assign({}, P_KO, { vol: Math.max(P.vol - epsV, 1e-4) }), normals);
            vegaKO = (vKO_U - vKO_D) / (2 * epsV) / 100;
        }
    }
    return { delta, gamma, vega, theta, rho, rhoQ, vegaKI, vegaKO, p: vBase };
}

// Vega 分桶（KI/KO 处 Vega）：并行 Greeks 合并后由主线程用同一组 normals 补算（v5 行为）
export function computeVegaBuckets(P, normals) {
    const epsV = 0.01;
    let vegaKI = 0, vegaKO = 0;
    const refS = P.strikeRef || P.s0;
    const kiS = refS * P.kiPct;
    const koS = P.koMode === 'descending' ? refS * P.koStartPct : refS * P.koPct;
    if (Math.abs(kiS - P.s0) / P.s0 > 0.005) {
        const P_KI = Object.assign({}, P, { s0: kiS });
        const vKI_U = priceWithNormals(Object.assign({}, P_KI, { vol: P.vol + epsV }), normals);
        const vKI_D = priceWithNormals(Object.assign({}, P_KI, { vol: Math.max(P.vol - epsV, 1e-4) }), normals);
        vegaKI = (vKI_U - vKI_D) / (2 * epsV) / 100;
    }
    if (Math.abs(koS - P.s0) / P.s0 > 0.005) {
        const P_KO = Object.assign({}, P, { s0: koS });
        const vKO_U = priceWithNormals(Object.assign({}, P_KO, { vol: P.vol + epsV }), normals);
        const vKO_D = priceWithNormals(Object.assign({}, P_KO, { vol: Math.max(P.vol - epsV, 1e-4) }), normals);
        vegaKO = (vKO_U - vKO_D) / (2 * epsV) / 100;
    }
    return { vegaKI, vegaKO };
}

// ====== Greeks 曲面构建（逐行计算，供主线程分片调度） ======
// priceGrid: KI~KO 区间 10 个价位
// tenorGrid: 前12月每月1点，之后每2月1点直到到期
// onRow(tenIdx, total, rowData, priceGrid, tenorGrid)：每完成一行回调，返回 false 可终止
// onCheckCancel()：返回 true 则终止计算
// 异步：每行后 yield 一次，让主线程能渲染 canvas/进度
export async function buildGreeksSurface(P, onRow, onCheckCancel) {
    const priceGrid = [];
    const tenorGrid = [];

    const loRatio = P.kiPct;
    const hiRatio = P.koMode === 'descending' ? P.koStartPct : P.koPct;
    for (let i = 0; i < 10; i++) priceGrid.push(loRatio + (hiRatio - loRatio) * i / 9);

    const T = P.tenorMonths;
    for (let m = 1; m <= Math.min(12, T); m++) tenorGrid.push(m);
    for (let m = 14; m <= T; m += 2) { if (tenorGrid.indexOf(m) === -1) tenorGrid.push(m); }
    if (tenorGrid[tenorGrid.length - 1] !== T) tenorGrid.push(T);

    const baseP = Object.assign({}, P);
    const rowData = [];

    for (let ti = 0; ti < tenorGrid.length; ti++) {
        if (onCheckCancel && onCheckCancel()) return null;

        const tenor = tenorGrid[ti];
        const nSteps = Math.max(20, Math.round(tenor / 12 * 252));
        const normals = generateNormals(P.nPaths, nSteps);
        const row = [];

        for (let pi = 0; pi < priceGrid.length; pi++) {
            if (onCheckCancel && onCheckCancel()) return null;
            const s = priceGrid[pi] * P.s0;
            const pp = Object.assign({}, baseP, {
                s0: s, tenorMonths: tenor, tenorYears: tenor / 12,
                nSteps: nSteps, strikeRef: P.s0
            });
            const g = computeGreeks(pp, normals);
            row.push({ pi, ti, g });
            // 每个价位点计算完后让出一帧，避免连续阻塞主线程
            await new Promise(r => setTimeout(r, 0));
        }

        rowData.push({ ti, tenor, row });
        if (onRow) {
            const cont = onRow(ti, tenorGrid.length, row, priceGrid, tenorGrid);
            if (cont === false) return null;
        }
    }

    return { priceGrid, tenorGrid, rowData };
}
