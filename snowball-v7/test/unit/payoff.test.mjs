// payoff 单测：四分类手算样例（KO/存续/敲入亏损/敲入赎回）+ 分段票息 + 递减敲出 + 单路径一致性
import url from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const { evaluatePaths, payoffSinglePath } = await import(url.pathToFileURL(path.join(root, 'src/core/payoff.js')).href);

// 12 月期限、12 步（spm=1）、lockout 3 → 观察步 4..12；rf=0、贴现=1
// 价格为绝对价（s0=ref=100，敲出障碍 100、敲入障碍 75）
function baseP(extra = {}) {
    return {
        nPaths: 3, nSteps: 12, s0: 100,
        koPct: 1.0, kiPct: 0.75, strikeRef: 100,
        couponRate: 0.12, couponDiv: 0.05, couponTiered: false,
        couponEarly: 0, couponLate: 0, couponSwitchMonth: 6,
        tenorMonths: 12, lockoutMonths: 3,
        rf: 0, koMode: 'fixed', koStartPct: 1.0, koStepPct: 0.02,
        ...extra
    };
}

const PATHS = [
    // KO @ step6（101 ≥ 100）：pv = 1 + 0.12×(6/12) = 1.06
    [100, 99, 98, 97, 98, 99, 101, 100, 99, 98, 97, 96, 95],
    // 存续（未 KI 未 KO）：pv = 1 + 0.05 = 1.05
    [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88],
    // KI@step3（70 ≤ 75）+ 到期亏损 30%：pv = 0.70
    [100, 90, 80, 70, 75, 80, 85, 90, 85, 80, 75, 72, 70],
];

export default async function run(t) {
    t.test('payoff: 三分类金额与概率（手算逐位）', () => {
        const prices = new Float64Array(PATHS.flat());
        const r = evaluatePaths(prices, baseP());
        const eps = 1e-12;
        if (Math.abs(r.pvs[0] - 1.06) > eps) throw new Error('KO pv=' + r.pvs[0]);
        if (Math.abs(r.pvs[1] - 1.05) > eps) throw new Error('存续 pv=' + r.pvs[1]);
        if (Math.abs(r.pvs[2] - 0.70) > eps) throw new Error('KI亏损 pv=' + r.pvs[2]);
        if (Math.abs(r.koProb - 1 / 3) > eps) throw new Error('koProb=' + r.koProb);
        if (Math.abs(r.kiProb - 1 / 3) > eps) throw new Error('kiProb=' + r.kiProb);
        if (Math.abs(r.kiLossProb - 1 / 3) > eps) throw new Error('kiLossProb=' + r.kiLossProb);
        if (Math.abs(r.surviveProb - 1 / 3) > eps) throw new Error('surviveProb=' + r.surviveProb);
        if (r.koTimes[0] !== 6) throw new Error('koTimes[0]=' + r.koTimes[0]);
        if (r.kiTimes[2] !== 3) throw new Error('kiTimes 记录错误');
        if (Math.abs(r.price - 2.81 / 3) > eps) throw new Error('price=' + r.price);
    });

    t.test('payoff: 敲入但到期 ≥ 期初 → 赎回本金（koBar>ref 时可达）', () => {
        // 敲出障碍 105：终点 102 ≥ 期初 100 且 < 105 → 赎回 pv = disc = 1
        const P = baseP({ koPct: 1.05, nPaths: 1 });
        const path = [100, 90, 80, 74, 80, 85, 90, 95, 90, 85, 80, 78, 102];
        const r = evaluatePaths(Float64Array.from(path), P);
        if (r.pvs[0] !== 1) throw new Error('赎回 pv=' + r.pvs[0]);
        if (r.kiProb !== 1 || r.koProb !== 0 || r.kiLossProb !== 0) throw new Error('分类计数错误');
    });

    t.test('payoff: 分段票息按切换月选 early/late（obsIdx 口径）', () => {
        const P = baseP({ couponTiered: true, couponEarly: 0.10, couponLate: 0.20, couponSwitchMonth: 4, couponDiv: 0, couponRate: 0.10 });
        // 路径 A：KO @ step7（101 ≥ 100）→ obsIdx = 7-3 = 4 ≥ 4 → late：pv = 1+0.20×(7/12)
        // 路径 B：KO @ step6 → obsIdx = 3 < 4 → early：pv = 1+0.10×(6/12)
        const A = [100, 99, 98, 97, 98, 99, 99.5, 101, 101, 101, 101, 101, 101];
        const B = [100, 99, 98, 97, 98, 99, 101, 101, 101, 101, 101, 101, 101];
        const prices = new Float64Array([...A, ...B]);
        const r = evaluatePaths(prices, { ...P, nPaths: 2 });
        const expA = 1 + 0.20 * (7 / 12);
        const expB = 1 + 0.10 * (6 / 12);
        if (r.pvs[0] !== expA) throw new Error('late pv=' + r.pvs[0] + ' exp=' + expA);
        if (r.pvs[1] !== expB) throw new Error('early pv=' + r.pvs[1] + ' exp=' + expB);
    });

    t.test('payoff: 递减敲出走 koStartPct - (mm-lockout-1)×koStepPct', () => {
        const P = baseP({ koMode: 'descending', koStartPct: 1.0, koStepPct: 0.02 });
        // 观察步4 障碍=100、步5 障碍=98；路径 @4=99.5 未触、@5=98.5 触发 → pv=1+0.12×(5/12)
        const path = [100, 99, 98, 97, 99.5, 98.5, 98, 97, 96, 95, 94, 93, 92];
        const prices = new Float64Array(path);
        const r = evaluatePaths(prices, { ...P, nPaths: 1 });
        const exp = 1 + 0.12 * (5 / 12);
        if (r.pvs[0] !== exp) throw new Error('递减 KO pv=' + r.pvs[0] + ' exp=' + exp);
        if (r.koTimes[0] !== 5) throw new Error('koTimes=' + r.koTimes[0]);
    });

    t.test('payoff: payoffSinglePath 与 evaluatePaths 单路径一致', () => {
        const P = baseP();
        const one = Float64Array.from(PATHS[0]);
        const v = payoffSinglePath(one, 12, P);
        const prices = new Float64Array(PATHS.flat());
        const r = evaluatePaths(prices, P);
        if (v !== r.pvs[0]) throw new Error(`single=${v} vs batch=${r.pvs[0]}`);
    });
}
