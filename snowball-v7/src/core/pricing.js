// pricing.js - MC 定价与反推票息，逐字移植 v5（模拟调度、CRN、二分）

import { generateNormals } from './sobol.js';
import { simulatePathsDispatch } from './paths.js';
import { evaluatePaths } from './payoff.js';

// 完整的蒙特卡洛定价流水线：生成随机数 → 模拟路径 → 判定收益 → 取平均
export function priceSnowball(P) {
    const normals = generateNormals(P.nPaths, P.nSteps);
    const prices = simulatePathsDispatch(P, normals);
    const result = evaluatePaths(prices, P);
    result.paths = prices;
    return result;
}

// 用预生成的 normals 定价（CRN 共享随机数）
export function priceWithNormals(P, normals) {
    const prices = simulatePathsDispatch(P, normals);
    return evaluatePaths(prices, P).price;
}

// ====== 反向设计：给定目标理论价值，二分查找票息率 ======
// 票息率越高 → 雪球价值越高 → 单调，适合二分查找
// 复用同一组 Sobol normals（路径级别 CRN），保证二分单调性
// 早停阈值 1e-5，最多 20 次
// 分段票息模式下按原比例同步缩放 early/late/div，保持结构不变
export function findCouponForPrice(target, P) {
    const normals = generateNormals(P.nPaths, P.nSteps);
    // 基准票息：以 couponRate 作为缩放基准（若为分段模式，通常等于 couponEarly）
    const baseCoupon = P.couponRate || P.couponEarly || 0.1;
    // 计算各票息字段相对基准的比例
    const earlyScale = P.couponTiered ? ((P.couponEarly || baseCoupon) / baseCoupon) : 1;
    const lateScale = P.couponTiered ? ((P.couponLate || baseCoupon) / baseCoupon) : 1;
    const divScale = (P.couponDiv !== undefined ? P.couponDiv : baseCoupon) / baseCoupon;

    // 应用新票息率的辅助函数：同步缩放所有相关字段
    const applyCoupon = (pp, c) => Object.assign({}, pp, {
        couponRate: c,
        couponEarly: c * earlyScale,
        couponLate: c * lateScale,
        couponDiv: c * divScale
    });

    let lo = 0.001, hi = 0.50;
    let iter = 0;
    for (; iter < 20 && (hi - lo) > 1e-5; iter++) {
        const mid = (lo + hi) / 2;
        const r = priceWithNormals(applyCoupon(P, mid), normals);
        if (r > target) hi = mid;
        else lo = mid;
    }
    const coupon = (lo + hi) / 2;
    // 验证：使用同一组 normals，确保结果一致性
    const verify = priceWithNormals(applyCoupon(P, coupon), normals);
    return { coupon, verifyPrice: verify, iterations: iter, lo, hi };
}
