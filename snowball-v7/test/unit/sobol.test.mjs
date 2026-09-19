// sobol 单测：Acklam ppf 精度与对称性、Node 环境缓存守卫降级
import url from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const { normPpf, getCachedNormals, SOBOL_DIMS } = await import(url.pathToFileURL(path.join(root, 'src/core/sobol.js')).href);

export default async function run(t) {
    t.test('sobol: SOBOL_DIMS = 756', () => {
        if (SOBOL_DIMS !== 756) throw new Error('SOBOL_DIMS=' + SOBOL_DIMS);
    });

    t.test('sobol: normPpf 分位点精度（0.975 → 1.959963984…）', () => {
        const v = normPpf(0.975);
        if (Math.abs(v - 1.959963984540054) > 1e-8) throw new Error('normPpf(0.975)=' + v);
    });

    t.test('sobol: normPpf 中段对称性（<1e-15）', () => {
        const a = normPpf(0.3), b = normPpf(0.7);
        if (!(Math.abs(a + b) < 1e-15)) throw new Error(`|normPpf(0.3)+normPpf(0.7)|=${Math.abs(a + b)}`);
    });

    t.test('sobol: normPpf 端点行为（0/1 → ∓Infinity，1e-10 截断有限）', () => {
        if (normPpf(0) !== -Infinity) throw new Error('p=0 应为 -Infinity');
        if (normPpf(1) !== Infinity) throw new Error('p=1 应为 Infinity');
        const lo = normPpf(1e-10), hi = normPpf(1 - 1e-10);
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error('截断端点应有限');
    });

    t.test('sobol: getCachedNormals 在无 localStorage 环境静默降级', () => {
        const n = getCachedNormals(8, 2);
        if (!(n instanceof Float64Array) || n.length !== 16) throw new Error('返回类型/长度错误');
    });
}
