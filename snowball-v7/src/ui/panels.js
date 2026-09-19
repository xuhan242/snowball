// panels.js - 三 Tab 面板装配：运行调度 + 渲染编排
import { generateNormals } from '../core/sobol.js';
import { priceWithNormals, findCouponForPrice } from '../core/pricing.js';
import { computeGreeks, buildGreeksSurface, computeVegaBuckets } from '../core/greeks.js';
import { buildGreeksTable } from '../core/table.js';
import { backtestHedge } from '../core/backtest.js';
import { buildVolScenarios, buildSpotScenarios, buildMatrixScenarios, buildCrisisScenarios, runStressTest } from '../core/stress.js';
import { rngU01 } from '../core/rng.js';
import { fmtMoney, fmtVal } from '../core/format.js';
import { sliceHist, getDateRange, fmtDate, parseDate } from '../data/hist.js';
import { HIST_WINDOW } from '../data/hist-data.js';
import { MARKET_SNAPSHOT_DATE } from '../data/market.js';
import { getPool } from '../workers/pool.js';
import { initWorkers } from '../workers/workerLoader.js';
import { drawVolCurve, drawGreeksHeatmap, drawForwardGreeks, drawKOEvolution, drawPathHistogram, drawCouponAccrual, drawKODistribution, drawPathDensityHeatmap } from '../charts/pricing-charts.js';
import { drawBtPnl, drawBtPath, drawBtDecomp, drawIVvsRV, drawCostSensitivity } from '../charts/backtest-charts.js';
import { drawStressMatrix } from '../charts/stress-charts.js';
import { buildGreeksCards, showSkeleton, showComputationError, showHintCard } from './cards.js';
import { buildParams, validate, formState } from './form.js';
import { showToast, showLoading, hideLoading, setExecMode, nextFrame } from './feedback.js';

const $ = id => document.getElementById(id);
const DATA_FOOT = `Wind 转载库 · 快照 ${MARKET_SNAPSHOT_DATE} · 历史 ${fmtDate(HIST_WINDOW.end)} 止${HIST_WINDOW.start < '20180000' ? '（2018 窗口 + 危机补段）' : ''}`;

// ====== 全局状态 ======
let lastP = null, lastMC = null, lastGreeks = null;
let surfaceData = null, surfaceKey = '';
let btInitialized = false, btLastResult = null, btTableCache = null, btTableCacheKey = '';
let lastStress = null; // { P, volResults, spotResults, crisisResults, matrixResults }
let stressRunning = false;

function dataFoot() {
    return DATA_FOOT;
}

// ====== 定价主流程（Pool 并行，失败降级主线程） ======
async function runPricing(P) {
    initWorkers();
    const pool = getPool();
    const normals = generateNormals(P.nPaths, P.nSteps);
    const t0 = performance.now();
    const mc = await pool.runPricing(P, normals, true);
    const g6 = await pool.runGreeks(P, normals);
    const buckets = computeVegaBuckets(P, normals);
    setExecMode(pool.lastMode === 'workers' ? `${pool.size} worker 并行` : '主线程降级');
    const greeks = { ...g6, vegaKI: buckets.vegaKI, vegaKO: buckets.vegaKO };
    return { mc, greeks, dt: performance.now() - t0 };
}

// ====== 表单提交（估值定价 / 反推票息） ======
function onSubmit(e) {
    e.preventDefault();
    const P = buildParams();
        const errs = validate(P);
        const errEl = $('err');
        if (errs.length > 0) {
            errEl.innerHTML = errs.join('<br>');
            errEl.className = 'err show';
            const errMsg = errs.join('；');
            showToast(errMsg);
            showHintCard($('result-pricing'), '参数校验失败', errs.map(x => x.replace(/</g, '&lt;')).join('<br>'));
            return;
        }
        errEl.className = 'err';
        $('submitBtn').disabled = true;

        if (formState.mode === 'reverse') {
            const target = parseFloat($('targetPrice').value);
            showLoading('反推票息中…', '二分查找 + MC 定价');
            (async () => {
                await nextFrame();
                try {
                    const t0 = performance.now();
                    const result = findCouponForPrice(target, P);
                    const dt = performance.now() - t0;
                    hideLoading();
                    $('submitBtn').disabled = false;
                    renderReverseResult(result, P, dt / 1000, target);
                } catch (err) {
                    hideLoading();
                    $('submitBtn').disabled = false;
                    showComputationError($('result-pricing'), err, () => $('submitBtn').click());
                }
            })();
        } else {
            showLoading('正在计算…', '蒙特卡洛模拟 + Greeks 求解');
            const container = $('result-pricing');
            showSkeleton(container, 'pricing');
            (async () => {
                await nextFrame();
                try {
                    const { mc, greeks, dt } = await runPricing(P);
                    if (!mc || !isFinite(mc.price) || isNaN(mc.price)) {
                        throw new Error('计算结果无效（价格为 NaN 或 Infinity），请检查参数是否合法。');
                    }
                    hideLoading();
                    $('submitBtn').disabled = false;
                    lastP = buildParams();
                    lastMC = mc;
                    lastGreeks = greeks;
                    lastP.code = $('code').value;
                    lastP.codeText = $('code').selectedOptions[0]?.textContent || lastP.code;
                    container.innerHTML = '';
                    container.classList.add('fade-in');
                    renderPricingResults(lastP, mc, greeks, dt / 1000);
                    // 定价完成后 100ms 自动启动曲面计算（保持折叠）
                    setTimeout(() => startSurfaceCalc(), 100);
                } catch (err) {
                    hideLoading();
                    $('submitBtn').disabled = false;
                    showComputationError(container, err, () => $('submitBtn').click());
                }
            })();
        }
}

