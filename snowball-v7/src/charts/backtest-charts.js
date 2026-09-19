// backtest-charts.js - 回测 Tab 5 图（规格见 docs/v7-charts-spec.md §C）
import { beginDraw, makePads, drawGridH, drawYAxisTitle, fmtMoneyAxis, fmtDateShort } from './kit.js';

// ====== C1. 账本累计盈亏曲线（主=账本，虚=负债腿/对冲腿/成本） ======
export function drawBtPnl(cv, result) {
    const { ctx, W, H, th } = beginDraw(cv);

    const path = result.path;
    if (!path || path.length === 0) {
        ctx.fillStyle = th.text; ctx.font = '14px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('无回测数据', W / 2, H / 2);
        return;
    }

    const pad = makePads({ L: 70, R: 130, T: 18, B: 44 });
    const x0 = pad.L, y0 = H - pad.B, x1 = W - pad.R, y1 = pad.T;
    const plotW = x1 - x0, plotH = y0 - y1;
    const n = path.length;

    const bookSeries = path.map(p => p.bookCumPnL);
    const liabSeries = path.map(p => p.liabCumPnL);
    const hedgeSeries = path.map(p => p.cumPnL);
    const finalC = result.totalCost;
    const cPath = [];
    for (let i = 0; i < n; i++) {
        cPath.push(finalC * (i / (n - 1)));
    }

    let yMin = Infinity, yMax = -Infinity;
    const allVals = [bookSeries, liabSeries, hedgeSeries, cPath].flat();
    for (const v of allVals) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
    }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const yPad = (yMax - yMin) * 0.1;
    yMin -= yPad; yMax += yPad;

    const xAt = i => x0 + i / Math.max(1, n - 1) * plotW;
    const yAt = v => y0 - (v - yMin) / (yMax - yMin) * plotH;

    drawGridH(ctx, x0, x1, y0, y1, 5, i => fmtMoneyAxis(yMin + (yMax - yMin) * i / 5), th);

    const yZero = yAt(0);
    if (yZero > y1 && yZero < y0) {
        ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x0, yZero); ctx.lineTo(x1, yZero); ctx.stroke();
        ctx.setLineDash([]);
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xTicks = Math.min(6, n);
    for (let i = 0; i < xTicks; i++) {
        const idx = Math.floor(i * (n - 1) / (xTicks - 1));
        const x = xAt(idx);
        ctx.fillText(fmtDateShort(path[idx].date), x, y0 + 6);
    }

    const drawLine = (arr, color, dash) => {
        ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const x = xAt(i), y = yAt(arr[i]);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    };
    drawLine(liabSeries, '#6a4c93', [5, 3]);
    drawLine(hedgeSeries, '#888888', [5, 3]);
    drawLine(cPath, th.text, [2, 2]);

    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const x = xAt(i), y = yAt(bookSeries[i]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = result.bookPnL >= 0 ? '#2d6a4f' : '#9b2226';
    ctx.stroke();

    ctx.lineTo(xAt(n - 1), yZero);
    ctx.lineTo(xAt(0), yZero);
    ctx.closePath();
    ctx.fillStyle = result.bookPnL >= 0 ? 'rgba(45,106,79,0.12)' : 'rgba(155,34,38,0.12)';
    ctx.fill();

    ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();

    drawYAxisTitle(ctx, '账本累计盈亏 (元)', 14, (y0 + y1) / 2);
    ctx.fillStyle = '#666'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('日期', x1, y0 + 24);

    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#333';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('账本累计盈亏曲线', x0, y1 - 6);

    const items = [
        { c: result.bookPnL >= 0 ? '#2d6a4f' : '#9b2226', label: '账本盈亏', val: result.bookPnL, dash: [] },
        { c: '#6a4c93', label: '负债腿(盯市)', val: result.liabPnL, dash: [5, 3] },
        { c: '#888888', label: '对冲腿(费前)', val: result.hedgePnL, dash: [5, 3] },
        { c: th.text, label: '交易成本', val: result.totalCost, dash: [2, 2] },
    ];
    ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle';
    let ly = y1 + 4;
    for (const it of items) {
        ctx.strokeStyle = it.c; ctx.lineWidth = 1.5; ctx.setLineDash(it.dash);
        ctx.beginPath(); ctx.moveTo(x1 + 6, ly); ctx.lineTo(x1 + 26, ly); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = th.textStrong; ctx.textAlign = 'left';
        ctx.fillText(it.label, x1 + 30, ly);
        ctx.fillStyle = it.c; ctx.textAlign = 'right';
        ctx.fillText(fmtMoneyAxis(it.val), x1 + 120, ly);
        ly += 16;
    }
}

