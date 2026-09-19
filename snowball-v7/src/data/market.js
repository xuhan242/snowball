// market.js - 由 tools/fetch_data.py 生成于 2026-09-18，重跑脚本刷新。
// 快照日期：20260917（行情/股息率）、20260917（国债曲线）
// 口径：price=收盘价；div=aindexvaluation.DIVIDEND_YIELD/100；vol=近252交易日对数收益年化RV（自算）；
//       rf=中债国债收益率曲线（cbondcurvecnbd），表单按合约期限自动匹配，另提供「固定口径 2%」一键回填。
export const MARKET = {
    '000300.SH': { name: '沪深300', price: 4460.1557, vol: 0.1796, div: 0.0274 },
    '000905.SH': { name: '中证500', price: 7654.9785, vol: 0.2630, div: 0.0134 },
    '000852.SH': { name: '中证1000', price: 7548.8223, vol: 0.2602, div: 0.0109 },
    '000016.SH': { name: '上证50', price: 2844.2330, vol: 0.1541, div: 0.0341 },
    '399006.SZ': { name: '创业板指', price: 3298.3101, vol: 0.3512, div: 0.0099 },
    '000688.SH': { name: '科创50', price: 1606.2869, vol: 0.4209, div: 0.0023 },
};

export const MARKET_SNAPSHOT_DATE = '20260917';

// RF_CURVE - 中债国债收益率曲线关键期限点（到期收益率，小数）
export const RF_CURVE = {
    date: '20260917',
    source: '中债国债收益率曲线',
    provider: 'Wind 转载库 cbondcurvecnbd',
    provisional: [],
    points: [
        [0.25, 0.011802],
        [0.5, 0.011974],
        [1, 0.012303],
        [2, 0.01255],
        [3, 0.012579],
        [5, 0.014106],
        [7, 0.015214],
        [10, 0.017108]
    ]
};

// 按期限（月）线性插值，端点钳位
export function rfFromCurve(tenorMonths) {
    const t = tenorMonths / 12;
    const pts = RF_CURVE.points;
    if (t <= pts[0][0]) return pts[0][1];
    const last = pts.length - 1;
    if (t >= pts[last][0]) return pts[last][1];
    for (let i = 1; i < pts.length; i++) {
        if (t <= pts[i][0]) {
            const x0 = pts[i - 1][0], y0 = pts[i - 1][1];
            const x1 = pts[i][0], y1 = pts[i][1];
            return y0 + (y1 - y0) * (t - x0) / (x1 - x0);
        }
    }
    return pts[last][1];
}

// 预设模板（6 指数标准结构），vol/div/coupon 为百分数形式，与表单输入口径一致。
// v7 约定：预设不含 rf，rf 由 curve 模式按期限自动填充。
export const PRESETS = [
    { code: '000905.SH', name: '中证500标准', s0: 7654.9785, ki: 75, ko: 100, koMode: 'fixed', koStart: 100, koStep: 0.5, vol: 26.3, div: 1.34, tenor: 24, lockout: 3, couponMode: 'fixed', coupon: 18, couponEarly: 0, couponLate: 0, couponDiv: 0, couponSwitchMonth: 12, npaths: 8192, volModel: 'cev', margin: 100, notional: 1000, jumpLambda: 0.5, jumpMean: 0, jumpStd: 0.08, useBB: true },
    { code: '000300.SH', name: '沪深300增强', s0: 4460.1557, ki: 80, ko: 100, koMode: 'fixed', koStart: 100, koStep: 0.5, vol: 17.96, div: 2.74, tenor: 24, lockout: 3, couponMode: 'fixed', coupon: 15, couponEarly: 0, couponLate: 0, couponDiv: 0, couponSwitchMonth: 12, npaths: 8192, volModel: 'cev', margin: 100, notional: 1000, jumpLambda: 0.5, jumpMean: 0, jumpStd: 0.08, useBB: true },
    { code: '000852.SH', name: '中证1000进取', s0: 7548.8223, ki: 70, ko: 100, koMode: 'fixed', koStart: 100, koStep: 0.5, vol: 26.02, div: 1.09, tenor: 24, lockout: 3, couponMode: 'fixed', coupon: 22, couponEarly: 0, couponLate: 0, couponDiv: 0, couponSwitchMonth: 12, npaths: 8192, volModel: 'cev', margin: 100, notional: 1000, jumpLambda: 0.5, jumpMean: 0, jumpStd: 0.08, useBB: true },
    { code: '000016.SH', name: '上证50稳健', s0: 2844.2330, ki: 85, ko: 100, koMode: 'fixed', koStart: 100, koStep: 0.5, vol: 15.41, div: 3.41, tenor: 24, lockout: 3, couponMode: 'fixed', coupon: 12, couponEarly: 0, couponLate: 0, couponDiv: 0, couponSwitchMonth: 12, npaths: 8192, volModel: 'cev', margin: 100, notional: 1000, jumpLambda: 0.5, jumpMean: 0, jumpStd: 0.08, useBB: true },
    { code: '399006.SZ', name: '创业板指高波', s0: 3298.3101, ki: 75, ko: 100, koMode: 'fixed', koStart: 100, koStep: 0.5, vol: 35.12, div: 0.99, tenor: 24, lockout: 3, couponMode: 'fixed', coupon: 28, couponEarly: 0, couponLate: 0, couponDiv: 0, couponSwitchMonth: 12, npaths: 8192, volModel: 'cev', margin: 100, notional: 1000, jumpLambda: 0.5, jumpMean: 0, jumpStd: 0.08, useBB: true },
    { code: '000688.SH', name: '科创50极值', s0: 1606.2869, ki: 70, ko: 100, koMode: 'fixed', koStart: 100, koStep: 0.5, vol: 42.09, div: 0.23, tenor: 24, lockout: 3, couponMode: 'fixed', coupon: 32, couponEarly: 0, couponLate: 0, couponDiv: 0, couponSwitchMonth: 12, npaths: 8192, volModel: 'cev', margin: 100, notional: 1000, jumpLambda: 0.5, jumpMean: 0, jumpStd: 0.08, useBB: true },
];