// ====== 定价结果渲染（估值定价模式） ======
function renderPricingResults(P, mc, greeks, dt) {
    const _N = P.notional * 10000;
    const _S = P.s0;
    const _dc = greeks.delta * 0.01 * _S * _N;
    const _gc = greeks.gamma * 0.01 * _S * _N;
    const _vc = greeks.vega * _N;
    const _tc = greeks.theta / 12 * _N;
    const _rc = greeks.rho * _N;
    const _rqc = greeks.rhoQ * _N;
    const _vki = (greeks.vegaKI || 0) * _N;
    const _vko = (greeks.vegaKO || 0) * _N;

    const koDesc = P.koMode === 'descending' ? '(起始)' : '';
    const m = $('result-pricing');
    m.innerHTML = `
<div class="result-section">
<h2 class="result-section-title">定价与风险分析</h2>
<div class="cards">
<div class="card blue"><div class="label">理论价值</div><div class="value">${fmtVal(mc.price)}</div><div class="sub">利差 ${fmtPctSafe(1 - mc.price)} | ${(mc.price * P.notional).toFixed(2)}万${mc.priceSE ? ` | SE±${(mc.priceSE * P.notional).toFixed(2)}万` : ''}</div><div class="sub" style="font-size:9px">${mc.priceSE ? `95%CI [${fmtVal(mc.price - 1.96 * mc.priceSE)}, ${fmtVal(mc.price + 1.96 * mc.priceSE)}] | σ_path=${fmtVal(mc.pathStd)}` : ''}</div></div>
<div class="card green"><div class="label">敲出概率</div><div class="value">${fmtPctSafe(mc.koProb)}</div><div class="sub">提前终止</div></div>
<div class="card red"><div class="label">敲入概率</div><div class="value">${fmtPctSafe(mc.kiProb)}</div><div class="sub">承担下跌风险</div></div>
<div class="card"><div class="label">亏损概率</div><div class="value">${fmtPctSafe(mc.kiLossProb)}</div><div class="sub">敲入且到期亏损</div></div>
</div>
<div class="section"><h3>路径密度聚类热图</h3><div class="chart-hint">MC 路径的 2D 密度估计（价格×时间）。颜色越深=路径密度越高。金色虚线=敲出价，红色实线=敲入价，藏青虚线=S₀</div><canvas id="cvPathDensity" style="height:260px"></canvas></div>
<div class="section"><h3>时间维度概率演变</h3><div class="chart-hint">横轴=时间(月)，纵轴=概率占比(0-100%)。KO阶梯=月度观察日跳跃；KI平滑曲线=按日连续监控。金=敲出，红=敲入，蓝=存续。竖虚线=锁定期末</div><canvas id="cvKOEvolution" style="height:280px"></canvas></div>
<div class="section"><h3>逐观察日敲出概率分解</h3><div class="chart-hint">每个观察日（月度）的敲出概率柱状图。锁定期后第一个观察日开始，柱高=该观察日敲出的路径占比</div><canvas id="cvKODistribution" style="height:220px"></canvas></div>
<div class="section"><h3>票息累积</h3><div class="chart-hint">每月预期累积票息金额（年化%）。敲出路径按持有月数折算票息，到期路径按红利票息计算</div><canvas id="cvCouponAccrual" style="height:220px"></canvas></div>
<div class="section"><h3>PV 概率密度分布</h3><div class="chart-hint">MC 模拟 ${P.nPaths} 条路径的 PV 概率密度（高斯核密度估计，Silverman 带宽）。VaR(95%)=最差5%路径的门槛值；ES(95%)=尾部均值。红色竖线=理论价值</div><canvas id="cvPathHistogram" style="height:260px"></canvas></div>
${P.useLocalVol ? cevSection(P) : ''}
<div class="section"><h3>风险敏感度 Greeks（场景计算器）</h3>
<div class="chart-hint">输入观察时点和价格偏离度，计算该场景下的 Greeks。假设合约未敲入；strikeRef 固定为期初价</div>
<div class="greek-scene-bar">
<div class="form-group"><label for="greeksTime">观察时点</label>
<select id="greeksTime"><option value="0">今天 (t=0)</option><option value="1">1个月后</option><option value="3">3个月后</option><option value="6">6个月后</option></select></div>
<div class="form-group"><label for="greeksPrice">S/S₀</label><input type="number" id="greeksPrice" step="0.01" value="1.00" min="0.01" inputmode="decimal"></div>
<div class="form-group"><label for="greeksVol">波动率(%)</label><input type="number" id="greeksVol" step="0.01" inputmode="decimal" placeholder="默认当前值"></div>
<div class="form-group"><label>&nbsp;</label><button type="button" class="btn btn-primary" id="greeksCalcBtn" style="width:100%;margin-top:0">计算</button></div>
</div>
<div id="greeksResult">
${buildGreeksCards(greeks, fmtMoney, _dc, _gc, _vc, _tc, _rc, _rqc, _vki, _vko)}
<div class="note">
<strong>计算场景</strong>：今天 (t=0) | S/S₀=1.00 | 剩余期限 ${P.tenorMonths}月 | σ=${(P.vol * 100).toFixed(1)}% | 名义本金${P.notional}万<br>
<strong>口径说明</strong>：卖方业务口径，1%标准化。Delta=标的涨1%的价值变动；Gamma=标的涨1%的Delta金额变化；Vega=vol+1pp的价值变动；Theta=每天的时间价值变动；Rho=利率+1bp的价值变动；RhoQ=股息率+1bp的价值变动。点击卡片展开风险机理与对冲建议。<br>
<strong>CRN有限差分法</strong>：微扰参数后重新定价，共用同一组 Sobol 随机数消除 MC 噪声。<br>
<strong style="color:#d97706">⚠ 精度说明</strong>：MC|CRN有限差分法在敲入边界附近Gamma精度有限，当前结果仅供参考。
</div>
</div>
</div>
<div class="adv-row collapsed" id="greeksSurfaceSection">
<div class="adv-toggle" id="greeksSurfaceToggle">
<span class="arrow"></span>
<span>Greeks 二维曲面（价格×期限）</span>
<span class="adv-tag" style="margin-left:4px">高级分析</span>
</div>
<div class="adv-body">
<div class="chart-hint" style="margin-top:6px">横轴=剩余期限(月),纵轴=标的价/S₀。价格范围精确覆盖 KI~KO 活跃区间。蓝=负值,白=零,红=正值。网格 10价×N期，后台逐行计算不阻塞 UI</div>
<div class="surface-progress-wrap" style="display:flex;margin-bottom:12px;align-items:center;gap:10px;flex-wrap:wrap">
<button type="button" class="btn btn-primary" id="greeksSurfaceBtn" style="width:auto;padding:8px 18px;margin-top:0">生成 Greeks 曲面</button>
<div class="surface-progress-wrap" id="greeksSurfaceProgressWrap" style="display:none;align-items:center;gap:10px">
<div class="surface-progress"><div class="surface-progress-bar" id="greeksSurfaceBar" style="width:0%"></div></div>
<span id="greeksSurfaceProgress" style="font-size:12px;min-width:130px"></span>
</div>
</div>
<div id="greeksSurfaceContainer" style="display:none">
<div style="display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:12px">
<button type="button" class="tab-btn greek-surface-tab active" data-greek="delta" style="padding:8px 18px">Delta</button>
<button type="button" class="tab-btn greek-surface-tab" data-greek="gamma" style="padding:8px 18px">Gamma</button>
<button type="button" class="tab-btn greek-surface-tab" data-greek="vega" style="padding:8px 18px">Vega</button>
<button type="button" class="tab-btn greek-surface-tab" data-greek="theta" style="padding:8px 18px">Theta</button>
<button type="button" class="tab-btn" id="greeksAnimBtn" data-playing="0" style="padding:8px 18px;margin-left:auto">▶ 动态播放</button>
</div>
<canvas id="cvGreeksSurface" style="height:440px"></canvas>
<div class="footnote">当前: <span id="greeksSurfaceLabel">Delta</span> | 蓝=负值 白=零 红=正值 | 金线=敲出 红线=敲入 藏青虚线=S₀ | 金额口径与Greeks卡片一致(1%标准化,单位:万/亿元)</div>
<canvas id="cvForwardGreeks" style="height:200px;margin-top:12px"></canvas>
<div class="footnote">ATM (S/S₀=1.0) 处各 Greeks 随剩余期限的变化曲线，金额口径同上</div>
</div>
</div>
</div>
<div class="section" id="stressTableSection">
<h3>Greeks 压力情景表 <span style="font-size:11px;font-weight:400;color:var(--ink-muted)">vol ±5pp × spot ±10%</span></h3>
<div class="chart-hint">9 种情景的 Greeks 快照。使用 CRN 共享随机数保证可比性，增量计算中…</div>
<table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:12px">
<thead>
<tr>
<th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--border);color:var(--ink-muted);font-size:10px;text-transform:uppercase;letter-spacing:.04em">S/S₀ \ σ</th>
<th style="padding:8px 10px;text-align:center;border-bottom:2px solid var(--border);color:var(--ink-muted);font-size:10px;text-transform:uppercase">${(P.vol * 100 - 5).toFixed(1)}%</th>
<th style="padding:8px 10px;text-align:center;border-bottom:2px solid var(--accent);color:var(--accent);font-size:10px;text-transform:uppercase;font-weight:700">${(P.vol * 100).toFixed(1)}%</th>
<th style="padding:8px 10px;text-align:center;border-bottom:2px solid var(--border);color:var(--ink-muted);font-size:10px;text-transform:uppercase">${(P.vol * 100 + 5).toFixed(1)}%</th>
</tr>
</thead>
<tbody id="stressTableBody">
${[0.90, 1.00, 1.10].map((sr, ri) => `<tr>
<td style="padding:10px;border-bottom:1px solid var(--border);color:var(--ink-soft);font-weight:600;text-align:left">${sr.toFixed(2)}</td>
${[0, 1, 2].map(ci => `<td id="stress-${ri}-${ci}" style="padding:10px;border-bottom:1px solid var(--border);text-align:center;line-height:1.6"><span style="color:#ccc;font-size:11px">计算中…</span></td>`).join('')}
</tr>`).join('')}
</tbody>
</table>
<div class="footnote">PV=理论价值 | Δ=Delta(标的涨1%金额) | ν=Vega(vol升1pp金额) | CRN共享随机数</div>
</div>
<div class="footnote" style="text-align:right">计算耗时 ${dt.toFixed(2)}s | 路径数 ${P.nPaths} | 步数 ${P.nSteps} | 计息 ACT/365 | 敲出 ${P.koMode === 'descending' ? '递减' : '固定'} | 波动率模型: ${P.useJump ? 'Merton跳跃扩散' : (P.useLocalVol ? 'CEV' : '常数GBM')} | ${dataFoot()}</div>
`;

    setTimeout(() => {
        drawKOEvolution($('cvKOEvolution'), P, mc);
        drawPathHistogram($('cvPathHistogram'), mc, P);
        drawCouponAccrual($('cvCouponAccrual'), P, mc);
        drawKODistribution($('cvKODistribution'), P, mc);
        drawPathDensityHeatmap($('cvPathDensity'), P, mc);
        if (P.useLocalVol) drawVolCurve($('cvVolCurve'), P);
    }, 10);

    setTimeout(() => computeStressTable3x3(P), 100);

    surfaceData = null;
    surfaceKey = '';
}

function fmtPctSafe(v) {
    return (v * 100).toFixed(1) + '%';
}

function cevSection(P) {
    const koDesc = P.koMode === 'descending' ? '(起始)' : '';
    const koRatio = P.koMode === 'descending' ? P.koStartPct : P.koPct;
    const skew = (r) => {
        const cev = P.vol / r * 100;
        const d = (P.vol / r - P.vol) * 100;
        return `<td>${cev.toFixed(1)}%</td><td style="color:${d >= 0 ? 'var(--negative)' : 'var(--positive)'};font-weight:600">${d >= 0 ? '+' : ''}${d.toFixed(1)}pp</td>`;
    };
    return `<div class="section"><h3>局部波动率曲线（CEV β=0）</h3>
<table class="greeks-table" style="margin-bottom:10px"><tr><th>位置</th><th>价格水平</th><th>常数 σ</th><th>CEV σ</th><th>偏斜</th></tr>
<tr><td>敲入价</td><td>S₀×${(P.kiPct * 100).toFixed(0)}%</td><td>${(P.vol * 100).toFixed(1)}%</td><td style="color:var(--negative);font-weight:700">${(P.vol / P.kiPct * 100).toFixed(1)}%</td><td style="color:var(--negative)">+${((P.vol / P.kiPct - P.vol) * 100).toFixed(1)}pp</td></tr>
<tr><td>ATM</td><td>S₀×100%</td><td>${(P.vol * 100).toFixed(1)}%</td><td>${(P.vol * 100).toFixed(1)}%</td><td>0</td></tr>
<tr><td>敲出价${koDesc}</td><td>S₀×${(koRatio * 100).toFixed(0)}%</td><td>${(P.vol * 100).toFixed(1)}%</td>${skew(koRatio)}</tr>
</table>
<canvas id="cvVolCurve" style="height:220px"></canvas></div>`;
}

// ====== Greeks 3×3 压力情景表（异步增量） ======
async function computeStressTable3x3(P) {
    const spots = [0.90, 1.00, 1.10];
    const vols = [Math.max(P.vol - 0.05, 0.001), P.vol, P.vol + 0.05];
    for (let ri = 0; ri < spots.length; ri++) {
        for (let ci = 0; ci < vols.length; ci++) {
            const td = $(`stress-${ri}-${ci}`);
            if (!td) continue;
            const pp = Object.assign({}, P, { s0: P.s0 * spots[ri], vol: vols[ci] });
            await nextFrame();
            const normals = generateNormals(pp.nPaths, pp.nSteps);
            const price = priceWithNormals(pp, normals);
            const g = computeGreeks(pp, normals);
            const N = P.notional * 10000;
            const S = pp.s0;
            const _dc = g.delta * 0.01 * S * N;
            const _vc = g.vega * N;
            td.innerHTML = `<div style="font-size:16px;font-weight:700;letter-spacing:-.02em">${price.toFixed(4)}</div>
<div style="font-size:10px;color:#888;margin-top:2px">Δ ${fmtMoney(_dc)}</div>
<div style="font-size:10px;color:#888">ν ${fmtMoney(_vc)}</div>`;
        }
    }
}

