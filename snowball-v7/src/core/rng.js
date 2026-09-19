// rng.js - 计数器式确定性 PRNG（splitmix 混淆，32 位对实现、输出 53 位均匀数）
// 取值仅由 seed 常量 ^ 计数器决定，与任何模型参数无关 → CRN 严格成立。
// 用途：Merton 跳跃（泊松计数 + 跳跃幅度）与 Brownian Bridge 桥噪声（v7 修正引入）。
// 计数器约定：
//   BB 桥噪声      rngNormal(pathIdx * nSteps + (j - 1))
//   跳跃           cell = (pathIdx * nSteps + j) * 32；计数用槽 0..15，第 m 跳幅度用槽 16+m

import { normPpf } from './sobol.js';

const SEED_A = 0x9e3779b9 | 0;
const SEED_B = 0x85ebca6b | 0;

function mix32(x) {
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return (x ^ (x >>> 15)) >>> 0;
}

// [0,1) 均匀数：两条独立混淆 lane 拼 53 位
export function rngU01(counter) {
    const hi = mix32((SEED_A ^ (counter | 0)) | 0);
    const lo = mix32((SEED_B ^ ((counter + 0x9e37) | 0)) | 0);
    return (hi * 4294967296 + lo) / 18446744073709551616;
}

// 标准正态：Acklam ppf（与 Sobol 链同源），1e-10 截断
export function rngNormal(counter) {
    const u = Math.max(1e-10, Math.min(1 - 1e-10, rngU01(counter)));
    return normPpf(u);
}

// 泊松计数（确定性流，单步最多 16 次抽样——λ·dt 量级下 P(≥16) 可忽略）
export function poissonCounter(lambdaStep, cell) {
    const L = Math.exp(-lambdaStep);
    let k = 0, p = 1, draws = 0;
    do { k++; p *= rngU01(cell * 32 + draws); draws++; } while (p > L && draws < 16);
    return k - 1;
}
