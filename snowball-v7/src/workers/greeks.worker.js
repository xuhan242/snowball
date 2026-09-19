// greeks.worker.js - Greeks 分片：各扰动场景的 partial sum 在主线程差分
// CRN：所有 shard 用同一组 Sobol normals 的不同路径段做同一组扰动。
// vegaKI/vegaKO 不在分片内计算，由调用方按需补算（v5 行为）。

import { priceWithNormals } from '../core/pricing.js';

export function computeGreeksPartial(P, normalsChunk, startPath, endPath) {
    const chunkSize = endPath - startPath;
    const P_local = { ...P, nPaths: chunkSize };
    const ref = P.strikeRef || P.s0;
    const epsS = 0.01, ds = P.s0 * epsS;
    const epsV = 0.01;
    const epsR = 0.001;
    const odm = 12 / 252;

    const scenarios = {
        base: { ...P_local, strikeRef: ref },
        sUp: { ...P_local, s0: P.s0 + ds, strikeRef: ref },
        sDown: { ...P_local, s0: P.s0 - ds, strikeRef: ref },
        vUp: { ...P_local, vol: P.vol + epsV },
        vDown: { ...P_local, vol: Math.max(P.vol - epsV, 1e-4) },
        rUp: { ...P_local, rf: P.rf + epsR },
        rDown: { ...P_local, rf: Math.max(P.rf - epsR, 1e-4) },
        qUp: { ...P_local, div: P.div + epsR },
        qDown: { ...P_local, div: Math.max(P.div - epsR, 1e-4) },
    };
    if (P.tenorMonths - odm > 0) {
        const newTenor = P.tenorMonths - odm;
        scenarios.tDown = { ...P_local, tenorMonths: newTenor, tenorYears: newTenor / 12 };
    }

    // 同一组 normalsChunk 逐场景求和
    const sums = {};
    for (const [name, Pp] of Object.entries(scenarios)) {
        const price = priceWithNormals(Pp, normalsChunk);
        sums[name] = { sumPv: price * chunkSize };
    }
    return { startPath, endPath, sums };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.onmessage = (e) => {
        const { id, P, normalsChunk, startPath, endPath } = e.data;
        try {
            const result = computeGreeksPartial(P, normalsChunk, startPath, endPath);
            self.postMessage({ id, result }, [normalsChunk.buffer]);
        } catch (err) {
            self.postMessage({ id, error: err.message });
        }
    };
}

export async function runInMainThread(data) {
    return computeGreeksPartial(data.P, data.normalsChunk, data.startPath, data.endPath);
}

// 合并 partial sums → 差分得六项 Greeks。
// 注：分片求和的结合顺序与全局单次累积存在 ulp 级差异（v5 同源行为），
// 与主线程 computeGreeks 对比允许 <1e-12 相对偏差。
export function mergeGreeksPartials(partials, P) {
    const nPaths = P.nPaths;
    const epsS = 0.01, ds = P.s0 * epsS;
    const epsV = 0.01;
    const epsR = 0.001;
    const odm = 12 / 252;

    const merged = {};
    for (const p of partials) {
        for (const [name, s] of Object.entries(p.sums)) {
            if (!merged[name]) merged[name] = 0;
            merged[name] += s.sumPv;
        }
    }
    const mean = (name) => (name in merged) ? merged[name] / nPaths : NaN;

    const vBase = mean('base');
    const vUp = mean('sUp');
    const vDown = mean('sDown');
    const delta = (vUp - vDown) / (2 * ds);
    const gamma = (vUp - 2 * vBase + vDown) / (ds * ds);

    const vega = (mean('vUp') - mean('vDown')) / (2 * epsV) / 100;

    let theta = 0;
    if (P.tenorMonths - odm > 0) theta = mean('tDown') - vBase;

    const rho = (mean('rUp') - mean('rDown')) / (2 * epsR) / 100;
    const rhoQ = (mean('qUp') - mean('qDown')) / (2 * epsR) / 100;

    return { delta, gamma, vega, theta, rho, rhoQ, vegaKI: 0, vegaKO: 0 };
}