// ====== 反推票息结果 ======
function renderReverseResult(result, P, dt, target) {
    const errPct = Math.abs((result.verifyPrice - target) / target * 100);
    const m = $('result-pricing');
    m.innerHTML = `
<div class="result-section">
<h2 class="result-section-title">反推票息结果</h2>
<div class="cards">
<div class="card blue"><div class="label">反推票息率</div><div class="value">${(result.coupon * 100).toFixed(2)}%</div><div class="sub">年化</div></div>
<div class="card green"><div class="label">验证理论价值</div><div class="value">${result.verifyPrice.toFixed(4)}</div><div class="sub">定价误差 ${errPct.toFixed(2)}%</div></div>
<div class="card"><div class="label">二分查找区间</div><div class="value" style="font-size:16px">[${(result.lo * 100).toFixed(2)}%, ${(result.hi * 100).toFixed(2)}%]</div><div class="sub">收敛精度 1e-5</div></div>
<div class="card"><div class="label">迭代次数</div><div class="value">${result.iterations}</div><div class="sub">最多 20 次</div></div>
</div>
<div class="section">
<h3>业务说明</h3>
<div class="plain-text">
给定目标理论价值 ${target.toFixed(2)}（${target === 1 ? '平价发行' : '溢价/折价发行'}），在其他条款不变的情况下，反推出的最大可承诺票息率为 <strong>${(result.coupon * 100).toFixed(2)}%</strong>。<br><br>
验证定价：用反推票息率重新跑 MC 定价，理论价值为 ${result.verifyPrice.toFixed(4)}，与目标价值的误差为 ${errPct.toFixed(2)}%。<br><br>
算法：Sobol 低差异序列 + GBM 路径模拟 + CRN 共享随机数二分查找，保证单调性和收敛性。每次迭代复用同一组随机数，避免 MC 噪声导致二分方向错误。
</div>
</div>
<div class="footnote" style="text-align:right">计算耗时 ${dt.toFixed(2)}s | 路径数 ${P.nPaths} | 步数 ${P.nSteps} | 计息 ACT/365 | ${dataFoot()}</div>
`;
}

// ====== Greeks 场景计算器 ======
async function onGreeksCalc() {
    const baseP = lastP;
    if (!baseP) { showToast('请先完成定价分析'); return; }
    const priceRatio = parseFloat($('greeksPrice').value);
    if (!priceRatio || priceRatio <= 0) { showToast('请输入有效的 S/S₀'); return; }
    const monthsElapsed = parseInt($('greeksTime').value);
    const newTenor = baseP.tenorMonths - monthsElapsed;
    if (newTenor <= 0) { showToast('观察时点超出产品期限'); return; }
    const volInput = $('greeksVol').value;
    const vol = volInput ? parseFloat(volInput) / 100 : baseP.vol;
    const pp = Object.assign({}, baseP, {
        s0: baseP.s0 * priceRatio,
        tenorMonths: newTenor, tenorYears: newTenor / 12,
        nSteps: Math.max(Math.round(newTenor / 12 * 252), 20),
        vol: vol
    });
    showLoading('计算 Greeks 中…', 'CRN 有限差分');
    await nextFrame();
    try {
        const normals = generateNormals(pp.nPaths, pp.nSteps);
        const g = computeGreeks(pp, normals);
        const N = baseP.notional * 10000;
        const S = baseP.s0 * priceRatio;
        const _dc = g.delta * 0.01 * S * N;
        const _gc = g.gamma * 0.01 * S * N;
        const _vc = g.vega * N;
        const _tc = g.theta / 12 * N;
        const _rc = g.rho * N;
        const _rqc = g.rhoQ * N;
        const _vki = (g.vegaKI || 0) * N;
        const _vko = (g.vegaKO || 0) * N;
        const timeLabel = $('greeksTime').selectedOptions[0].textContent;
        $('greeksResult').innerHTML = `
${buildGreeksCards(g, fmtMoney, _dc, _gc, _vc, _tc, _rc, _rqc, _vki, _vko)}
<div class="note">
<strong>计算场景</strong>：${timeLabel} | S/S₀=${priceRatio.toFixed(2)} | 剩余期限 ${newTenor}月 | σ=${(vol * 100).toFixed(1)}% | 名义本金${baseP.notional}万<br>
<strong>口径说明</strong>：卖方业务口径，1%标准化。点击卡片展开风险机理与对冲建议。<br>
<strong>CRN有限差分法</strong>：微扰参数后重新定价，共用同一组 Sobol 随机数消除 MC 噪声。${baseP.nPaths} 路径。<br>
<strong style="color:#d97706">⚠ 精度说明</strong>：敲入边界附近Gamma精度有限，仅供参考。
</div>`;
        hideLoading();
    } catch (err) {
        hideLoading();
        showToast('Greeks 计算出错: ' + err.message);
    }
}

// ====== Greeks 曲面 ======
function drawSurface(key) {
    if (!surfaceData || !lastP) return;
    drawGreeksHeatmap($('cvGreeksSurface'), surfaceData, key, lastP);
    drawForwardGreeks($('cvForwardGreeks'), surfaceData, lastP);
}

async function startSurfaceCalc() {
    const btn = $('greeksSurfaceBtn');
    if (!btn || !lastP) return;
    const progEl = $('greeksSurfaceProgress');
    const progBar = $('greeksSurfaceBar');
    const progWrap = $('greeksSurfaceProgressWrap');
    const container = $('greeksSurfaceContainer');

    const keyParams = ['s0', 'koPct', 'kiPct', 'couponRate', 'tenorMonths', 'lockoutMonths', 'vol', 'rf', 'div', 'notional', 'nPaths', 'useLocalVol', 'koMode', 'couponTiered', 'couponEarly', 'couponLate', 'couponSwitchMonth', 'couponDiv'].map(k => lastP[k]).join('|');
    if (surfaceKey === keyParams && surfaceData) {
        container.style.display = 'block';
        progWrap.style.display = 'none';
        btn.textContent = '重新计算';
        drawSurface(activeGreekKey());
        return;
    }

    surfaceData = null;
    surfaceKey = keyParams;
    btn.disabled = true;
    btn.textContent = '计算中...';
    progWrap.style.display = 'flex';
    progBar.style.width = '0%';
    progEl.textContent = '计算中...';
    container.style.display = 'block';

    try {
        await nextFrame();
        const result = await buildGreeksSurface(lastP, (ti, total, row, priceGrid, tenorGrid) => {
            const progress = ((ti + 1) / total * 100).toFixed(0);
            progBar.style.width = progress + '%';
            progEl.textContent = `计算中 ${ti + 1}/${total} (${progress}%)`;

            if (!surfaceData) surfaceData = { data: {}, priceGrid, tenorGrid };
            surfaceData.priceGrid = priceGrid;
            surfaceData.tenorGrid = tenorGrid;
            for (const item of row) {
                surfaceData.data[item.pi + '_' + item.ti] = item.g;
            }
            if (ti >= 1) drawSurface(activeGreekKey());
        }, () => false);

        if (result) {
            progBar.style.width = '100%';
            progEl.textContent = '完成 ✓';
            setTimeout(() => { if (progWrap) progWrap.style.display = 'none'; }, 1200);
            btn.disabled = false;
            btn.textContent = '重新计算';
            surfaceData.priceGrid = result.priceGrid;
            surfaceData.tenorGrid = result.tenorGrid;
            drawSurface(activeGreekKey());
        }
    } catch (err) {
        showToast('曲面计算出错: ' + err.message);
        btn.disabled = false;
        btn.textContent = '生成 Greeks 曲面';
        progWrap.style.display = 'none';
    }
}

function activeGreekKey() {
    const t = document.querySelector('.greek-surface-tab.active');
    return t ? t.dataset.greek : 'delta';
}

// ====== 曲面区事件委托（动态内容） ======
document.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.id === 'greeksCalcBtn') { onGreeksCalc(); return; }
    if (t && t.id === 'greeksSurfaceBtn') { startSurfaceCalc(); return; }
    if (t && t.id === 'greeksSurfaceToggle') {
        const section = t.closest('.adv-row');
        section.classList.toggle('collapsed');
        if (!section.classList.contains('collapsed') && surfaceData) {
            requestAnimationFrame(() => drawSurface(activeGreekKey()));
        }
        return;
    }
    if (t && t.classList && t.classList.contains('greek-surface-tab')) {
        document.querySelectorAll('.greek-surface-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        const key = t.dataset.greek;
        const labelEl = $('greeksSurfaceLabel');
        if (labelEl) labelEl.textContent = { delta: 'Delta', gamma: 'Gamma', vega: 'Vega', theta: 'Theta' }[key];
        drawSurface(key);
        return;
    }
    if (t && t.id === 'greeksAnimBtn') {
        const btn = t;
        const isPlaying = btn.dataset.playing === '1';
        if (isPlaying) {
            clearInterval(window._greeksAnimInterval);
            btn.dataset.playing = '0';
            btn.textContent = '▶ 动态播放';
        } else {
            const greekKeys = ['delta', 'gamma', 'vega', 'theta'];
            let idx = greekKeys.indexOf(activeGreekKey());
            if (idx < 0) idx = 0;
            btn.dataset.playing = '1';
            btn.textContent = '■ 停止';
            window._greeksAnimInterval = setInterval(() => {
                idx = (idx + 1) % greekKeys.length;
                const nextKey = greekKeys[idx];
                for (const b of document.querySelectorAll('.greek-surface-tab')) {
                    if (b.dataset.greek === nextKey) { b.click(); break; }
                }
            }, 1800);
        }
    }
});

// ====== 压力测试 Tab ======
function updateStressParamsSummary() {
    try {
        const code = $('code');
        const codeText = code.options[code.selectedIndex].text;
        const el = $('stressParamText');
        if (el) {
            el.innerHTML = `<b>${codeText}</b> | 期限 <b>${$('tenor').value}月</b> | 敲入 <b>${$('ki').value}%</b> | 敲出 <b>${$('ko').value}%</b> | 波动率 <b>${$('vol').value}%</b> | 路径数 <b>${parseInt($('npaths').value).toLocaleString()}</b>`;
        }
    } catch (e) { /* 表单未就绪时静默 */ }
}

