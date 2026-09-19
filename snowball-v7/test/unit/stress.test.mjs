// 压测单测：情景构建（标签/数量/参数派生/钳位）+ 危机切片注入
import url from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const { buildVolScenarios, buildSpotScenarios, buildMatrixScenarios, buildCrisisScenarios } = await import(url.pathToFileURL(path.join(root, 'src/core/stress.js')).href);

function smallP() {
    return {
        s0: 100, vol: 0.18, kiPct: 0.75, koPct: 1.0, koMode: 'fixed', koStartPct: 1.0,
        notional: 1000, nPaths: 64, nSteps: 12, tenorMonths: 12, tenorYears: 1, rf: 0.02, div: 0.01,
        couponRate: 0.18, couponDiv: 0.18, couponTiered: false, couponEarly: 0, couponLate: 0, couponSwitchMonth: 12,
        lockoutMonths: 3, useLocalVol: true, useJump: false, useBB: true, jumpLambda: 0.5, jumpMean: 0, jumpStd: 0.08,
    };
}

export default async function run(t) {
    t.test('stress: vol 7 档标签/顺序/下限钳位', () => {
        const P = smallP();
        const sc = buildVolScenarios(P);
        if (sc.length !== 7) throw new Error('数量=' + sc.length);
        const labels = sc.map(s => s.label);
        const exp = ['-20pp', '-10pp', '-5pp', '基准', '+5pp', '+10pp', '+20pp'];
        if (JSON.stringify(labels) !== JSON.stringify(exp)) throw new Error('标签=' + labels.join(','));
        if (sc[0].P_prime.vol !== 0.01) throw new Error('下限钳位失败：' + sc[0].P_prime.vol);
        if (sc[3].P_prime.vol !== P.vol) throw new Error('基准档不应改 vol');
    });

    t.test('stress: spot 7 档标签/顺序/s0 派生', () => {
        const P = smallP();
        const sc = buildSpotScenarios(P);
        const labels = sc.map(s => s.label).join(',');
        if (labels !== '-20%,-10%,-5%,基准,+5%,+10%,+20%') throw new Error(labels);
        if (sc[0].P_prime.s0 !== 80) throw new Error('s0 派生=' + sc[0].P_prime.s0);
        if (sc[6].P_prime.s0 !== 120) throw new Error('s0 派生=' + sc[6].P_prime.s0);
    });

    t.test('stress: matrix 25 格双层循环顺序（vol 外层 spot 内层）', () => {
        const P = smallP();
        const sc = buildMatrixScenarios(P);
        if (sc.length !== 25) throw new Error('数量=' + sc.length);
        if (sc[0].label !== 'vol-10pp × spot-10%') throw new Error(sc[0].label);
        if (sc[24].label !== 'vol+10pp × spot+10%') throw new Error(sc[24].label);
        if (sc[12].volShock !== 0 || sc[12].spotJump !== 0) throw new Error('第13格应为基准');
        if (sc[12].P_prime.s0 !== P.s0 || sc[12].P_prime.vol !== P.vol) throw new Error('基准格参数被改动');
    });

    t.test('stress: 危机切片注入——窗口不足跳过、可实算区间 crisisVol 正确', async () => {
        const P = smallP();
        // 注入：仅 2024 区间有数据（12 个点，每日 +1%）
        const sliceFn = async (code, start, end) => {
            if (code !== '000852.SH') return [];
            return Array.from({ length: 12 }, (_, i) => ['20240' + String(101 + i).padStart(2, '0'), 100 * Math.pow(1.01, i)]);
        };
        const rs = await buildCrisisScenarios(P, sliceFn);
        if (rs.length !== 1 || rs[0].label !== '2024 量化风暴') throw new Error('应只有 2024 一档：' + rs.map(r => r.label).join(','));
        const exp = Math.sqrt(Math.log(1.01) ** 2 * 252);
        if (Math.abs(rs[0].crisisVol - exp) > 1e-12) throw new Error('crisisVol=' + rs[0].crisisVol);
        // 全空数据 → 三档全跳过
        const rs0 = await buildCrisisScenarios(P, async () => []);
        if (rs0.length !== 0) throw new Error('空数据应全跳过');
    });
}