// ====== C2. 标的路径 + 障碍线 + Delta 次轴 ======
export function drawBtPath(cv, result, P, btS0) {
    const { ctx, W, H, th } = beginDraw(cv);

    const path = result.path;
    if (!path || path.length === 0) return;
    const n = path.length;

    const pad = makePads({ L: 70, R: 70, T: 18, B: 44 });
    const x0 = pad.L, y0 = H - pad.B, x1 = W - pad.R, y1 = pad.T;
    const plotW = x1 - x0, plotH = y0 - y1;

    let pMin = Infinity, pMax = -Infinity;
    for (const p of path) {
        if (p.S < pMin) pMin = p.S;
        if (p.S > pMax) pMax = p.S;
    }
    const s0 = btS0;
    const kiPrice = P.kiPct * s0;
    const koPrice = (P.koMode === 'descending' ? P.koStartPct : P.koPct) * s0;
    pMin = Math.min(pMin, kiPrice);
    pMax = Math.max(pMax, koPrice, s0);
    const pPad = (pMax - pMin) * 0.08;
    pMin -= pPad; pMax += pPad;

    let dMin = Infinity, dMax = -Infinity;
    for (const p of path) {
        if (p.delta < dMin) dMin = p.delta;
        if (p.delta > dMax) dMax = p.delta;
    }
    if (dMin === dMax) { dMin -= 0.1; dMax += 0.1; }
    dMin = Math.min(dMin, -0.05); dMax = Math.max(dMax, 0.05);

    const xAt = i => x0 + i / Math.max(1, n - 1) * plotW;
    const yAt = v => y0 - (v - pMin) / (pMax - pMin) * plotH;
    const yAtD = v => y0 - (v - dMin) / (dMax - dMin) * plotH;

    drawGridH(ctx, x0, x1, y0, y1, 5, i => (pMin + (pMax - pMin) * i / 5).toFixed(1), th);

    const drawHLine = (val, color, label, dash, yOff) => {
        const y = yAt(val);
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(dash || []);
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color; ctx.font = '10px sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(label, x0 + 4, y - 2 + (yOff || 0));
    };
    // S₀ 与敲出价同位时错开标签防重叠
    const koNearS0 = Math.abs(yAt(koPrice) - yAt(s0)) < 14;
    drawHLine(s0, th.accent, `S₀=${s0.toFixed(2)}`, [4, 3], koNearS0 ? -14 : 0);
    drawHLine(kiPrice, th.negative, `敲入 ${kiPrice.toFixed(2)} (${(P.kiPct * 100).toFixed(0)}%)`, []);
    drawHLine(koPrice, th.gold, `敲出 ${koPrice.toFixed(2)} (${((P.koMode === 'descending' ? P.koStartPct : P.koPct) * 100).toFixed(0)}%)`, []);

    ctx.fillStyle = th.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xTicks = Math.min(6, n);
    for (let i = 0; i < xTicks; i++) {
        const idx = Math.floor(i * (n - 1) / (xTicks - 1));
        const x = xAt(idx);
        ctx.fillText(fmtDateShort(path[idx].date), x, y0 + 6);
    }

    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const x = xAt(i), y = yAt(path[i].S);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = '#6a4c93'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const x = xAt(i), y = yAtD(path[i].delta);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#6a4c93'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
        const v = dMin + (dMax - dMin) * i / 4;
        const y = yAtD(v);
        ctx.fillText(v.toFixed(2), x1 + 4, y);
    }

    ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();

    drawYAxisTitle(ctx, '标的价格', 14, (y0 + y1) / 2);
    ctx.save(); ctx.translate(W - 8, (y0 + y1) / 2); ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#6a4c93'; ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Delta', 0, 0);
    ctx.restore();
    ctx.fillStyle = '#666'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('日期', x1, y0 + 24);

    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#333';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('标的价格路径与 Delta 持仓', x0, y1 - 6);
}