async function runStressTestAll() {
    if (stressRunning) return;
    stressRunning = true;
    const P = buildParams();
    showLoading('压力测试计算中', '正在生成 Sobol 随机数...');
    const container = $('stressResults');
    const originalHTML = container.innerHTML;
    if (container) {
        container.style.display = '';
        showSkeleton(container, 'stress');
    }
    try {
        const normals = generateNormals(P.nPaths, P.nSteps);

        showLoading('压力测试计算中', '波动率冲击情景 (7个)...');
        await nextFrame();
        const volResults = runStressTest(P, buildVolScenarios(P), normals);

        showLoading('压力测试计算中', '标的价格跳跃情景 (7个)...');
        await nextFrame();
        const spotResults = runStressTest(P, buildSpotScenarios(P), normals);

        const crisisScenarios = await buildCrisisScenarios(P);
        showLoading('压力测试计算中', `历史危机情景 (${crisisScenarios.length}个)...`);
        await nextFrame();
        const crisisResults = runStressTest(P, crisisScenarios, normals);

        showLoading('压力测试计算中', '组合情景矩阵 (25个)...');
        await nextFrame();
        const matrixResults = runStressTest(P, buildMatrixScenarios(P), normals);

        showLoading('渲染结果中', '...');
        await nextFrame();
        container.innerHTML = originalHTML;
        container.classList.add('fade-in');
        renderStressResults(P, { volResults, spotResults, crisisResults, matrixResults });

        $('stressEmpty').style.display = 'none';
        $('stressResults').style.display = '';
        hideLoading();
        showToast('压力测试完成');
    } catch (e) {
        hideLoading();
        if (container) container.style.display = '';
        showComputationError(container, e, runStressTestAll);
    } finally {
        stressRunning = false;
    }
}

function renderStressResults(P, { volResults, spotResults, crisisResults, matrixResults }) {
    lastStress = { P, volResults, spotResults, crisisResults, matrixResults };
    renderStressSummary(volResults, spotResults, crisisResults);
    renderStressVolTable(P, volResults);
    renderStressSpotTable(P, spotResults);
    renderStressCrisisTable(crisisResults);
    const cv = $('stressMatrixCanvas');
    if (cv) drawStressMatrix(cv, matrixResults, P);
}

function renderStressSummary(volResults, spotResults, crisisResults) {
    const all = [...volResults, ...spotResults, ...crisisResults];
    const valid = all.filter(r => !r.error && !isNaN(r.pv));
    const nonBase = valid.filter(r => !(r.scenario.shock === 0 || r.scenario.label === '基准'));

    if (nonBase.length === 0) {
        $('stressSummary').innerHTML = '<div style="grid-column:1/-1;color:var(--ink-muted);text-align:center;padding:20px">无可用压力测试数据</div>';
        return;
    }

    const worstPv = nonBase.reduce((a, b) => (b.pv < a.pv ? b : a), nonBase[0]);
    const worstDrop = nonBase.reduce((a, b) => (b.delta_pv < a.delta_pv ? b : a), nonBase[0]);
    const worstVega = nonBase.reduce((a, b) => (Math.abs(b.delta_greeks.vega) > Math.abs(a.delta_greeks.vega) ? b : a), nonBase[0]);

    const card = 'background:var(--surface);padding:14px 16px;border-radius:8px;border:1px solid var(--border)';
    const lbl = 'font-size:11px;color:var(--ink-muted);margin-bottom:6px';
    const val = 'font-size:20px;font-weight:600';
    const dsc = 'font-size:12px;color:var(--ink-soft);margin-top:4px';

    const pvColor = worstPv.pv < worstPv.base_pv ? 'var(--negative)' : 'var(--ink)';
    const dropColor = worstDrop.delta_pv < 0 ? 'var(--negative)' : 'var(--positive)';
    const dropPct = worstDrop.base_pv !== 0 ? (worstDrop.delta_pv / worstDrop.base_pv * 100).toFixed(2) : 'N/A';
    const vegaColor = worstVega.delta_greeks.vega < 0 ? 'var(--negative)' : 'var(--positive)';

    $('stressSummary').innerHTML =
        `<div style="${card}"><div style="${lbl}">最差情景（PV最低）</div><div style="${val};color:${pvColor}">${worstPv.pv.toFixed(4)}</div><div style="${dsc}">${worstPv.scenario.label} | 基准 ${worstPv.base_pv.toFixed(4)}</div></div>` +
        `<div style="${card}"><div style="${lbl}">最大 PV 降幅</div><div style="${val};color:${dropColor}">${worstDrop.delta_pv >= 0 ? '+' : ''}${worstDrop.delta_pv.toFixed(4)}</div><div style="${dsc}">${worstDrop.scenario.label} | 降幅 ${dropPct}%</div></div>` +
        `<div style="${card}"><div style="${lbl}">Vega 变化最大</div><div style="${val};color:${vegaColor}">${worstVega.delta_greeks.vega >= 0 ? '+' : ''}${worstVega.delta_greeks.vega.toFixed(4)}</div><div style="${dsc}">${worstVega.scenario.label} | 原始 Vega ${worstVega.greeks.vega.toFixed(4)}</div></div>`;
}

const STRESS_TH = 'padding:8px 10px;text-align:left;font-weight:600;color:var(--ink-soft);border-bottom:2px solid var(--border)';
const STRESS_TD = 'padding:8px 10px;border-bottom:1px solid var(--border);font-family:var(--mono)';

function renderStressTable(elId, results, headers, cellsFn, opts = {}) {
    const el = $(elId);
    if (!el) return;
    const { showWorst = true, hasBase = true } = opts;

    if (!results || results.length === 0) {
        el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--ink-muted);font-size:13px">历史危机数据加载失败或不可用</div>';
        return;
    }

    const nonBase = showWorst ? results.filter(r => !r.error && !isNaN(r.pv) && r.scenario.shock !== 0) : [];
    const worstDrop = nonBase.length > 0 ? nonBase.reduce((a, b) => (b.delta_pv < a.delta_pv ? b : a), nonBase[0]) : null;
    const nCols = headers.length;

    const rows = results.map(r => {
        const isBase = hasBase && (r.scenario.shock === 0 || r.scenario.label === '基准');
        let s = STRESS_TD;
        if (isBase) s += ';background:var(--surface-2)';
        if (worstDrop && r === worstDrop) s += ';border-left:3px solid var(--negative)';

        if (r.error || isNaN(r.pv)) {
            const empties = '<td>—</td>'.repeat(nCols - 1);
            return `<tr style="${s}"><td>${r.scenario.label}</td>${empties}</tr>`;
        }
        return `<tr style="${s}">${cellsFn(r)}</tr>`;
    }).join('');

    const ths = headers.map(h => `<th style="${STRESS_TH}">${h}</th>`).join('');
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;font-family:var(--mono);font-variant-numeric:tabular-nums"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
}

function dpvCell(r) {
    const dpv = r.delta_pv;
    const c = dpv < 0 ? 'var(--negative)' : (dpv > 0 ? 'var(--positive)' : 'var(--ink-soft)');
    const s = (dpv >= 0 ? '+' : '') + dpv.toFixed(4);
    return `<td style="color:${c}">${s}</td>`;
}

function renderStressVolTable(P, results) {
    const N = P.notional * 10000;
    renderStressTable('stressVolTable', results,
        ['情景', '波动率', 'PV', 'ΔPV', 'Vega', 'ΔVega'],
        r => {
            const vol = (r.scenario.P_prime.vol * 100).toFixed(1) + '%';
            const vega = fmtMoney(r.greeks.vega * N);
            const dvega = r.delta_greeks.vega * N;
            const dvegaC = dvega < 0 ? 'var(--negative)' : (dvega > 0 ? 'var(--positive)' : 'var(--ink-soft)');
            const dvegaS = (dvega >= 0 ? '+' : '') + fmtMoney(dvega);
            return `<td>${r.scenario.label}</td><td>${vol}</td><td>${r.pv.toFixed(4)}</td>${dpvCell(r)}<td>${vega}</td><td style="color:${dvegaC}">${dvegaS}</td>`;
        }
    );
}

function renderStressSpotTable(P, results) {
    const N = P.notional * 10000;
    renderStressTable('stressSpotTable', results,
        ['情景', '标的价格', 'PV', 'ΔPV', 'Delta', 'ΔDelta'],
        r => {
            const spot = r.scenario.P_prime.s0.toFixed(2);
            const S_prime = r.scenario.P_prime.s0;
            const deltaMoney = r.greeks.delta * 0.01 * S_prime * N;
            const baseDelta = r.greeks.delta - r.delta_greeks.delta;
            const ddeltaMoney = deltaMoney - baseDelta * 0.01 * P.s0 * N;
            const ddeltaC = ddeltaMoney < 0 ? 'var(--negative)' : (ddeltaMoney > 0 ? 'var(--positive)' : 'var(--ink-soft)');
            return `<td>${r.scenario.label}</td><td>${spot}</td><td>${r.pv.toFixed(4)}</td>${dpvCell(r)}<td>${fmtMoney(deltaMoney)}</td><td style="color:${ddeltaC}">${ddeltaMoney >= 0 ? '+' : ''}${fmtMoney(ddeltaMoney)}</td>`;
        }
    );
}

function renderStressCrisisTable(results) {
    renderStressTable('stressCrisisTable', results,
        ['危机', '实际波动率', 'PV', 'ΔPV'],
        r => {
            const vol = (r.scenario.crisisVol * 100).toFixed(1) + '%';
            return `<td>${r.scenario.label}</td><td>${vol}</td><td>${r.pv.toFixed(4)}</td>${dpvCell(r)}`;
        },
        { showWorst: false, hasBase: false }
    );
}

