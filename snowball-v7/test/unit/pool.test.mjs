// Worker 池单测：分片合并与主线程整算的一致性 + Node 降级链
import url from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const { generateNormals } = await import(url.pathToFileURL(path.join(root, 'src/core/sobol.js')).href);
const { priceSnowball, priceWithNormals } = await import(url.pathToFileURL(path.join(root, 'src/core/pricing.js')).href);
const { computeGreeks } = await import(url.pathToFileURL(path.join(root, 'src/core/greeks.js')).href);
const { computePricingPartial, mergePricingPartials } = await import(url.pathToFileURL(path.join(root, 'src/workers/pricing.worker.js')).href);
const { computeGreeksPartial, mergeGreeksPartials } = await import(url.pathToFileURL(path.join(root, 'src/workers/greeks.worker.js')).href);
const { getPool } = await import(url.pathToFileURL(path.join(root, 'src/workers/pool.js')).href);
const { buildGreeksTable } = await import(url.pathToFileURL(path.join(root, 'src/core/table.js')).href);

function P4k() {
    const P = {
        s0: 8745.26, koPct: 1.00, kiPct: 0.75,
        couponRate: 0.18, couponDiv: 0.18, couponTiered: false,
        couponEarly: 0, couponLate: 0, couponSwitchMonth: 12,
        tenorMonths: 24, lockoutMonths: 3,
        vol: 0.18, rf: 0.02, div: 0.0124,
        marginRate: 1.0, notional: 1000, nPaths: 4096,
        useLocalVol: true, useJump: false,
        jumpLambda: 0.5, jumpMean: 0, jumpStd: 0.08,
        koMode: 'fixed', koStartPct: 1.0, koStepPct: 0.005,
        useBB: false,
    };
    P.tenorYears = P.tenorMonths / 12;
    P.nSteps = Math.max(Math.round(P.tenorYears * 252), 1);
    P.strikeRef = P.s0;
    return P;
}

export default async function run(t) {
    t.test('pool: 定价 4 分片合并 = 主线程整算（price/SE/概率/pvs 逐位）', () => {
        const P = P4k();
        const normals = generateNormals(P.nPaths, P.nSteps);
        const ref = priceSnowball(P);

        const nShards = 4, shardSize = Math.ceil(P.nPaths / nShards);
        const partials = [];
        for (let i = 0; i < nShards; i++) {
            const startPath = i * shardSize;
            const endPath = Math.min(startPath + shardSize, P.nPaths);
            if (startPath >= endPath) continue;
            const chunk = normals.slice(startPath * P.nSteps, endPath * P.nSteps);
            partials.push(computePricingPartial(P, chunk, startPath, endPath, true));
        }
        const merged = mergePricingPartials(partials, P);

        if (merged.price !== ref.price) throw new Error(`price ${merged.price} ≠ ${ref.price}`);
        if (merged.priceSE !== ref.priceSE) throw new Error(`SE ${merged.priceSE} ≠ ${ref.priceSE}`);
        if (merged.koProb !== ref.koProb) throw new Error(`koProb ${merged.koProb} ≠ ${ref.koProb}`);
        if (merged.kiProb !== ref.kiProb) throw new Error(`kiProb ${merged.kiProb} ≠ ${ref.kiProb}`);
        if (merged.kiLossProb !== ref.kiLossProb) throw new Error(`kiLossProb 不一致`);
        for (let i = 0; i < P.nPaths; i++) {
            if (merged.pvs[i] !== ref.pvs[i]) throw new Error(`pvs[${i}] 不一致`);
        }
        // pvs 独立副本：合并结果与 normals 无共享引用
        if (merged.pvs.buffer === normals.buffer) throw new Error('pvs 与 normals 共享 buffer');
    });

    t.test('pool: Greeks 分片合并 ≈ 主线程整算（相对偏差 <1e-12）', () => {
        const P = P4k();
        const normals = generateNormals(P.nPaths, P.nSteps);
        const ref = computeGreeks(P, normals);

        const nShards = 4, shardSize = Math.ceil(P.nPaths / nShards);
        const partials = [];
        for (let i = 0; i < nShards; i++) {
            const startPath = i * shardSize;
            const endPath = Math.min(startPath + shardSize, P.nPaths);
            const chunk = normals.slice(startPath * P.nSteps, endPath * P.nSteps);
            partials.push(computeGreeksPartial(P, chunk, startPath, endPath));
        }
        const merged = mergeGreeksPartials(partials, P);
        for (const k of ['delta', 'gamma', 'vega', 'theta', 'rho', 'rhoQ']) {
            // 分片求和结合顺序差异 → ulp 级噪声经差分抵消放大；
            // PV 量级 ~1，绝对偏差 <1e-11 或相对 <1e-12 均视为合并等价
            const absOk = Math.abs(merged[k] - ref[k]) <= 1e-11;
            const relOk = Math.abs(merged[k] - ref[k]) / Math.max(Math.abs(ref[k]), 1e-12) <= 1e-12;
            if (!absOk && !relOk) {
                throw new Error(`${k}: merged=${merged[k]} ref=${ref[k]}`);
            }
        }
    });

    t.test('pool: Node 无 Worker 环境 → 降级主线程出结果', async () => {
        const P = { ...P4k(), nPaths: 512 };
        const normals = generateNormals(P.nPaths, P.nSteps);
        const pool = getPool();
        const r = await pool.runPricing(P, normals, false);
        const ref = priceSnowball(P);
        if (r.price !== ref.price) throw new Error(`降级链 price ${r.price} ≠ ${ref.price}`);
        if (r.paths !== null) throw new Error('returnPaths=false 时不应返回路径');
    });

    t.test('pool: runTable 降级模式与串行 buildGreeksTable 逐位一致（552 格）', async () => {
        const P = { ...P4k(), nPaths: 256 };
        const pool = getPool();
        const viaPool = await pool.runTable(P, null, null);
        const serial = await buildGreeksTable(P, null, null);
        if (JSON.stringify(viaPool.priceGrid) !== JSON.stringify(serial.priceGrid)) throw new Error('priceGrid 不一致');
        if (JSON.stringify(viaPool.tenorGrid) !== JSON.stringify(serial.tenorGrid)) throw new Error('tenorGrid 不一致');
        const keys = Object.keys(serial.data);
        if (keys.length !== 552) throw new Error('格数=' + keys.length);
        for (const k of keys) {
            for (const f of ['delta', 'gamma', 'vega', 'theta']) {
                if (viaPool.data[k][f] !== serial.data[k][f]) throw new Error(`${k}.${f} 不一致`);
            }
        }
    });
}