// ====== C3. 账本盈亏归因柱状图（四项之和 = 账本盈亏） ======
export function drawBtDecomp(cv, result) {
    const { ctx, W, H, th } = beginDraw(cv);

    const pad = makePads({ L: 70, R: 30, T: 30, B: 50 });
    const x0 = pad.L, y0 = H - pad.B, x1 = W - pad.R, y1 = pad.T;
    const plotW = x1 - x0, plotH = y0 - y1;

    const items = [
        { label: 'Gamma 归因', val: result.bookGammaPnL },
        { label: 'Theta 归因', val: result.bookThetaPnL },
        { label: '交易成本', val: -Math.abs(result.totalCost) },
        { label: '未归因项 ε', val: result.bookResidual },
    ];

    let yMin = 0, yMax = 0;
    for (const it of items) {
        if (it.val < yMin) yMin = it.val;
        if (it.val > yMax) yMax = it.val;
    }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const yPad = (yMax - yMin) * 0.15;
    yMin -= yPad; yMax += yPad;

    const yAt = v => y0 - (v - yMin) / (yMax - yMin) * plotH;
    const barW = plotW / items.length * 0.55;
    const gap = plotW / items.length;

    drawGridH(ctx, x0, x1, y0, y1, 5, i => fmtMoneyAxis(yMin + (yMax - yMin) * i / 5), th);

    const yZero = yAt(0);
    ctx.strokeStyle = th.text; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x0, yZero); ctx.lineTo(x1, yZero); ctx.stroke();

    items.forEach((it, i) => {
        const cx = x0 + gap * (i + 0.5);
        const yTop = yAt(Math.max(0, it.val));
        const yBot = yAt(Math.min(0, it.val));
        const h = Math.max(1, Math.abs(yBot - yTop));
        const color = it.val >= 0 ? '#2d6a4f' : '#9b2226';
        ctx.fillStyle = color;
        ctx.fillRect(cx - barW / 2, yTop, barW, h);

        ctx.fillStyle = color; ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        if (it.val >= 0) {
            ctx.textBaseline = 'bottom';
            ctx.fillText(fmtMoneyAxis(it.val), cx, yTop - 4);
        } else {
            ctx.textBaseline = 'top';
            ctx.fillText(fmtMoneyAxis(it.val), cx, yBot + 4);
        }

        ctx.fillStyle = th.textStrong; ctx.font = '11px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(it.label, cx, y0 + 8);
    });

    ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();

    drawYAxisTitle(ctx, '金额 (元)', 14, (y0 + y1) / 2);

    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#333';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('账本盈亏归因分解', x0, y1 - 8);

    ctx.font = '11px sans-serif'; ctx.fillStyle = '#666';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(`账本合计: ${fmtMoneyAxis(result.bookPnL)}`, x1, y1 - 8);
}