// ====== 对冲回测 Tab ======
const FREQ_LIST = ['intraday4', 'intraday2', 'daily', 'weekly', 'monthly'];
const FREQ_LABELS = { intraday4: '日内4次', intraday2: '日内2次', daily: '每日1次', weekly: '每周1次', monthly: '每月1次' };
const COST_SCAN_BPS = [0, 1, 2, 5, 10, 20, 50];

async function initBacktestPanel() {
    if (btInitialized) {
        syncBtFromPricing();
        return;
    }
    btInitialized = true;

    const btCodeSelect = $('btCode');
    const codeSelect = $('code');
    Array.from(codeSelect.querySelectorAll('option')).forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value; o.textContent = opt.textContent;
        btCodeSelect.appendChild(o);
    });
    btCodeSelect.value = codeSelect.value;

    const updateDateRange = async () => {
        const code = btCodeSelect.value;
        if (!code) return;
        try {
            const range = await getDateRange(code);
            const startInput = $('btStartDate');
            const endInput = $('btEndDate');
            startInput.min = fmtDate(range.start);
            startInput.max = fmtDate(range.end);
            endInput.min = fmtDate(range.start);
            endInput.max = fmtDate(range.end);
            if (!startInput.value || !endInput.value) {
                const endDt = range.end;
                const endYear = parseInt(endDt.slice(0, 4));
                const startDt = (endYear - 1) + endDt.slice(4);
                startInput.value = fmtDate(startDt);
                endInput.value = fmtDate(endDt);
            }
            const info = $('btInfo');
            if (info) {
                info.innerHTML = `数据范围：<b>${fmtDate(range.start)}</b> 至 <b>${fmtDate(range.end)}</b>。请先在「定价分析」完成定价，回测自动同步雪球结构参数。`;
            }
        } catch (e) { /* 忽略 */ }
    };
    btCodeSelect.addEventListener('change', updateDateRange);

    syncBtFromPricing();
    await updateDateRange();

    $('btSubmitBtn').addEventListener('click', runBacktest);
    $('btMultiFreqBtn').addEventListener('click', runBacktestMultiFreq);
    $('btCostScanBtn').addEventListener('click', runCostSensitivity);
    $('btRollingBtn').addEventListener('click', runRollingWindow);
}

function syncBtFromPricing() {
    const codeSelect = $('code');
    const btCodeSelect = $('btCode');
    if (codeSelect.value && btCodeSelect.value !== codeSelect.value) {
        btCodeSelect.value = codeSelect.value;
        btCodeSelect.dispatchEvent(new Event('change'));
    }
    const notional = $('notional').value;
    if (notional) $('btNotional').value = notional;

    if (lastP) {
        $('btEmpty').style.display = 'none';
        $('btPanel').style.display = 'block';
    }

    const hint = $('btQuickHint');
    if (hint) {
        if (lastP) {
            const codeText = codeSelect.options[codeSelect.selectedIndex].text;
            hint.innerHTML = `已同步定价参数：<b>${codeText}</b> ${lastP.tenorMonths}月期 票息${((lastP.couponTiered ? lastP.couponEarly : lastP.couponRate) * 100).toFixed(2)}%`;
        } else {
            hint.innerHTML = '<span style="color:var(--negative)">⚠ 尚未完成定价分析，请先到「定价分析」Tab 计算</span>';
        }
    }
}

// 回测公共入参读取与校验
async function readBtInputs(containerId) {
    const code = $('btCode').value;
    const startDate = parseDate($('btStartDate').value);
    const endDate = parseDate($('btEndDate').value);
    const costBps = parseFloat($('btCost').value);
    const btNotional = parseFloat($('btNotional').value);
    const panel = $(containerId);
    $( 'btPanel').style.display = 'block';
    if (!code || !startDate || !endDate) {
        showToast('请选择标的和起止日期');
        showHintCard(panel, '参数不完整', '请选择标的代码并填写完整的起止日期后再运行。');
        return null;
    }
    if (startDate >= endDate) {
        showToast('开始日期必须早于结束日期');
        showHintCard(panel, '日期区间非法', '开始日期必须早于结束日期，请调整后重试。');
        return null;
    }
    if (isNaN(costBps) || costBps < 0) {
        showToast('交易成本必须 ≥ 0');
        showHintCard(panel, '成本参数非法', '单边交易成本必须是不小于 0 的数字（单位 bps）。');
        return null;
    }
    if (isNaN(btNotional) || btNotional <= 0) {
        showToast('名义本金必须 > 0');
        showHintCard(panel, '名义本金非法', '名义本金必须是大于 0 的数字（单位 万）。');
        return null;
    }
    let histSlice;
    try { histSlice = await sliceHist(code, startDate, endDate); }
    catch (e) {
        showToast('获取历史数据失败: ' + e.message);
        showHintCard(panel, '历史数据获取失败', (e.message || String(e)).replace(/</g, '&lt;'));
        return null;
    }
    if (histSlice.length < 20) {
        showToast(`历史数据仅 ${histSlice.length} 条`);
        showHintCard(panel, '历史数据不足', `当前区间仅有 ${histSlice.length} 条历史数据，回测至少需要 20 条。请扩大日期区间。`);
        return null;
    }
    if (!lastP) {
        showToast('请先在「定价分析」Tab 完成定价');
        return null;
    }
    return { code, startDate, endDate, costBps, btNotional, histSlice };
}

// Greeks 表缓存（键=15 字段）；Worker 可用时按期限列并行，降级自动走主线程串行
async function ensureBtTable(P, btP, histPrices, progFill, progText) {
    const priceRangeKey = histPrices.length > 0
        ? Math.min(...histPrices.map(p => p / (btP.s0))).toFixed(3) + '-' + Math.max(...histPrices.map(p => p / (btP.s0))).toFixed(3)
        : 'default';
    const tableKey = [btP.s0, P.kiPct, P.koPct, P.couponRate, P.tenorMonths, P.lockoutMonths, P.vol, P.rf, P.div, P.koMode, P.couponTiered, P.couponEarly, P.couponLate, P.couponSwitchMonth, priceRangeKey].join('|');
    if (btTableCache && btTableCacheKey === tableKey) return;
    progText.textContent = '预计算 Greeks 表中…';
    await nextFrame();
    const pool = getPool();
    btTableCache = await pool.runTable(btP, histPrices, (cur, total) => {
        const pct = (cur / total * 100).toFixed(0);
        progFill.style.width = pct + '%';
        progText.textContent = `Greeks 表 ${cur}/${total} (${pct}%)`;
    });
    setExecMode(pool.lastMode === 'workers' ? `${pool.size} worker 并行` : '主线程降级');
    btTableCacheKey = tableKey;
}

async function runBacktest() {
    const inputs = await readBtInputs('btPanel');
    if (!inputs) return;
    const { costBps, btNotional, histSlice, startDate, endDate } = inputs;
    const freq = $('btFreq').value;

    const P = Object.assign({}, lastP, { notional: btNotional });
    const histPrices = histSlice.map(d => d[1]);
    const btS0 = histPrices[0];
    const btP = Object.assign({}, P, { s0: btS0 });

    $('btEmpty').style.display = 'none';
    $('btPanel').style.display = 'block';
    $('btConclusion').style.display = 'none';
    $('btSummary').style.display = 'none';
    $('btMultiFreq').style.display = 'none';
    $('btCostScan').style.display = 'none';
    $('btRollingResult').style.display = 'none';
    const chartsEl = $('btCharts');
    const originalChartsHTML = chartsEl.innerHTML;
    showSkeleton(chartsEl, 'backtest');
    chartsEl.style.display = 'grid';
    const progWrap = $('btProgress');
    const progFill = $('btProgressFill');
    const progText = $('btProgressText');
    progWrap.style.display = 'flex';
    progFill.style.width = '0%';
    progText.textContent = '准备中…';

    const btn = $('btSubmitBtn');
    btn.disabled = true;
    btn.textContent = '建表中…';

    await nextFrame();
    try {
        await ensureBtTable(P, btP, histPrices, progFill, progText);

        btn.textContent = '回测中…';
        progFill.style.width = '0%';
        progText.textContent = '逐日回测中…';
        await nextFrame();

        const t0 = performance.now();
        const result = await backtestHedge(P, histSlice, btTableCache, freq, costBps, (cur, total) => {
            const pct = (cur / total * 100).toFixed(0);
            progFill.style.width = pct + '%';
            progText.textContent = `回测 ${cur}/${total} (${pct}%)`;
        });
        const dt = performance.now() - t0;
        btLastResult = { result, P, freq, costBps };

        progFill.style.width = '100%';
        progText.textContent = '完成 ✓';
        setTimeout(() => { progWrap.style.display = 'none'; }, 800);

        chartsEl.innerHTML = originalChartsHTML;
        chartsEl.classList.add('fade-in');
        renderBacktestResult(result, P, dt / 1000, freq, costBps);
    } catch (e) {
        progWrap.style.display = 'none';
        chartsEl.innerHTML = originalChartsHTML;
        chartsEl.style.display = 'none';
        chartsEl.classList.remove('fade-in');
        showComputationError($('btPanel'), e, runBacktest);
    } finally {
        btn.disabled = false;
        btn.textContent = '开始回测';
    }
}

