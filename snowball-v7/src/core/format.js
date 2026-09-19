// format.js - 展示层格式化与 Greeks 业务口径换算（零 DOM 依赖）

// 理论价值类：4 位小数
export function fmtVal(v) {
    return Number.isFinite(v) ? v.toFixed(4) : '—';
}

// 概率/比例：1 位百分数
export function fmtPct(v) {
    return (v * 100).toFixed(1) + '%';
}

// 金额智能格式化：亿 / 万 / 元（整数）
export function fmtMoney(v) {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(1) + '万';
    return Math.round(v).toString();
}

// Greeks → 1% 标准化金额（元）。口径与 v5 卡片层一致：
//   Delta/Gamma = g × 0.01 × S × N；Vega/Rho/RhoQ = g × N；Theta = g / 12 × N；N = notional × 1e4
export function greeksToMoney(g, s0, notional) {
    const N = notional * 1e4;
    const S = s0;
    return {
        delta: g.delta * 0.01 * S * N,
        gamma: g.gamma * 0.01 * S * N,
        vega: g.vega * N,
        theta: g.theta / 12 * N,
        rho: g.rho * N,
        rhoQ: g.rhoQ * N,
        vegaKI: (g.vegaKI || 0) * N,
        vegaKO: (g.vegaKO || 0) * N
    };
}

// 正负着色类名：正绿 / 负红 / 零灰
export function signCls(v) {
    return v > 0 ? 'pos' : (v < 0 ? 'neg' : 'neu');
}
