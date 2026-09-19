// 回测/查表单测：滚动 RV、双线性插值、残差恒等式
import url from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const { rollingRealizedVol, backtestHedge } = await import(url.pathToFileURL(path.join(root, 'src/core/backtest.js')).href);
const { lookupGreeksTable } = await import(url.pathToFileURL(path.join(root, 'src/core/table.js')).href);

export default async function run(t) {
    t.test('backtest: rollingRealizedVol 常比序列 → RV=|ln(1.001)|·√252，窗口滚动点数正确', () => {
        const n = 80;
        const prices = Array.from({ length: n }, (_, i) => 100 * Math.pow(1.001, i));
        const dates = Array.from({ length: n }, (_, i) => String(20240101 + i).slice(0, 8));
        const rv0 = rollingRealizedVol(prices, dates, 20);
        if (rv0.length !== n - 20) throw new Error('点数=' + rv0.length);
        const exp = Math.log(1.001) * Math.sqrt(252);
        if (Math.abs(rv0[0].rv - exp) > 1e-9) throw new Error('rv=' + rv0[0].rv + ' exp=' + exp);
        if (!(rv0[0].rv > 0)) throw new Error('递增序列 rv 应为正');
    });

    t.test('backtest: rollingRealizedVol 数据不足窗口 → 空数组', () => {
        if (rollingRealizedVol([1, 2, 3], ['d1', 'd2', 'd3'], 20).length !== 0) throw new Error('应为空');
    });

    t.test('table: 双线性插值中点 = 四角均值；端点钳位生效', () => {
        const table = {
            priceGrid: [0.5, 1.5],
            tenorGrid: [1, 2],
            data: {
                '0_0': { delta: 1, gamma: 0, vega: 0, theta: 0 },
                '1_0': { delta: 3, gamma: 0, vega: 0, theta: 0 },
                '0_1': { delta: 5, gamma: 0, vega: 0, theta: 0 },
                '1_1': { delta: 7, gamma: 0, vega: 0, theta: 0 },
            }
        };
        const mid = lookupGreeksTable(table, 1.0, 1.5);
        if (mid.delta !== 4) throw new Error('中点 delta=' + mid.delta);
        const lo = lookupGreeksTable(table, 0.1, 1);
        if (lo.delta !== 1) throw new Error('下端钳位 delta=' + lo.delta);
        const hi = lookupGreeksTable(table, 9, 9);
        if (hi.delta !== 7) throw new Error('上端钳位 delta=' + hi.delta);
    });

    t.test('backtest: 残差恒等式 residual = cumPnL − gammaPnL − thetaPnL + totalCost', async () => {
        // 构造 40 条平坦数据的迷你回测（daily，无成本），查表全零 Delta
        const n = 40;
        const histSlice = Array.from({ length: n }, (_, i) => [String(20240100 + i), 100 + (i % 3)]);
        const table = {
            priceGrid: [0.5, 1.5], tenorGrid: [1, 24],
            data: {
                '0_0': { delta: 0, gamma: 0, vega: 0, theta: -0.001 },
                '1_0': { delta: 0, gamma: 0, vega: 0, theta: -0.001 },
                '0_1': { delta: 0, gamma: 0, vega: 0, theta: -0.001 },
                '1_1': { delta: 0, gamma: 0, vega: 0, theta: -0.001 },
            }
        };
        const P = { notional: 1000, kiPct: 0.75, koPct: 1.0, koMode: 'fixed', koStartPct: 1.0, vol: 0.18 };
        const r = await backtestHedge(P, histSlice, table, 'daily', 5);
        const lhs = r.residual;
        const rhs = r.cumPnL - r.gammaPnL - r.thetaPnL + r.totalCost;
        if (lhs !== rhs) throw new Error(`residual ${lhs} ≠ ${rhs}`);
    });
}