// 绩效指标 / 最大回撤 / Bootstrap（账本口径：全部基于 path[].bookCumPnL 序列）
function calcMaxDrawdown(path) {
    if (!path || path.length === 0) return 0;
    let peak = path[0].bookCumPnL;
    let maxDD = 0;
    for (const p of path) {
        if (p.bookCumPnL > peak) peak = p.bookCumPnL;
        const dd = peak - p.bookCumPnL;
        if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
}

function calcPerformanceMetrics(path, N, rf, nDays) {
    if (!path || path.length < 2) return {};
    const n = path.length;
    const dailyReturns = [];
    for (let i = 1; i < n; i++) {
        dailyReturns.push(path[i].bookCumPnL - path[i - 1].bookCumPnL);
    }
    const totalRet = path[n - 1].bookCumPnL / N;
    const annRet = totalRet / (nDays / 252);
    const meanRet = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const varRet = dailyReturns.reduce((a, b) => a + (b - meanRet) ** 2, 0) / dailyReturns.length;
    const annVol = Math.sqrt(varRet * 252) / N;
    const sharpe = annVol > 1e-9 ? (annRet - rf) / annVol : 0;
    const downRet = dailyReturns.filter(r => r < 0);
    const downVar = downRet.length > 0 ? downRet.reduce((a, b) => a + b * b, 0) / downRet.length : 0;
    const downDev = Math.sqrt(downVar * 252) / N;
    const sortino = downDev > 1e-9 ? (annRet - rf) / downDev : 0;
    const maxDD = calcMaxDrawdown(path);
    const calmar = maxDD > 1e-9 ? (totalRet / (maxDD / N)) : 0;
    const winDays = dailyReturns.filter(r => r > 0).length;
    const winRate = winDays / dailyReturns.length;
    const avgWin = winDays > 0 ? dailyReturns.filter(r => r > 0).reduce((a, b) => a + b, 0) / winDays : 0;
    const lossDays = dailyReturns.length - winDays;
    const avgLoss = lossDays > 0 ? Math.abs(dailyReturns.filter(r => r < 0).reduce((a, b) => a + b, 0)) / lossDays : 0;
    const plRatio = avgLoss > 1e-9 ? avgWin / avgLoss : 0;
    return { annRet, annVol, sharpe, sortino, calmar, winRate, plRatio };
}

function bootstrapBacktest(path, nBoot = 500) {
    if (!path || path.length < 2) return {};
    const n = path.length;
    const dailyPnL = [];
    for (let i = 1; i < n; i++) {
        dailyPnL.push(path[i].bookCumPnL - path[i - 1].bookCumPnL);
    }
    const bootSums = new Float64Array(nBoot);
    for (let b = 0; b < nBoot; b++) {
        let sum = 0;
        for (let i = 0; i < dailyPnL.length; i++) {
            sum += dailyPnL[Math.floor(rngU01(b * dailyPnL.length + i) * dailyPnL.length)];
        }
        bootSums[b] = sum;
    }
    bootSums.sort();
    const p5 = bootSums[Math.floor(nBoot * 0.05)];
    const p95 = bootSums[Math.floor(nBoot * 0.95)];
    const p25 = bootSums[Math.floor(nBoot * 0.025)];
    const p975 = bootSums[Math.floor(nBoot * 0.975)];
    const p05 = bootSums[Math.floor(nBoot * 0.005)];
    const p995 = bootSums[Math.floor(nBoot * 0.995)];
    return { ci90lo: p5, ci90hi: p95, ci95lo: p25, ci95hi: p975, ci99lo: p05, ci99hi: p995 };
}

function renderBacktestResult(result, P, dt, freq, costBps) {
    const codeText = $('btCode').selectedOptions[0].textContent;
    const freqText = $('btFreq').selectedOptions[0].textContent;
    const N = P.notional * 10000;
    const pnlPct = (result.bookPnL / N * 100).toFixed(2);
    const maxDD = calcMaxDrawdown(result.path);
    const summaryEl = $('btSummary');
    summaryEl.style.display = 'grid';
    summaryEl.innerHTML = `
<div class="card ${result.bookPnL >= 0 ? 'green' : 'red'}">
<div class="label">账本累计盈亏</div>
<div class="value">${fmtMoney(result.bookPnL)}元</div>
<div class="sub">占名义本金 ${pnlPct}%（负债腿 + 对冲腿 − 成本）</div>
</div>
<div class="card ${result.liabPnL >= 0 ? 'green' : 'red'}">
<div class="label">负债腿累计（盯市）</div>
<div class="value">${fmtMoney(result.liabPnL)}元</div>
<div class="sub">占名义 ${(result.liabPnL / N * 100).toFixed(2)}% | 空头负债现值变动</div>
</div>
<div class="card ${result.hedgePnL >= 0 ? 'green' : 'red'}">
<div class="label">对冲腿累计（费前）</div>
<div class="value">${fmtMoney(result.hedgePnL)}元</div>
<div class="sub">占名义 ${(result.hedgePnL / N * 100).toFixed(2)}% | 期货 Delta 对冲</div>
</div>
<div class="card ${result.totalReturn >= 0 ? 'green' : 'red'}">
<div class="label">标的区间收益</div>
<div class="value">${(result.totalReturn * 100).toFixed(2)}%</div>
<div class="sub">${result.s0.toFixed(0)} → ${result.sEnd.toFixed(0)}</div>
</div>
<div class="card">
<div class="label">最大回撤（账本盈亏）</div>
<div class="value">${fmtMoney(maxDD)}元</div>
<div class="sub">占名义本金 ${(maxDD / N * 100).toFixed(2)}%（峰谷口径）</div>
</div>
<div class="card">
<div class="label">交易成本累计</div>
<div class="value" style="color:var(--negative)">-${fmtMoney(Math.abs(result.totalCost))}元</div>
<div class="sub">占名义本金 ${(Math.abs(result.totalCost) / N * 1e4).toFixed(1)}bp | 占账本盈亏 ${Math.abs(result.totalCost) / Math.max(Math.abs(result.bookPnL), 1) * 100 | 0}%</div>
</div>
<div class="card">
<div class="label">回测配置</div>
<div class="value" style="font-size:14px">${freqText}</div>
<div class="sub">${result.n}日 | ${codeText} | ${P.tenorMonths}月期</div>
</div>`;

    const chartsEl = $('btCharts');
    chartsEl.style.display = 'grid';
    void chartsEl.offsetWidth;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            drawBtPnl($('btCanvasPnl'), result);
            drawBtPath($('btCanvasPath'), result, P, result.s0);
            drawBtDecomp($('btCanvasDecomp'), result);
            drawIVvsRV($('btCanvasIVvsRV'), result, P);
        });
    });

    const concEl = $('btConclusion');
    concEl.style.display = 'block';
    const pnlSign = result.bookPnL >= 0 ? 'pos' : 'neg';
    const pnlWord = result.bookPnL >= 0 ? '盈利' : '亏损';
    const decomp = [
        { name: 'Gamma 归因', val: result.bookGammaPnL, desc: '凸性项 −½ΓdS²·N，负债曲率的对冲残差主体' },
        { name: 'Theta 归因', val: result.bookThetaPnL, desc: '时间价值 −Θ/12·N，负债随期限缩短的衰减（卖方收入）' },
        { name: '交易成本', val: -Math.abs(result.totalCost), desc: `单边${costBps}bps × 调仓金额` },
        { name: '未归因项 ε', val: result.bookResidual, desc: '真离散对冲误差：调仓时滞 + 高阶项 + 观察日跳变 + 插值平滑' },
    ];
    const maxGain = decomp.reduce((a, b) => b.val > a.val ? b : a, decomp[0]);
    const maxLoss = decomp.reduce((a, b) => b.val < a.val ? b : a, decomp[0]);
    const residualPct = Math.abs(result.bookResidual) / Math.max(Math.abs(result.bookPnL), 1) * 100;
    const hedgeQuality = residualPct < 20 ? '优秀' : residualPct < 50 ? '可接受' : '较差';
    const hedgeQualityColor = residualPct < 50 ? 'var(--ink)' : 'var(--negative)';
    const volDiff = ((result.realizedVol || 0) - P.vol) * 100;
    const volStd = P.vol * 100;

    let narrative = '';
    narrative = `本回测期间，账本（空头雪球负债 + Delta 对冲）<strong>累计${pnlWord} ${fmtMoney(Math.abs(result.bookPnL))}</strong>（占名义本金 ${pnlPct}%）。`;
    narrative += `分腿看：负债腿盯市 ${result.liabPnL >= 0 ? '收益' : '亏损'} ${fmtMoney(Math.abs(result.liabPnL))}，对冲腿（费前）${result.hedgePnL >= 0 ? '收益' : '亏损'} ${fmtMoney(Math.abs(result.hedgePnL))}，交易成本拖累 ${fmtMoney(Math.abs(result.totalCost))}。`;
    narrative += `标的${result.totalReturn >= 0 ? '上行' : '下行'} ${(Math.abs(result.totalReturn) * 100).toFixed(2)}%。`;
    narrative += `归因主导因素为<strong>${Math.abs(maxGain.val) > Math.abs(maxLoss.val) ? maxGain.name : maxLoss.name}</strong>（${fmtMoney(Math.abs(maxGain.val) > Math.abs(maxLoss.val) ? maxGain.val : maxLoss.val)}），`;
    narrative += `${maxGain.val > 0 ? `主要正贡献来自${maxGain.name}（${fmtMoney(maxGain.val)}）` : '无显著正贡献'}，`;
    narrative += `${maxLoss.val < 0 ? `主要拖累来自${maxLoss.name}（${fmtMoney(maxLoss.val)}）。` : '无显著负贡献。'}`;
    narrative += `未归因项 ε 占账本盈亏 ${residualPct.toFixed(1)}%，对冲质量<strong style="color:${hedgeQualityColor}">${hedgeQuality}</strong>。`;
    if (residualPct >= 50) {
        narrative += `<span style="color:var(--negative)">未归因项超过账本盈亏的 50%，本窗口离散对冲误差偏大（调仓时滞与插值平滑主导），归因结论仅供参考。</span>`;
    }
    if (result.totalCost / Math.max(Math.abs(result.bookPnL), 1) > 0.3) {
        narrative += `交易成本占比较高，可考虑适当降低对冲频率或采用更精细的调仓阈值。`;
    }

    const metrics = calcPerformanceMetrics(result.path, N, P.rf, result.n);
    const annRetPct = metrics.annRet !== undefined ? (metrics.annRet * 100).toFixed(2) : 'N/A';
    const annVolPct = metrics.annVol !== undefined ? (metrics.annVol * 100).toFixed(2) : 'N/A';
    const sharpeStr = metrics.sharpe !== undefined ? metrics.sharpe.toFixed(2) : 'N/A';
    const sortinoStr = metrics.sortino !== undefined ? metrics.sortino.toFixed(2) : 'N/A';
    const calmarStr = metrics.calmar !== undefined ? metrics.calmar.toFixed(2) : 'N/A';
    const winRatePct = metrics.winRate !== undefined ? (metrics.winRate * 100).toFixed(1) : 'N/A';
    const plRatioStr = metrics.plRatio !== undefined ? metrics.plRatio.toFixed(2) : 'N/A';

    const bootCI = bootstrapBacktest(result.path);
    const bootHtml = bootCI.ci90lo !== undefined ? `
<div class="bt-conclusion-block" style="margin-top:10px">
<h5>Bootstrap 置信区间（500次重采样）</h5>
<div class="row"><span class="lbl">90% CI</span><span class="val">[${fmtMoney(bootCI.ci90lo)}, ${fmtMoney(bootCI.ci90hi)}]</span></div>
<div class="row"><span class="lbl">95% CI</span><span class="val">[${fmtMoney(bootCI.ci95lo)}, ${fmtMoney(bootCI.ci95hi)}]</span></div>
<div class="row"><span class="lbl">99% CI</span><span class="val">[${fmtMoney(bootCI.ci99lo)}, ${fmtMoney(bootCI.ci99hi)}]</span></div>
</div>` : '';

    concEl.innerHTML = `
<h4>回测分析报告</h4>
<div class="bt-conclusion-grid">
<div class="bt-conclusion-block">
<h5>关键指标</h5>
<div class="row"><span class="lbl">账本总盈亏</span><span class="val ${pnlSign}">${pnlWord} ${fmtMoney(Math.abs(result.bookPnL))}</span></div>
<div class="row"><span class="lbl">占名义本金</span><span class="val">${pnlPct}%</span></div>
<div class="row"><span class="lbl">年化收益率</span><span class="val">${annRetPct}%</span></div>
<div class="row"><span class="lbl">最大回撤</span><span class="val neg">${fmtMoney(maxDD)}元（占名义 ${(maxDD / N * 100).toFixed(2)}%）</span></div>
<div class="row"><span class="lbl">对冲质量</span><span class="val" style="color:${hedgeQualityColor}">${hedgeQuality}（ε/账本盈亏 ${residualPct.toFixed(1)}%）</span></div>
</div>
<div class="bt-conclusion-block">
<h5>账本归因（四项之和 = 账本盈亏）</h5>
${decomp.map(d => `<div class="row"><span class="lbl">${d.name}</span><span class="val ${d.val >= 0 ? 'pos' : 'neg'}">${d.val >= 0 ? '+' : ''}${fmtMoney(d.val)}元 <span style="font-weight:400;color:var(--ink-muted)">(${(d.val / N * 100).toFixed(2)}%N)</span></span></div>`).join('')}
<div class="row" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border)"><span class="lbl">主要正贡献</span><span class="val pos">${maxGain.name}：${fmtMoney(maxGain.val)}</span></div>
<div class="row"><span class="lbl">主要拖累</span><span class="val neg">${maxLoss.name}：${fmtMoney(maxLoss.val)}</span></div>
</div>
</div>
<div class="bt-performance-table">
<h5>绩效指标表</h5>
<table>
<thead><tr><th>指标</th><th>年化收益率</th><th>年化波动率</th><th>Sharpe</th><th>Sortino</th><th>Calmar</th><th>盈亏比</th><th>胜率</th></tr></thead>
<tbody><tr>
<td style="font-weight:600">数值</td>
<td>${annRetPct}%</td>
<td>${annVolPct}%</td>
<td>${sharpeStr}</td>
<td>${sortinoStr}</td>
<td>${calmarStr}</td>
<td>${plRatioStr}</td>
<td>${winRatePct}%</td>
</tr></tbody></table>
</div>
${bootHtml}
<div class="narrative">
<strong>业务解读</strong>：${narrative}
<br><br>
<strong>波动率参考</strong>：区间已实现波动率 <strong>${(result.realizedVol * 100).toFixed(2)}%</strong> vs 定价波动率 <strong>${volStd.toFixed(2)}%</strong>，差值 <strong>${volDiff >= 0 ? '+' : ''}${volDiff.toFixed(2)}pp</strong>${Math.abs(volDiff) > 3 ? '（偏差偏大，注意风险）' : ''}。雪球卖方最大风险为 Vega（波动率飙升），当前归因不含 Vega 分量，上述对比仅供参考。
<br><br>
本回测模拟卖方发行雪球后以股指期货 Delta 中性对冲的<strong>账本盈亏</strong>（空头负债 + 对冲头寸）。<strong>口径说明</strong>：负债腿逐日按查表 PV 盯市入账（空头方，现值下降为收益），对冲腿为期货持仓损益（费前），账本盈亏 = 两腿之和 − 交易成本；归因恒等式「账本盈亏 = Gamma 归因 + Theta 归因 − 成本 + 未归因项 ε」精确闭合，ε 为真离散对冲误差（对冲腿前一日调仓价与负债一阶项当日 delta 的错位、Taylor 高阶项、月度敲出观察日跳变、查表双线性插值平滑与 MC 残余噪声），阈值 ε 占账本盈亏 &lt;20% 优秀 / &lt;50% 可接受 / ≥50% 超标。<strong>Greeks 查表方案</strong>：552 点（24价×23期）预计算网格 + 双线性插值（Greeks 与 PV 同源同 CRN），4096 路径 MC，自适应价格区间覆盖。回测耗时 <strong>${dt.toFixed(2)}s</strong>。数据来源：${dataFoot()}。
</div>`;
}