// ====== C4. IV vs RV（含滚动 RV20/60） ======
export function drawIVvsRV(cv, result, P) {
    const { ctx, W, H, th } = beginDraw(cv);

    const rv20 = result.rv20;
    const rv60 = result.rv60;
    if (!rv20 || rv20.length === 0) {
        ctx.fillStyle = th.text; ctx.font = '14px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('无滚动波动率数据', W / 2, H / 2);
        return;
    }

    const iv = P.vol;

    const pad = makePads({ L: 60, R: 26, T: 32, B: 44 });
    const x0 = pad.L, y0 = H - pad.B, x1 = W - pad.R, y1 = pad.T;
    const plotW = x1 - x0, plotH = y0 - y1;

    let yMin = Infinity, yMax = -Infinity;
    for (const pt of rv20) {
        if (pt.rv < yMin) yMin = pt.rv;
        if (pt.rv > yMax) yMax = pt.rv;
    }
    for (const pt of rv60) {
        if (pt.rv < yMin) yMin = pt.rv;
        if (pt.rv > yMax) yMax = pt.rv;
    }
    yMin = Math.min(yMin, iv);
    yMax = Math.max(yMax, iv);
    if (yMin === yMax) { yMin -= 0.05; yMax += 0.05; }
    const yPad = (yMax - yMin) * 0.12;
    yMin -= yPad; yMax += yPad;

    const n = rv20.length;
    const xAt = i => x0 + i / Math.max(1, n - 1) * plotW;
    const yAt = v => y0 - (v - yMin) / (yMax - yMin) * plotH;

    drawGridH(ctx, x0, x1, y0, y1, 5, i => ((yMin + (yMax - yMin) * i / 5) * 100).toFixed(1) + '%', th);

    const ivY = yAt(iv);
    ctx.strokeStyle = th.negative; ctx.lineWidth = 2; ctx.setLineDash([6, 3]);
    ctx.beginPath(); ctx.moveTo(x0, ivY); ctx.lineTo(x1, ivY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = th.negative; ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('IV (定价σ) = ' + (iv * 100).toFixed(1) + '%', x1 - 4, ivY - 3);

    ctx.strokeStyle = '#2d6a4f'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const x = xAt(i), y = yAt(rv20[i].rv);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = '#3498db'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath();
    const n60 = rv60.length;
    for (let i = 0; i < n60; i++) {
        const x = x0 + (rv60[i].idx - rv60[0].idx) / (rv60[n60 - 1].idx - rv60[0].idx) * plotW;
        const y = yAt(rv60[i].rv);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 散点：单一蓝色（红绿仅用于盈亏语义）
    const step = Math.max(1, Math.floor(n / 80));
    for (let i = 0; i < n; i += step) {
        const x = xAt(i), y = yAt(rv20[i].rv);
        ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = th.series[4]; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.5;
        ctx.stroke();
    }

    ctx.fillStyle = th.text; ctx.font = '9px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xTicks = Math.min(6, n);
    for (let i = 0; i < xTicks; i++) {
        const idx = Math.floor(i * (n - 1) / (xTicks - 1));
        const x = xAt(idx);
        ctx.fillText(fmtDateShort(rv20[idx].date), x, y0 + 6);
    }
    ctx.fillStyle = th.text; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('日期', x1, y0 + 24);

    ctx.save(); ctx.translate(14, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = th.text; ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('波动率 (年化%)', 0, 0);
    ctx.restore();

    ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0);
    ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();

    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = th.textStrong;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('IV vs RV 波动率对比', x0, y1 - 6);

    const leg = [
        { c: '#2d6a4f', label: 'RV20', dash: false },
        { c: '#3498db', label: 'RV60', dash: true },
        { c: th.negative, label: 'IV', dash: true },
    ];
    ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle';
    let lx = x0 + 8;
    for (const it of leg) {
        ctx.strokeStyle = it.c; ctx.lineWidth = 2;
        ctx.setLineDash(it.dash ? [4, 3] : []);
        ctx.beginPath(); ctx.moveTo(lx, y1 - 6); ctx.lineTo(lx + 14, y1 - 6); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = th.textStrong; ctx.textAlign = 'left';
        ctx.fillText(it.label, lx + 18, y1 - 6);
        lx += ctx.measureText(it.label).width + 30;
    }
}

// ====== C5. 成本敏感度扫描 ======
export function drawCostSensitivity(cv, data, N, breakeven, freqLabel) {
    const { ctx, W, H, th } = beginDraw(cv);

    const pad = makePads({ L: 70, R: 120, T: 30, B: 50 });
    const x0 = pad.L, y0 = H - pad.B, x1 = W - pad.R, y1 = pad.T;
    const plotW = x1 - x0, plotH = y0 - y1;

    const xMin = Math.min(...data.map(d => d.costBps));
    const xMax = Math.max(...data.map(d => d.costBps));
    let yMin = Math.min(...data.map(d => d.cumPnL));
    let yMax = Math.max(...data.map(d => d.cumPnL));
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const yPad = (yMax - yMin) * 0.15;
    yMin -= yPad; yMax += yPad;

    const xAt = v => x0 + (v - xMin) / (xMax - xMin) * plotW;
    const yAt = v => y0 - (v - yMin) / (yMax - yMin) * plotH;

    drawGridH(ctx, x0, x1, y0, y1, 5, i => fmtMoneyAxis(yMin + (yMax - yMin) * i / 5), th);

    const yZero = yAt(0);
    if (yZero > y1 && yZero < y0) {
        ctx.strokeStyle = th.text; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
        ctx.beginPath(); ctx.moveTo(x0, yZero); ctx.lineTo(x1, yZero); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = th.text; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText('盈亏平衡线', x1 - 60, yZero - 3);
    }

    ctx.strokeStyle = '#2d6a4f'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const x = xAt(data[i].costBps), y = yAt(data[i].cumPnL);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.lineTo(xAt(data[data.length - 1].costBps), yZero);
    ctx.lineTo(xAt(data[0].costBps), yZero);
    ctx.closePath();
    ctx.fillStyle = 'rgba(45,106,79,0.1)';
    ctx.fill();

    for (const d of data) {
        const x = xAt(d.costBps), y = yAt(d.cumPnL);
        ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = d.cumPnL >= 0 ? '#2d6a4f' : '#9b2226';
        ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = th.textStrong; ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(fmtMoneyAxis(d.cumPnL), x, y - 8);
    }

    if (breakeven) {
        const bx = xAt(breakeven.costBps), by = yAt(0);
        ctx.strokeStyle = th.negative; ctx.lineWidth = 2; ctx.setLineDash([4, 2]);
        ctx.beginPath(); ctx.moveTo(bx, y0); ctx.lineTo(bx, y1); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = th.negative; ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(`盈亏平衡 ≈ ${breakeven.costBps}bps`, bx, y1 + 4);
    }

    ctx.fillStyle = th.textStrong; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const d of data) {
        ctx.fillText(d.costBps + 'bps', xAt(d.costBps), y0 + 6);
    }

    ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();

    ctx.save(); ctx.translate(14, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = th.text; ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('账本累计盈亏 (元)', 0, 0);
    ctx.restore();
    ctx.fillStyle = th.text; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('单边成本 (bps)', x1, y0 + 24);

    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = th.textStrong;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('成本敏感性扫描（账本口径）', x0, y1 - 6);

    const freqText = freqLabel || '';
    ctx.font = '10px sans-serif'; ctx.fillStyle = th.text;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`对冲频率: ${freqText} | 名义本金: ${fmtMoneyAxis(N)}`, x0, y1 - 18);
}
