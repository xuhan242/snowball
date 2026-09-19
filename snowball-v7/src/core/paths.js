// paths.js - 路径模拟：GBM / CEV / Brownian Bridge / Merton 跳跃
// simulatePaths（GBM/CEV）逐字移植 v5；BB 与 jump 含 v7 两处算法修正。

import { rngNormal, poissonCounter } from './rng.js';

// ====== GBM 路径模拟（支持常数波动率 + CEV 局部波动率） ======
// GBM 对数价格路径：ln(S_t) = ln(S_0) + Σ[(r - q - σ²/2)dt + σ√dt·Z_t]
// CEV 局部波动率模式：σ_i = σ_ATM × (S₀/S_i)，价格越低波动越高，模拟波动率偏斜
export function simulatePaths(P, normals) {
    const { nPaths, nSteps, s0, vol, rf, div, tenorYears, useLocalVol } = P;
    const dt = tenorYears / nSteps;
    const prices = new Float64Array(nPaths * (nSteps + 1));

    if (!useLocalVol) {
        // 常数波动率 GBM
        const drift = (rf - div - 0.5 * vol * vol) * dt;
        const diff = vol * Math.sqrt(dt);
        for (let i = 0; i < nPaths; i++) {
            prices[i * (nSteps + 1)] = s0;
            let lr = 0;
            for (let j = 0; j < nSteps; j++) {
                lr += drift + diff * normals[i * nSteps + j];
                prices[i * (nSteps + 1) + j + 1] = s0 * Math.exp(lr);
            }
        }
    } else {
        // CEV 局部波动率：σ(S) = σ_ATM × (S₀/S)
        for (let i = 0; i < nPaths; i++) {
            prices[i * (nSteps + 1)] = s0;
            let lr = 0, prev = s0;
            for (let j = 0; j < nSteps; j++) {
                const lv = Math.min(vol * s0 / Math.max(prev, 1e-4 * s0), 5 * vol);
                const drift = (rf - div - 0.5 * lv * lv) * dt;
                lr += drift + lv * Math.sqrt(dt) * normals[i * nSteps + j];
                prev = s0 * Math.exp(lr);
                prices[i * (nSteps + 1) + j + 1] = prev;
            }
        }
    }
    return prices;
}

// ====== 常数波动率 GBM 的 Brownian Bridge 方差缩减版本 ======
// 先模拟终点 S_T，再用 Brownian Bridge 条件插值中间点
// 方差缩减来源：终点只用 1 组随机数，中间点为条件期望 + 独立桥噪声
// v7 修正：桥噪声来自 rng.js 独立确定性流（v5 复用生成终点的正态数，与 W_T 相关）；
// 方差核 t(1-t)·nSteps 不变。
export function simulatePathsBB(P, normals) {
    const { nPaths, nSteps, s0, vol, rf, div, tenorYears } = P;
    const dt = tenorYears / nSteps;
    const drift = (rf - div - 0.5 * vol * vol) * dt;
    const sqrtDt = Math.sqrt(dt);
    const prices = new Float64Array(nPaths * (nSteps + 1));

    for (let i = 0; i < nPaths; i++) {
        prices[i * (nSteps + 1)] = s0;
        // 第一步：累积到 T 的对数收益率（终点）
        const baseIdx = i * nSteps;
        let logST = 0;
        for (let j = 0; j < nSteps; j++) {
            logST += drift + vol * sqrtDt * normals[baseIdx + j];
        }
        const ST = s0 * Math.exp(logST);

        // 第二步：Brownian Bridge 填充中间点
        // W_t = (t/T) * W_T + sqrt(t*(T-t)/T) * Z，Z 为独立桥噪声
        let wT = logST - nSteps * drift;  // 累积布朗运动增量
        for (let j = 1; j < nSteps; j++) {
            const t = j / nSteps;
            const z = rngNormal(i * nSteps + (j - 1));
            const wt = t * wT + Math.sqrt(t * (1 - t) * nSteps) * vol * sqrtDt * z;
            const lr = j * drift + wt;
            prices[i * (nSteps + 1) + j] = s0 * Math.exp(lr);
        }
        prices[i * (nSteps + 1) + nSteps] = ST;
    }
    return prices;
}

// ====== Merton 跳跃扩散模型 ======
// dS/S = (r - q - λκ)dt + σdW + (J-1)dN
// κ = E[J-1] = exp(μ_J + σ_J²/2) - 1
// ln(J) ~ N(μ_J, σ_J²)
// v7 修正：泊松计数与每跳幅度均来自 rng.js 独立确定性流（v5 用 Math.random、
// 复用当步扩散正态数且按 (k+1) 缩放），每跳独立 μJ + σJ·z_k。
export function simulatePathsJump(P, normals) {
    const { nPaths, nSteps, s0, vol, rf, div, tenorYears, jumpLambda, jumpMean, jumpStd } = P;
    const dt = tenorYears / nSteps;
    const kappa = Math.exp(jumpMean + 0.5 * jumpStd * jumpStd) - 1;
    const drift = (rf - div - jumpLambda * kappa - 0.5 * vol * vol) * dt;
    const diff = vol * Math.sqrt(dt);
    const prices = new Float64Array(nPaths * (nSteps + 1));

    for (let i = 0; i < nPaths; i++) {
        prices[i * (nSteps + 1)] = s0;
        let lr = 0;
        const baseIdx = i * nSteps;
        for (let j = 0; j < nSteps; j++) {
            lr += drift + diff * normals[baseIdx + j];
            const nJumps = poissonCounter(jumpLambda * dt, i * nSteps + j);
            for (let k = 0; k < nJumps; k++) {
                const zJ = rngNormal((i * nSteps + j) * 32 + 16 + k);
                lr += jumpMean + jumpStd * zJ;
            }
            prices[i * (nSteps + 1) + j + 1] = s0 * Math.exp(lr);
        }
    }
    return prices;
}

// 模型调度：jump > BB > 普通（BB 与 CEV 互斥）
export function simulatePathsDispatch(P, normals) {
    if (P.useJump) return simulatePathsJump(P, normals);
    if (P.useBB && !P.useLocalVol) return simulatePathsBB(P, normals);
    return simulatePaths(P, normals);
}