// ====== 多频率对比 ======
async function runBacktestMultiFreq() {
    const inputs = await readBtInputs('btMultiFreq');
    if (!inputs) return;
    const { costBps, btNotional, histSlice } = inputs;
    const P = Object.assign({}, lastP, { notional: btNotional });
    const histPrices = histSlice.map(d => d[1]);
    const btS0 = histPrices[0];
    const btP = Object.assign({}, P, { s0: btS0 });
    const N = P.notional * 10000;

    $('btEmpty').style.display = 'none';
    $('btPanel').style.display = 'block';
    $('btCharts').style.display = 'none';
    $('btConclusion').style.display = 'none';
    $('btMultiFreq').style.display = 'none';
    const progWrap = $('btProgress');
    const progFill = $('btProgressFill');
    const progText = $('btProgressText');
    progWrap.style.display = 'flex';
    progFill.style.width = '0%';
    progText.textContent = '建表中…';
    const btn = $('btMultiFreqBtn');
    btn.disabled = true;
    btn.textContent = '对比中…';
    await nextFrame();
    try {
        await ensureBtTable(P, btP, histPrices, progFill, progText);
        const results = [];
        for (let fi = 0; fi < FREQ_LIST.length; fi++) {
            const freq = FREQ_LIST[fi];
            progText.textContent = `回测 ${FREQ_LABELS[freq]} (${fi + 1}/${FREQ_LIST.length})`;
            progFill.style.width = ((fi + 1) / FREQ_LIST.length * 100).toFixed(0) + '%';
            await nextFrame();
            const r = await backtestHedge(P, histSlice, btTableCache, freq, costBps);
            results.push({ freq, label: FREQ_LABELS[freq], result: r });
        }
        progFill.style.width = '100%';
        progText.textContent = '完成 ✓';
        setTimeout(() => { progWrap.style.display = 'none'; }, 800);
        renderMultiFreqComparison(results, P, N, costBps);
    } catch (e) {
        progWrap.style.display = 'none';
        const mfEl = $('btMultiFreq');
        if (mfEl) mfEl.style.display = 'block';
        showComputationError(mfEl, e, runBacktestMultiFreq);
    } finally {
        btn.disabled = false;
        btn.textContent = '多频率对比';
    }
}

function renderMultiFreqComparison(results, P, N, costBps) {
    void P; void costBps;
    const el = $('btMultiFreq');
    el.style.display = 'block';
    const metrics = results.map(r => {
        const pnlPct = (r.result.bookPnL / N * 100);
        const costPct = (r.result.totalCost / N * 100);
        const resPct = (r.result.bookResidual / N * 100);
        return { ...r, pnlPct, costPct, resPct };
    });
    const bestPnl = Math.max(...metrics.map(m => m.result.bookPnL));
    const bestRes = Math.min(...metrics.map(m => Math.abs(m.result.bookResidual)));
    const sorted = [...metrics].sort((a, b) => b.result.bookPnL - a.result.bookPnL);
    const recommend = sorted[0];
    const rowHtml = metrics.map(m => {
        const isPnlBest = m.result.bookPnL === bestPnl;
        const isResBest = Math.abs(m.result.bookResidual) === bestRes;
        return `<tr>
<td style="font-weight:600;color:var(--ink)">${m.label}</td>
<td class="${isPnlBest ? 'best' : (m.result.bookPnL < 0 ? 'worst' : '')}">${fmtMoney(m.result.bookPnL)}元 (${m.pnlPct.toFixed(2)}%N)</td>
<td>${fmtMoney(m.result.liabPnL)}元</td>
<td>${fmtMoney(m.result.hedgePnL)}元</td>
<td class="${m.result.totalCost > 0 ? 'worst' : ''}">${fmtMoney(m.result.totalCost)}元 (${m.costPct.toFixed(2)}%N)</td>
<td class="${isResBest ? 'best' : ''}">${fmtMoney(m.result.bookResidual)}元 (${m.resPct.toFixed(2)}%N)</td>
<td>${fmtMoney(m.result.bookGammaPnL)}元</td>
<td>${fmtMoney(m.result.bookThetaPnL)}元</td>
</tr>`;
    }).join('');
    el.innerHTML = `<h4>多频率对比汇总（账本口径）</h4>
<table>
<thead><tr><th>对冲频率</th><th>账本累计盈亏</th><th>负债腿</th><th>对冲腿(费前)</th><th>交易成本</th><th>未归因项 ε</th><th>Gamma 归因</th><th>Theta 归因</th></tr></thead>
<tbody>${rowHtml}</tbody>
</table>
<div class="recommend"><strong>推荐频率</strong>：<strong>${recommend.label}</strong>（账本盈亏 ${fmtMoney(recommend.result.bookPnL)}元，占名义本金 ${recommend.pnlPct.toFixed(2)}%）
<br>对比结论：${recommend.pnlPct > 0 ? '盈利' : '亏损'} ${Math.abs(recommend.pnlPct).toFixed(2)}% | 成本占账本盈亏 ${(recommend.result.totalCost / Math.max(Math.abs(recommend.result.bookPnL), 1) * 100).toFixed(0)}% | ε/账本盈亏 ${(Math.abs(recommend.result.bookResidual) / Math.max(Math.abs(recommend.result.bookPnL), 1) * 100).toFixed(1)}%（表内括号百分比均为占名义本金 %N）</div>`;
}

