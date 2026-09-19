// golden.test.mjs - 黄金回归：v7 移植代码 vs tests/golden.json（v5 legacy 提取）
// CEV/GBM 路径全部逐位断言（同码同源应 bit 级一致）；BB/jump 因 v7 算法修正不比对 golden，
// 方向断言 + 新基线见 tests/golden-v7-fixed.json。
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const g = JSON.parse(await fs.readFile(path.join(root, 'tests', 'golden.json'), 'utf8'));
// 回测键基线：批次二A 口径修正后重立（差异仅回测键，见 docs/backtest-scaling-fix.md）
const gs = JSON.parse(await fs.readFile(path.join(root, 'tests', 'golden-v7-scaled.json'), 'utf8'));
// 账本级基线：v7.1.0 负债腿盯市（查表 PV + 账本回测键，见 docs/book-accounting.md）
const gb = JSON.parse(await fs.readFile(path.join(root, 'tests', 'golden-v7-book.json'), 'utf8'));

const { generateNormals } = await import(url.pathToFileURL(path.join(root, 'src/core/sobol.js')).href);
const { priceSnowball, priceWithNormals, findCouponForPrice } = await import(url.pathToFileURL(path.join(root, 'src/core/pricing.js')).href);
const { computeGreeks, buildGreeksSurface } = await import(url.pathToFileURL(path.join(root, 'src/core/greeks.js')).href);
const { buildGreeksTable } = await import(url.pathToFileURL(path.join(root, 'src/core/table.js')).href);
const { backtestHedge } = await import(url.pathToFileURL(path.join(root, 'src/core/backtest.js')).href);
const { buildVolScenarios, buildSpotScenarios, buildMatrixScenarios, buildCrisisScenarios, runStressTest } = await import(url.pathToFileURL(path.join(root, 'src/core/stress.js')).href);
const { loadHistData } = await import(url.pathToFileURL(path.join(root, 'src/data/hist.js')).href);

