// 反推票息单测：分段模式同步缩放 + 单调性
import url from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const { findCouponForPrice, priceWithNormals } = await import(url.pathToFileURL(path.join(root, 'src/core/pricing.js')).href);
const { generateNormals } = await import(url.pathToFileURL(path.join(root, 'src/core/sobol.js')).href);

function tieredP() {
    const P = {
        s0: 100, koPct: 1.0, kiPct: 0.75, strikeRef: 100,
        couponRate: 0.10, couponDiv: 0.05, couponTiered: true,
        couponEarly: 0.10, couponLate: 0.20, couponSwitchMonth: 12,
        tenorMonths: 12, lockoutMonths: 3,
        vol: 0.2, rf: 0.02, div: 0.01,
        notional: 1000, nPaths: 256,
        useLocalVol: false, useJump: false, useBB: false,
        jumpLambda: 0.5, jumpMean: 0, jumpStd: 0.08,
        koMode: 'fixed', koStartPct: 1.0, koStepPct: 0.005,
    };
    P.tenorYears = P.tenorMonths / 12;
    P.nSteps = Math.max(Math.round(P.tenorYears * 252), 1);
    return P;
}

export default async function run(t) {
    t.test('coupon: 分段模式反推后按同比例缩放可逐位复现 verifyPrice', () => {
        const P = tieredP();
        const target = 1.02;
        const cs = findCouponForPrice(target, P);
        // 依据 findCouponForPrice 的缩放规则复建参数（earlyScale=1, lateScale=2, divScale=0.5）
        const P2 = { ...P, couponRate: cs.coupon, couponEarly: cs.coupon, couponLate: cs.coupon * 2, couponDiv: cs.coupon * 0.5 };
        const normals = generateNormals(P.nPaths, P.nSteps);
        const v = priceWithNormals(P2, normals);
        if (v !== cs.verifyPrice) throw new Error(`复建复算 ${v} ≠ verifyPrice ${cs.verifyPrice}`);
        if (cs.iterations < 1 || cs.iterations > 20) throw new Error('iterations=' + cs.iterations);
    });

    t.test('coupon: 票息单调性（价格随票息上升）', () => {
        const P = tieredP();
        const normals = generateNormals(P.nPaths, P.nSteps);
        const lo = priceWithNormals({ ...P, couponRate: 0.05, couponEarly: 0.05, couponLate: 0.10, couponDiv: 0.025 }, normals);
        const hi = priceWithNormals({ ...P, couponRate: 0.30, couponEarly: 0.30, couponLate: 0.60, couponDiv: 0.15 }, normals);
        if (!(hi > lo)) throw new Error(`高票息 PV ${hi} 应高于低票息 PV ${lo}`);
    });
}