// ====== 成本敏感度扫描 ======
async function runCostSensitivity() {
    const inputs = await readBtInputs('btPanel');
    if (!inputs) return;
    const { costBps, btNotional, histSlice } = inputs;
    const freq = $('btFreq').value;
    const P = Object.assign({}, lastP, { notional: btNotional });
    const histPrices = histSlice.map(d => d[1]);
    const btS0 = histPrices[0];
    const btP = Object.assign({}, P, { s0: btS0 });
    const N = P.notional * 10000;

    $('btEmpty').style.display = 'none';
    $('btPanel').style.display = 'block';
    $('btCharts').style.display = 'none';
    $('btConclusion').style.display = 'none';
    $('btMultiFreq').style.display = 'none';
    $('btCostScan').style.display = 'none';
    const progWrap = $('btProgress');
    const progFill = $('btProgressFill');
    const progText = $('btProgressText');
    progWrap.style.display = 'flex';
    progFill.style.width = '0%';
    progText.textContent = '建表中…';
    const btn = $('btCostScanBtn');
    btn.disabled = true;
    btn.textContent = '扫描中…';
    await nextFrame();
    try {
        await ensureBtTable(P, btP, histPrices, progFill, progText);
        const scanResults = [];
        for (let si = 0; si < COST_SCAN_BPS.length; si++) {
            const cb = COST_SCAN_BPS[si];
            progText.textContent = `扫描 ${cb}bps (${si + 1}/${COST_SCAN_BPS.length})`;
            progFill.style.width = ((si + 1) / COST_SCAN_BPS.length * 100).toFixed(0) + '%';
            await nextFrame();
            const r = await backtestHedge(P, histSlice, btTableCache, freq, cb);
            scanResults.push({ costBps: cb, result: r });
        }
        progFill.style.width = '100%';
        progText.textContent = '完成 ✓';
        setTimeout(() => { progWrap.style.display = 'none'; }, 800);
        renderCostSensitivity(scanResults, N, freq);
    } catch (e) {
        showToast('成本扫描出错: ' + e.message);
        progWrap.style.display = 'none';
    } finally {
        btn.disabled = false;
        btn.textContent = '成本扫描';
    }
}

function renderCostSensitivity(scanResults, N, freq) {
    const el = $('btCostScan');
    el.style.display = 'block';
    const data = scanResults.map(s => ({ costBps: s.costBps, cumPnL: s.result.bookPnL, pnlPct: s.result.bookPnL / N * 100 }));
    const breakeven = data.find(d => d.cumPnL <= 0);
    const freqLabel = FREQ_LABELS[freq] || freq;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            drawCostSensitivity($('btCanvasCostScan'), data, N, breakeven, freqLabel);
        });
    });
}

// ====== 滚动窗口回测 ======
function sliceHistByYear(histSlice, year) {
    const prefix = year.toString();
    return histSlice.filter(([d]) => d.startsWith(prefix));
}

async function runRollingWindow() {
    const inputs = await readBtInputs('btPanel');
    if (!inputs) return;
    const { costBps, btNotional, histSlice, startDate, endDate } = inputs;
    const freq = $('btFreq').value;
    const P = Object.assign({}, lastP, { notional: btNotional });
    const histPrices = histSlice.map(d => d[1]);
    const btS0 = histPrices[0];
    const btP = Object.assign({}, P, { s0: btS0 });

    $('btEmpty').style.display = 'none';
    $('btPanel').style.display = 'block';
    $('btCharts').style.display = 'none';
    $('btConclusion').style.display = 'none';
    $('btMultiFreq').style.display = 'none';
    $('btCostScan').style.display = 'none';
    $('btRollingResult').style.display = 'none';
    const progWrap = $('btProgress');
    const progFill = $('btProgressFill');
    const progText = $('btProgressText');
    progWrap.style.display = 'flex';
    progFill.style.width = '0%';
    progText.textContent = '准备中…';
    const btn = $('btRollingBtn');
    btn.disabled = true;
    btn.textContent = '滚动中…';
    await nextFrame();
    try {
        await ensureBtTable(P, btP, histPrices, progFill, progText);
        const years = [];
        const startYear = parseInt(startDate.slice(0, 4));
        const endYear = parseInt(endDate.slice(0, 4));
        for (let y = startYear; y <= endYear; y++) years.push(y);
        const yearResults = [];
        for (let yi = 0; yi < years.length; yi++) {
            const y = years[yi];
            const ySlice = sliceHistByYear(histSlice, y);
            if (ySlice.length < 20) continue;
            const yPrices = ySlice.map(d => d[1]);
            const yS0 = yPrices[0];
            const yP = Object.assign({}, P, { s0: yS0 });
            progText.textContent = `回测 ${y}年 (${yi + 1}/${years.length})`;
            progFill.style.width = ((yi + 1) / years.length * 100).toFixed(0) + '%';
            await nextFrame();
            const r = await backtestHedge(yP, ySlice, btTableCache, freq, costBps);
            yearResults.push({ year: y, result: r, N: yP.notional * 10000 });
        }
        progFill.style.width = '100%';
        progText.textContent = '完成 ✓';
        setTimeout(() => { progWrap.style.display = 'none'; }, 800);
        renderRollingWindow(yearResults);
    } catch (e) {
        showToast('滚动窗口回测出错: ' + e.message);
        progWrap.style.display = 'none';
    } finally {
        btn.disabled = false;
        btn.textContent = '滚动窗口';
    }
}

function renderRollingWindow(yearResults) {
    const el = $('btRollingResult');
    el.style.display = 'block';
    const rows = yearResults.map(r => {
        const pnlPct = (r.result.bookPnL / r.N * 100);
        const cls = r.result.bookPnL >= 0 ? 'best' : 'worst';
        return `<tr>
<td style="font-weight:600;color:var(--ink)">${r.year}</td>
<td class="${cls}">${fmtMoney(r.result.bookPnL)}元 (${pnlPct.toFixed(2)}%N)</td>
<td>${fmtMoney(r.result.liabPnL)}元</td>
<td>${fmtMoney(r.result.hedgePnL)}元</td>
<td>${fmtMoney(r.result.bookGammaPnL)}元</td>
<td>${fmtMoney(r.result.bookThetaPnL)}元</td>
<td>${fmtMoney(r.result.totalCost)}元</td>
<td>${fmtMoney(r.result.bookResidual)}元</td>
<td>${(r.result.realizedVol * 100).toFixed(2)}%</td>
</tr>`;
    }).join('');
    const totalPnl = yearResults.reduce((s, r) => s + r.result.bookPnL, 0);
    const avgPnl = totalPnl / yearResults.length;
    const bestYear = yearResults.reduce((a, b) => a.result.bookPnL > b.result.bookPnL ? a : b, yearResults[0]);
    const worstYear = yearResults.reduce((a, b) => a.result.bookPnL < b.result.bookPnL ? a : b, yearResults[0]);
    el.innerHTML = `<h4>滚动窗口回测（逐年对比，账本口径）</h4>
<p style="font-size:11px;color:var(--ink-muted);margin-bottom:10px">逐年运行回测，对比各年份的账本对冲表现（负债腿盯市 + 对冲腿）。各年独立 s0 = 每年首日价格。</p>
<table>
<thead><tr><th>年份</th><th>账本累计盈亏</th><th>负债腿</th><th>对冲腿(费前)</th><th>Gamma 归因</th><th>Theta 归因</th><th>交易成本</th><th>未归因项 ε</th><th>已实现波动率</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="recommend"><strong>汇总</strong>：合计 ${fmtMoney(totalPnl)}元 | 年均 ${fmtMoney(avgPnl)}元 | 最佳年份 <strong>${bestYear.year}</strong>（${fmtMoney(bestYear.result.bookPnL)}元） | 最差年份 <strong>${worstYear.year}</strong>（${fmtMoney(worstYear.result.bookPnL)}元）</div>`;
}

// ====== 主题切换重绘 ======
function redrawOnThemeChange() {
    // 定价区：整体重渲染
    if (lastP && lastMC && lastGreeks) {
        try { renderPricingResults(lastP, lastMC, lastGreeks, 0); } catch (e) { console.error('主题切换重绘失败:', e); }
    }
    // 回测区：重绘四图 + 成本扫描
    if (btLastResult) {
        requestAnimationFrame(() => {
            drawBtPnl($('btCanvasPnl'), btLastResult.result);
            drawBtPath($('btCanvasPath'), btLastResult.result, btLastResult.P, btLastResult.result.s0);
            drawBtDecomp($('btCanvasDecomp'), btLastResult.result);
            drawIVvsRV($('btCanvasIVvsRV'), btLastResult.result, btLastResult.P);
        });
    }
    // 压测区：重绘矩阵
    if (lastStress) {
        const cv = $('stressMatrixCanvas');
        if (cv && $('stressResults').style.display !== 'none') {
            drawStressMatrix(cv, lastStress.matrixResults, lastStress.P);
        }
    }
}

// ====== 初始化 ======
export async function initPanels() {
    initWorkers();
    $('form').addEventListener('submit', onSubmit);
    $('runStressBtn').addEventListener('click', runStressTestAll);

    document.addEventListener('sb7:tab-changed', (e) => {
        if (e.detail.tab === 'backtest') initBacktestPanel();
        if (e.detail.tab === 'stress') updateStressParamsSummary();
    });
    document.addEventListener('sb7:theme-changed', redrawOnThemeChange);
    document.addEventListener('sb7:preset-loaded', () => {
        if (btInitialized) syncBtFromPricing();
    });
}