// 中证500标准预设（与 tools/extract-golden/entry.mjs preset500 逐字段一致）
export function preset500() {
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

// 与 extractor 相同的舍入口径：Number(x.toFixed(d))
const round = (x, d = 10) => Number(x.toFixed(d));

function assertEq(label, actual, expected) {
    if (actual !== expected) {
        throw new Error(`${label}: v7=${actual} golden=${expected}`);
    }
}

function mapGreeks(x) {
    return {
        delta: round(x.delta), gamma: round(x.gamma), vega: round(x.vega), theta: round(x.theta),
        rho: round(x.rho, 12), rhoQ: round(x.rhoQ, 12), vegaKI: round(x.vegaKI), vegaKO: round(x.vegaKO),
    };
}

async function btSlice2024H1() {
    const data = await loadHistData('000905.SH');
    return data.filter(([d]) => d >= '20240101' && d <= '20240630');
}

export default async function run(t) {
    const P = preset500();

    // ---------- Sobol 指纹 ----------
    t.test('golden: sobol 指纹 8192×504 前 8 值逐位一致', () => {
        const v = Array.from(generateNormals(8192, 504).slice(0, 8), x => round(x, 12));
        v.forEach((x, i) => assertEq(`[${i}]`, x, g.sobol.first8_of_8192x504[i]));
    });
    t.test('golden: sobol 指纹 64×8 前 4 值逐位一致', () => {
        const v = Array.from(generateNormals(64, 8).slice(0, 4), x => round(x, 12));
        v.forEach((x, i) => assertEq(`[${i}]`, x, g.sobol.first4_of_64x8[i]));
    });

    // ---------- CEV 定价（默认路径） ----------
    t.test('golden: CEV 定价 price/四概率/SE 逐位一致', () => {
        const mc = priceSnowball(P);
        const exp = g.pricing_cev;
        assertEq('price', round(mc.price), exp.price);
        assertEq('koProb', round(mc.koProb, 8), exp.koProb);
        assertEq('kiProb', round(mc.kiProb, 8), exp.kiProb);
        assertEq('kiLossProb', round(mc.kiLossProb, 8), exp.kiLossProb);
        assertEq('surviveProb', round(mc.surviveProb, 8), exp.surviveProb);
        assertEq('priceSE', round(mc.priceSE, 10), exp.priceSE);
    });

    // ---------- GBM 纯路径 ----------
    t.test('golden: GBM 定价 price 逐位一致', () => {
        const Pg = { ...P, useLocalVol: false, useBB: false };
        assertEq('price', round(priceSnowball(Pg).price), g.pricing_gbm.price);
    });

    // ---------- GBM+BB（v7 修正，不比 golden；方向断言 <1%） ----------
    t.test('fixed: BB 修正后价格与 v5 基线偏差 <1%（新基线另存）', () => {
        const Pb = { ...P, useLocalVol: false, useBB: true };
        const v7 = priceSnowball(Pb).price;
        const dev = Math.abs(v7 - g.pricing_bb.price) / g.pricing_bb.price;
        if (!(dev < 0.01)) throw new Error(`BB 偏差 ${dev} 超限`);
    });

    // ---------- Greeks ----------
    t.test('golden: CEV Greeks 八项逐位一致', () => {
        const v = mapGreeks(computeGreeks(P));
        for (const k of Object.keys(g.greeks_cev)) assertEq(k, v[k], g.greeks_cev[k]);
    });
    t.test('golden: GBM Greeks 八项逐位一致', () => {
        const Pg = { ...P, useLocalVol: false, useBB: false };
        const v = mapGreeks(computeGreeks(Pg));
        for (const k of Object.keys(g.greeks_gbm)) assertEq(k, v[k], g.greeks_gbm[k]);
    });

    // ---------- 反推票息 ----------
    t.test('golden: 反推票息 coupon/verifyPrice/iterations 逐位一致', () => {
        const cs = findCouponForPrice(1.0, P);
        assertEq('coupon', round(cs.coupon, 8), g.coupon_solve.coupon);
        assertEq('verifyPrice', round(cs.verifyPrice, 8), g.coupon_solve.verifyPrice);
        assertEq('iterations', cs.iterations, g.coupon_solve.iterations);
    });

    // ---------- Greeks 曲面（10 价 × N 期全网格） ----------
    t.test('golden: Greeks 曲面 priceGrid/tenorGrid/delta/gamma 全网格逐位一致', async () => {
        const surf = await buildGreeksSurface(P, null, null);
        surf.priceGrid.map(x => round(x, 6)).forEach((x, i) => assertEq(`priceGrid[${i}]`, x, g.surface.priceGrid[i]));
        assertEq('tenorGrid', JSON.stringify(surf.tenorGrid), JSON.stringify(g.surface.tenorGrid));
        surf.rowData.forEach((r, ti) => {
            r.row.forEach((c, pi) => {
                assertEq(`delta[${ti}][${pi}]`, round(c.g.delta), g.surface.delta[ti][pi]);
                assertEq(`gamma[${ti}][${pi}]`, round(c.g.gamma), g.surface.gamma[ti][pi]);
            });
        });
    });

    // ---------- Greeks 查表 24×24（552 格） ----------
    t.test('golden: Greeks 查表 priceGrid/tenorGrid/552 格逐位一致', async () => {
        const tab = await buildGreeksTable(P, null, null);
        tab.priceGrid.map(x => round(x, 6)).forEach((x, i) => assertEq(`priceGrid[${i}]`, x, g.table.priceGrid[i]));
        assertEq('tenorGrid', JSON.stringify(tab.tenorGrid), JSON.stringify(g.table.tenorGrid));
        const keys = Object.keys(g.table.cells);
        if (keys.length !== 552) throw new Error(`golden cells 数 ${keys.length} ≠ 552`);
        for (const k of keys) {
            const cell = g.table.cells[k];
            const v7 = tab.data[k];
            if (!v7) throw new Error(`查表缺格 ${k}`);
            assertEq(`${k}.d`, round(v7.delta), cell.d);
            assertEq(`${k}.gm`, round(v7.gamma), cell.gm);
            assertEq(`${k}.v`, round(v7.vega), cell.v);
            assertEq(`${k}.t`, round(v7.theta), cell.t);
        }
    });

    // ---------- 对冲回测（daily/weekly/monthly，2024 上半年；口径修正后基线 golden-v7-scaled.json） ----------
    t.test('golden: 回测 daily/weekly/monthly 九项逐位一致（scaled 基线）', async () => {
        const btSlice = await btSlice2024H1();
        if (btSlice.length !== gs.bt_window.n) throw new Error(`切片 ${btSlice.length} 条 ≠ golden ${gs.bt_window.n}`);
        const tab = await buildGreeksTable(P, null, null);
        for (const freq of ['daily', 'weekly', 'monthly']) {
            const r = await backtestHedge(P, btSlice, tab, freq, 5);
            const exp = gs.backtest[freq];
            assertEq(`${freq}.s0`, round(r.s0, 4), exp.s0);
            assertEq(`${freq}.totalReturn`, round(r.totalReturn, 8), exp.totalReturn);
            assertEq(`${freq}.realizedVol`, round(r.realizedVol, 8), exp.realizedVol);
            assertEq(`${freq}.cumPnL`, round(r.cumPnL, 4), exp.cumPnL);
            assertEq(`${freq}.gammaPnL`, round(r.gammaPnL, 4), exp.gammaPnL);
            assertEq(`${freq}.thetaPnL`, round(r.thetaPnL, 4), exp.thetaPnL);
            assertEq(`${freq}.totalCost`, round(r.totalCost, 4), exp.totalCost);
            assertEq(`${freq}.residual`, round(r.residual, 4), exp.residual);
            const last = r.path[r.path.length - 1];
            assertEq(`${freq}.pathLast.date`, last.date, exp.pathLast.date);
            assertEq(`${freq}.pathLast.delta`, round(last.delta, 8), exp.pathLast.delta);
            assertEq(`${freq}.pathLast.cumPnL`, round(last.cumPnL, 4), exp.pathLast.cumPnL);
        }
    });

    // ---------- 账本回测（v7.1.0：负债腿盯市，golden-v7-book.json） ----------
    t.test('golden: 查表 PV 552 格 + 账本回测三频率逐位一致（book 基线）', async () => {
        const btSlice = await btSlice2024H1();
        const tab = await buildGreeksTable(P, null, null);
        tab.priceGrid.map(x => round(x, 6)).forEach((x, i) => assertEq(`table_p.priceGrid[${i}]`, x, gb.table_p.priceGrid[i]));
        assertEq('table_p.tenorGrid', JSON.stringify(tab.tenorGrid), JSON.stringify(gb.table_p.tenorGrid));
        const pKeys = Object.keys(gb.table_p.cells);
        if (pKeys.length !== 552) throw new Error(`golden table_p 格数 ${pKeys.length} ≠ 552`);
        for (const k of pKeys) {
            const v7 = tab.data[k];
            if (!v7) throw new Error(`查表缺格 ${k}`);
            assertEq(`table_p[${k}]`, round(v7.p, 10), gb.table_p.cells[k]);
        }
        for (const freq of ['daily', 'weekly', 'monthly']) {
            const r = await backtestHedge(P, btSlice, tab, freq, 5);
            const exp = gb.backtest[freq];
            assertEq(`${freq}.bookPnL`, round(r.bookPnL, 4), exp.bookPnL);
            assertEq(`${freq}.hedgePnL`, round(r.hedgePnL, 4), exp.hedgePnL);
            assertEq(`${freq}.liabPnL`, round(r.liabPnL, 4), exp.liabPnL);
            assertEq(`${freq}.bookGammaPnL`, round(r.bookGammaPnL, 4), exp.bookGammaPnL);
            assertEq(`${freq}.bookThetaPnL`, round(r.bookThetaPnL, 4), exp.bookThetaPnL);
            assertEq(`${freq}.bookResidual`, round(r.bookResidual, 4), exp.bookResidual);
            assertEq(`${freq}.恒等式`, round(r.bookGammaPnL + r.bookThetaPnL - r.totalCost + r.bookResidual, 4), round(r.bookPnL, 4));
            const last = r.path[r.path.length - 1];
            assertEq(`${freq}.pathLast.bookCumPnL`, round(last.bookCumPnL, 4), exp.bookPnL);
        }
    });

    // ---------- 压力测试（CRN） ----------
    t.test('golden: 压测 base_pv + vol 7 档 + spot 7 档 + matrix 25 格逐位一致', async () => {
        const normals = generateNormals(P.nPaths, P.nSteps);
        assertEq('base_pv', round(priceWithNormals(P, normals)), g.stress.base_pv);
        const pack = rs => rs.map(r => ({
            label: r.scenario.label,
            pv: round(r.pv ?? NaN), delta_pv: round(r.delta_pv ?? NaN),
            delta: r.greeks ? round(r.greeks.delta) : null, vega: r.greeks ? round(r.greeks.vega) : null,
        }));
        const cases = [
            ['vol', pack(runStressTest(P, buildVolScenarios(P), normals)), g.stress.vol],
            ['spot', pack(runStressTest(P, buildSpotScenarios(P), normals)), g.stress.spot],
            ['matrix', pack(runStressTest(P, buildMatrixScenarios(P), normals)), g.stress.matrix],
        ];
        for (const [name, v7, exp] of cases) {
            if (v7.length !== exp.length) throw new Error(`${name} 数量 ${v7.length} ≠ ${exp.length}`);
            v7.forEach((r, i) => {
                assertEq(`${name}[${i}].label`, r.label, exp[i].label);
                assertEq(`${name}[${i}].pv`, r.pv, exp[i].pv);
                assertEq(`${name}[${i}].delta_pv`, r.delta_pv, exp[i].delta_pv);
                assertEq(`${name}[${i}].delta`, r.delta, exp[i].delta);
                assertEq(`${name}[${i}].vega`, r.vega, exp[i].vega);
            });
        }
    });

    // ---------- 危机情景（引导数据窗口内仅 2024 可实算，与 golden 同窗） ----------
    t.test('golden: 2024 量化危机 crisisVol + delta_pv 逐位一致', async () => {
        const normals = generateNormals(P.nPaths, P.nSteps);
        const crises = await buildCrisisScenarios(P);
        const c2024 = crises.find(c => c.label === '2024 量化风暴');
        if (!c2024) throw new Error('引导数据窗口未覆盖 2024 量化风暴区间');
        assertEq('crisisVol', round(c2024.crisisVol, 6), g.crisis[0].crisisVol);
        const dpv = runStressTest(P, [c2024], normals)[0].delta_pv;
        assertEq('delta_pv', round(dpv), g.crisis[0].delta_pv);
    });

    // ---------- jump 修正：可复现性 + 量级合理性 ----------
    t.test('fixed: jump 两次调用逐位可复现、概率在 [0,1]', () => {
        const Pj = { ...P, useLocalVol: false, useBB: false, useJump: true };
        const a = priceSnowball(Pj), b = priceSnowball(Pj);
        assertEq('jump price 复现', round(a.price), round(b.price));
        assertEq('jump kiProb 复现', round(a.kiProb, 8), round(b.kiProb, 8));
        if (!(a.koProb >= 0 && a.koProb <= 1 && a.kiProb >= 0 && a.kiProb <= 1)) throw new Error('jump 概率越界');
    });
}
