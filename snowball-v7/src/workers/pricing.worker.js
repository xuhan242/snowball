// pricing.worker.js - 定价分片：可运行于 Worker，也可主线程降级直调
// 输入: { P, normalsChunk, startPath, endPath, returnPaths }
// 输出 partial: { startPath, endPath, koCount, kiCount, kiLossCount,
//                 pvs: Float64Array, koTimes/kiTimes: Int32Array(-1=Infinity), paths: Float64Array|null }

import { simulatePathsDispatch } from '../core/paths.js';
import { evaluatePaths } from '../core/payoff.js';

export function computePricingPartial(P, normalsChunk, startPath, endPath, returnPaths = true) {
    const chunkSize = endPath - startPath;
    const P_local = { ...P, nPaths: chunkSize };
    const prices = simulatePathsDispatch(P_local, normalsChunk);
    const r = evaluatePaths(prices, P_local);

    const koCount = Math.round(r.koProb * chunkSize);
    const kiCount = Math.round(r.kiProb * chunkSize);
    const kiLossCount = Math.round(r.kiLossProb * chunkSize);

    const koTimes = new Int32Array(chunkSize);
    const kiTimes = new Int32Array(chunkSize);
    for (let i = 0; i < chunkSize; i++) {
        koTimes[i] = isFinite(r.koTimes[i]) ? r.koTimes[i] : -1;
        kiTimes[i] = isFinite(r.kiTimes[i]) ? r.kiTimes[i] : -1;
    }
    const pvs = new Float64Array(r.pvs);

    return {
        startPath, endPath,
        koCount, kiCount, kiLossCount,
        pvs, koTimes, kiTimes,
        paths: returnPaths ? prices : null,
    };
}

// Worker 环境才注册消息处理（主线程 dynamic import 时避免覆盖 window.onmessage）
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.onmessage = (e) => {
        const { id, P, normalsChunk, startPath, endPath, returnPaths } = e.data;
        try {
            const result = computePricingPartial(P, normalsChunk, startPath, endPath, returnPaths);
            const transfer = [normalsChunk.buffer, result.pvs.buffer, result.koTimes.buffer, result.kiTimes.buffer];
            if (result.paths) transfer.push(result.paths.buffer);
            self.postMessage({ id, result }, transfer);
        } catch (err) {
            self.postMessage({ id, error: err.message });
        }
    };
}

export async function runInMainThread(data) {
    const { P, normalsChunk, startPath, endPath, returnPaths } = data;
    return computePricingPartial(P, normalsChunk, startPath, endPath, returnPaths);
}

// 合并 partials → 完整定价结果。
// price/SE 从全局 pvs 按路径顺序重算累积量（与 evaluatePaths 的求和顺序一致），
// 与主线程 priceSnowball 逐位一致；计数为整数合并，天然精确。
export function mergePricingPartials(partials, P) {
    const nPaths = P.nPaths;
    let koCount = 0, kiCount = 0, kiLossCount = 0;
    const pvs = new Float64Array(nPaths);
    const koTimes = new Array(nPaths);
    const kiTimes = new Array(nPaths);
    let pathsArray = null;

    for (const p of partials) {
        koCount += p.koCount;
        kiCount += p.kiCount;
        kiLossCount += p.kiLossCount;
        pvs.set(p.pvs, p.startPath);
        // Int32(-1=Infinity) 转回与 evaluatePaths 同构的语义（-1 → Infinity）
        for (let i = 0; i < p.koTimes.length; i++) koTimes[p.startPath + i] = p.koTimes[i] === -1 ? Infinity : p.koTimes[i];
        for (let i = 0; i < p.kiTimes.length; i++) kiTimes[p.startPath + i] = p.kiTimes[i] === -1 ? Infinity : p.kiTimes[i];
        if (p.paths) {
            if (!pathsArray) pathsArray = new Float64Array(nPaths * (P.nSteps + 1));
            pathsArray.set(p.paths, p.startPath * (P.nSteps + 1));
        }
    }

    // 与 evaluatePaths 相同顺序的全局累积 → 逐位一致
    let tp = 0, tpSq = 0;
    for (let i = 0; i < nPaths; i++) {
        const pv = pvs[i];
        tp += pv;
        tpSq += pv * pv;
    }
    const mean = tp / nPaths;
    const variance = (tpSq / nPaths) - (mean * mean);
    const std = Math.sqrt(Math.max(0, variance));

    return {
        price: mean,
        pathStd: std,
        priceSE: std / Math.sqrt(nPaths),
        koProb: koCount / nPaths,
        kiProb: kiCount / nPaths,
        kiLossProb: kiLossCount / nPaths,
        surviveProb: 1 - koCount / nPaths - kiCount / nPaths,
        pvs, koTimes, kiTimes,
        paths: pathsArray,
        pathCount: nPaths,
    };
}
