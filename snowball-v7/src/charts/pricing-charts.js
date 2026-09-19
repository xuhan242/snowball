// pricing-charts.js - 定价 Tab 8 图（规格见 docs/v7-charts-spec.md §B）
import { beginDraw, setupCanvas, getCanvasTheme, makePads, drawGridH, drawYAxisTitle, drawAxes, colorScale, drawColorBar, fmtMoneyAxis } from './kit.js';

// ====== B1. CEV 局部波动率曲线 ======
export function drawVolCurve(cv, P) {
    if (!P.useLocalVol) { cv.style.display = 'none'; return; }
    cv.style.display = 'block';
    const { ctx, w, h } = setupCanvas(cv);
    const th = getCanvasTheme();
    const ml = 68, mr = 25, mt = 16, mb = 32;
    const x0 = ml, y0 = h - mb, x1 = w - mr, y1 = mt;
    const mMin = 0.65, mMax = 1.15;
    ctx.clearRect(0, 0, w * 2, h * 2);
    drawAxes(ctx, x0, y0, x1, y1, "标的/期初价 (S/S₀)", "局部波动率 (%)");
    // 网格
    ctx.strokeStyle = th.grid; ctx.fillStyle = th.text; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let gx = 0.7; gx <= 1.1; gx += 0.1) {
        const px = x0 + (gx - mMin) / (mMax - mMin) * (x1 - x0);
        ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
        ctx.fillText((gx * 100).toFixed(0) + "%", px, y0 + 4);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const vMin = Math.max(0, P.vol * 100 - 10), vMax = P.vol * 100 + 15;
    for (let gy = Math.ceil(vMin); gy <= vMax; gy += 5) {
        const py = y0 - (gy - vMin) / (vMax - vMin) * (y0 - y1);
        ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
        ctx.fillStyle = th.text; ctx.fillText(gy.toFixed(0) + "%", x0 - 4, py);
    }
    // CEV 曲线
    const n = 200;
    ctx.strokeStyle = th.series[0]; ctx.lineWidth = 2.5; ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const m = mMin + (mMax - mMin) * i / (n - 1);
        const lv = P.vol * (1 / m) * 100;
        const px = x0 + (m - mMin) / (mMax - mMin) * (x1 - x0);
        const py = y0 - (lv - vMin) / (vMax - vMin) * (y0 - y1);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
    // 关键位标注：白底标签 + 竖虚线
    function mark(shortLabel, money, color, textOffsetY) {
        const lv = P.vol * (1 / money) * 100;
        const px = x0 + (money - mMin) / (mMax - mMin) * (x1 - x0);
        const py = y0 - (lv - vMin) / (vMax - vMin) * (y0 - y1);
        ctx.strokeStyle = color; ctx.setLineDash([2, 2]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, y0); ctx.stroke();
        ctx.setLineDash([]);
        const txt = shortLabel + lv.toFixed(1) + "%";
        ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        const tw = ctx.measureText(txt).width;
        const ty = py - 6 + (textOffsetY || 0);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(px - tw / 2 - 3, ty - 13, tw + 6, 15);
        ctx.fillStyle = color;
        ctx.fillText(txt, px, ty);
    }
    mark("敲入 σ=", P.kiPct, th.negative);
    const koMoney = P.koMode === 'descending' ? P.koStartPct : P.koPct;
    const atmPx = x0 + (1.0 - mMin) / (mMax - mMin) * (x1 - x0);
    const koPx = x0 + (koMoney - mMin) / (mMax - mMin) * (x1 - x0);
    mark("ATM σ=", 1.0, th.series[0], Math.abs(atmPx - koPx) < 55 ? -16 : 0);
    mark("敲出 σ=", koMoney, th.gold);
    // 常数 vol 参考线
    ctx.strokeStyle = th.text; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath();
    const cpy = y0 - (P.vol * 100 - vMin) / (vMax - vMin) * (y0 - y1);
    ctx.moveTo(x0, cpy); ctx.lineTo(x1, cpy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = th.text; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText("常数σ", x1 - 40, cpy - 2);
}

// ====== B2. Greeks 二维曲面热力图 ======
export function drawGreeksHeatmap(cv, surface, greekKey, P) {
    const { ctx, w, h } = setupCanvas(cv, { willReadFrequently: true });
    const th = getCanvasTheme();
    const { priceGrid, tenorGrid, data } = surface;
    const nP = priceGrid.length, nT = tenorGrid.length;
    const N = P.notional * 10000;

    const cashData = {};
    const vals = [];
    for (let pi = 0; pi < nP; pi++) {
        for (let ti = 0; ti < nT; ti++) {
            const g = data[pi + '_' + ti];
            if (!g) continue;
            const S = priceGrid[pi] * P.s0;
            let v;
            switch (greekKey) {
                case 'delta': v = g.delta * 0.01 * S * N; break;
                case 'gamma': v = g.gamma * 0.01 * S * N; break;
                case 'vega': v = g.vega * N; break;
                case 'theta': v = g.theta / 12 * N; break;
                default: v = g[greekKey];
            }
            cashData[pi + '_' + ti] = v;
            vals.push(v);
        }
    }
    if (vals.length === 0) {
        ctx.fillStyle = th.text; ctx.font = '14px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('暂无数据', w / 2, h / 2); return;
    }
    const vmin = Math.min(...vals), vmax = Math.max(...vals);

    const pad = makePads({ L: 52, R: 90, T: 52, B: 44 });
    const plotW = w - pad.L - pad.R, plotH = h - pad.T - pad.B;
    const cellW = plotW / nT, cellH = plotH / nP;

    ctx.fillStyle = th.bg;
    ctx.fillRect(pad.L, pad.T, plotW, plotH);

    const kiRatio = P.kiPct, koRatio = P.koMode === 'descending' ? P.koStartPct : P.koPct;
    const findPi = r => { let p = 0; for (let i = 0; i < nP; i++) { if (Math.abs(priceGrid[i] - r) < Math.abs(priceGrid[p] - r)) p = i; } return p; };
    const koPi = findPi(koRatio), s0Pi = findPi(1.0), kiPi = findPi(kiRatio);

    // 第1层：格子填充 + 边框
    const labels = [];
    for (let pi = 0; pi < nP; pi++) {
        for (let ti = 0; ti < nT; ti++) {
            const v = cashData[pi + '_' + ti];
            if (v === undefined) continue;
            const x = pad.L + ti * cellW;
            const y = pad.T + (nP - 1 - pi) * cellH;
            ctx.fillStyle = colorScale(v, vmin, vmax);
            ctx.fillRect(x, y, cellW, cellH);
            ctx.strokeStyle = 'rgba(150,150,150,0.55)';
            ctx.lineWidth = 0.8;
            ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
            const absMax = Math.max(Math.abs(vmin), Math.abs(vmax), 1e-9);
            const intensity = Math.abs(v / absMax);
            let label;
            const av = Math.abs(v);
            if (av >= 1e8) label = (v / 1e8).toFixed(1) + '亿';
            else if (av >= 1e4) label = (v / 1e4).toFixed(1) + '万';
            else if (av >= 100) label = Math.round(v).toString();
            else if (av >= 10) label = Math.round(v).toString();
            else if (av >= 1) label = v.toFixed(1);
            else label = '0';
            const showBadge = cellW >= 32 || intensity > 0.25 || av >= 1000;
            if (!showBadge) continue;
            const txtColor = intensity > 0.45 ? '#fff' : '#1a1a1a';
            const badgeBg = intensity > 0.45 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.75)';
            const fontSize = cellW < 40 ? 8 : cellW < 55 ? 9 : 10;
            labels.push({ x: x + cellW / 2, y: y + cellH / 2, label, txtColor, badgeBg, fontSize });
        }
    }

    ctx.strokeStyle = th.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.L + 0.5, pad.T + 0.5, plotW - 1, plotH - 1);

    // 第2层：边界线（KO/KI 2.5px 实线，S₀ 1.6px 虚线）
    const drawBoundary = (pi, color, lw) => {
        const cy = pad.T + (nP - 1 - pi + 0.5) * cellH;
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(pad.L, cy);
        ctx.lineTo(pad.L + plotW, cy);
        ctx.stroke();
    };
    const drawDash = (pi, color) => {
        const cy = pad.T + (nP - 1 - pi + 0.5) * cellH;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.moveTo(pad.L, cy);
        ctx.lineTo(pad.L + plotW, cy);
        ctx.stroke();
        ctx.setLineDash([]);
    };
    drawBoundary(koPi, th.gold, 2.5);
    drawBoundary(kiPi, th.negative, 2.5);
    drawDash(s0Pi, th.accent);

    // 第3层：数值 badge
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const lb of labels) {
        ctx.font = 'bold ' + lb.fontSize + 'px sans-serif';
        const tw = ctx.measureText(lb.label).width;
        const pad2 = lb.fontSize >= 9 ? 8 : 5;
        const bh = lb.fontSize + 5;
        const bw = Math.min(tw + pad2, cellW - 2);
        const bx = lb.x - bw / 2, by = lb.y - bh / 2;
        const r = 3;
        ctx.beginPath();
        ctx.moveTo(bx + r, by);
        ctx.lineTo(bx + bw - r, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
        ctx.lineTo(bx + bw, by + bh - r);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
        ctx.lineTo(bx + r, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
        ctx.lineTo(bx, by + r);
        ctx.quadraticCurveTo(bx, by, bx + r, by);
        ctx.closePath();
        ctx.fillStyle = lb.badgeBg;
        ctx.fill();
        ctx.fillStyle = lb.txtColor;
        ctx.fillText(lb.label, lb.x, lb.y);
    }

    // Y 轴（价格比）
    ctx.fillStyle = th.textStrong;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let pi = 0; pi < nP; pi++) {
        const cy = pad.T + (nP - 1 - pi + 0.5) * cellH;
        ctx.fillText(priceGrid[pi].toFixed(2), pad.L - 5, cy);
    }
    ctx.save();
    ctx.translate(12, pad.T + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S/S₀', 0, 0);
    ctx.restore();

    // X 轴（期限）
    ctx.fillStyle = th.textStrong;
    const xFontSize = cellW < 30 ? 8 : cellW < 45 ? 9 : 10;
    ctx.font = xFontSize + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xLabelMinGap = xFontSize * 3.2;
    let lastX = -999;
    for (let ti = 0; ti < nT; ti++) {
        const cx = pad.L + (ti + 0.5) * cellW;
        const label = tenorGrid[ti] + '月';
        const tw = ctx.measureText(label).width;
        if (cx - lastX < Math.max(xLabelMinGap, tw + 4) && ti > 0 && ti < nT - 1) continue;
        ctx.fillText(label, cx, pad.T + plotH + 6);
        lastX = cx;
    }
    const lastTi = nT - 1;
    const lastCx = pad.L + (lastTi + 0.5) * cellW;
    if (lastCx - lastX > 10) {
        ctx.fillText(tenorGrid[lastTi] + '月', lastCx, pad.T + plotH + 6);
    }
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('剩余期限', pad.L + plotW / 2, h - 10);

    drawColorBar(ctx, pad.L + plotW + 10, pad.T, 14, plotH, vmin, vmax);

    // 标题 + 图例
    const greekLabel = { delta: 'Delta', gamma: 'Gamma', vega: 'Vega', theta: 'Theta' }[greekKey] || greekKey;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${greekLabel} 二维曲面`, pad.L, pad.T - 8);

    const legendY = pad.T - 8;
    let lx = pad.L + ctx.measureText(`${greekLabel} 二维曲面`).width + 16;
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'bottom';
    const drawLegendItem = (color, text, isDash) => {
        ctx.fillStyle = color;
        ctx.fillRect(lx, legendY - 10, 12, 3);
        if (isDash) {
            ctx.strokeStyle = color;
            ctx.setLineDash([3, 2]);
            ctx.strokeRect(lx, legendY - 10, 12, 3);
            ctx.setLineDash([]);
        }
        ctx.fillStyle = th.textStrong;
        ctx.textAlign = 'left';
        ctx.fillText(text, lx + 16, legendY);
        lx += ctx.measureText(text).width + 28;
    };
    drawLegendItem(th.gold, `KO ${(koRatio * 100).toFixed(0)}%`, false);
    drawLegendItem(th.accent, 'S₀', true);
    drawLegendItem(th.negative, `KI ${(kiRatio * 100).toFixed(0)}%`, false);
}

// ====== B3. ATM 远期 Greeks ======
export function drawForwardGreeks(cv, surface, P) {
    const { ctx, W, H, th } = beginDraw(cv);

    const { priceGrid, tenorGrid, data } = surface;
    if (!data || !tenorGrid || tenorGrid.length === 0) {
        ctx.fillStyle = th.text; ctx.font = '14px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('请先生成 Greeks 曲面', W / 2, H / 2);
        return;
    }

    let atmPi = 0;
    for (let i = 0; i < priceGrid.length; i++) {
        if (Math.abs(priceGrid[i] - 1.0) < Math.abs(priceGrid[atmPi] - 1.0)) atmPi = i;
    }

    const N = P.notional * 10000;
    const series = { delta: [], gamma: [], vega: [], theta: [] };
    const labels = { delta: 'Delta', gamma: 'Gamma', vega: 'Vega', theta: 'Theta' };
    const colors = { delta: '#2d6a4f', gamma: '#e67e22', vega: '#c0392b', theta: '#3498db' };
    let valid = 0;
    for (let ti = 0; ti < tenorGrid.length; ti++) {
        const g = data[atmPi + '_' + ti];
        if (!g) continue;
        const S = P.s0 * priceGrid[atmPi];
        series.delta.push({ x: tenorGrid[ti], y: g.delta * 0.01 * S * N });
        series.gamma.push({ x: tenorGrid[ti], y: g.gamma * 0.01 * S * N });
        series.vega.push({ x: tenorGrid[ti], y: g.vega * N });
        series.theta.push({ x: tenorGrid[ti], y: g.theta / 12 * N });
        valid++;
    }
    if (valid < 2) {
        ctx.fillStyle = th.text; ctx.font = '14px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('数据不足', W / 2, H / 2);
        return;
    }

    let yMin = Infinity, yMax = -Infinity;
    for (const arr of Object.values(series)) {
        for (const pt of arr) {
            if (pt.y < yMin) yMin = pt.y;
            if (pt.y > yMax) yMax = pt.y;
        }
    }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const yPad = (yMax - yMin) * 0.12;
    yMin -= yPad; yMax += yPad;

    const pad = makePads({ L: 68, R: 30, T: 18, B: 44 });
    const x0 = pad.L, y0 = H - pad.B, x1 = W - pad.R, y1 = pad.T;
    const plotW = x1 - x0, plotH = y0 - y1;

    const xTenors = series.delta.map(p => p.x);
    const xMin = Math.min(...xTenors), xMax = Math.max(...xTenors);
    const xRange = xMax - xMin || 1;
    const xAt = v => x0 + (v - xMin) / xRange * plotW;
    const yAt = v => y0 - (v - yMin) / (yMax - yMin) * plotH;

    drawGridH(ctx, x0, x1, y0, y1, 5, i => fmtMoneyAxis(yMin + (yMax - yMin) * i / 5), th);

    const yZero = yAt(0);
    if (yZero > y1 && yZero < y0) {
        ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x0, yZero); ctx.lineTo(x1, yZero); ctx.stroke();
        ctx.setLineDash([]);
    }

    ctx.fillStyle = th.text; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xTicks = Math.min(6, xTenors.length);
    for (let i = 0; i < xTicks; i++) {
        const idx = Math.floor(i * (xTenors.length - 1) / (xTicks - 1));
        ctx.fillText(xTenors[idx] + '月', xAt(xTenors[idx]), y0 + 6);
    }

    const drawLine = (arr, color) => {
        if (arr.length < 2) return;
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
            const x = xAt(arr[i].x), y = yAt(arr[i].y);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
    };
    for (const key of Object.keys(series)) drawLine(series[key], colors[key]);

    ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();

    drawYAxisTitle(ctx, '金额 (元)', 14, (y0 + y1) / 2);

    ctx.fillStyle = '#666'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('剩余期限', x1, y0 + 24);

    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#333';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('远期 Greeks（ATM 月度演变）', x0, y1 - 6);

    ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle';
    let lx = x1 + 6;
    for (const key of Object.keys(series)) {
        ctx.strokeStyle = colors[key]; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(lx, y1 + 8); ctx.lineTo(lx + 16, y1 + 8); ctx.stroke();
        ctx.fillStyle = th.textStrong; ctx.textAlign = 'left';
        ctx.fillText(labels[key], lx + 20, y1 + 8);
        lx += ctx.measureText(labels[key]).width + 32;
    }
}

// ====== B4. 时间维度概率演变（堆叠面积） ======
export function drawKOEvolution(cv, P, mc) {
    const { ctx, W, H, th } = beginDraw(cv);

    const koTimes = mc.koTimes, kiTimes = mc.kiTimes;
    if (!koTimes || !kiTimes) return;
    const n = koTimes.length;
    if (n === 0) return;

    const lastM = Math.floor(P.tenorMonths + 1e-9);
    const nSteps = P.nSteps;
    const spm = nSteps / P.tenorMonths;

    const koDelta = new Array(nSteps + 2).fill(0);
    const kiDelta = new Array(nSteps + 2).fill(0);
    for (let i = 0; i < n; i++) {
        const kt = koTimes[i], kit = kiTimes[i];
        if (kit !== Infinity) {
            kiDelta[kit]++;
        } else if (kt !== Infinity) {
            koDelta[kt]++;
        }
    }
    for (let j = 1; j <= nSteps; j++) { koDelta[j] += koDelta[j - 1]; kiDelta[j] += kiDelta[j - 1]; }

    const koPct = j => koDelta[j] / n;
    const kiPct = j => kiDelta[j] / n;

    const koObsSteps = [];
    for (let m = P.lockoutMonths + 1; m <= lastM; m++) koObsSteps.push(Math.round(m * spm));

    const pad = makePads({ L: 48, R: 20, T: 18, B: 44 });
    const x0 = pad.L, y0 = H - pad.B, x1 = W - pad.R, y1 = pad.T;
    const plotW = x1 - x0, plotH = y0 - y1;

    const xAt = j => x0 + j / nSteps * plotW;
    const yAt = p => y0 - p * plotH;

    // 语义色：KO=金 / KI=红 / Alive=藏青（红绿仅用于盈亏，故 KO 不用绿）
    const koColor = th.gold, kiColor = th.negative, aliveColor = th.accent;

    // 1. KI 区域（底）
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let j = 1; j <= nSteps; j++) ctx.lineTo(xAt(j), yAt(kiPct(j)));
    ctx.lineTo(x1, y0);
    ctx.closePath();
    ctx.fillStyle = kiColor + '33'; ctx.fill();
    ctx.strokeStyle = kiColor; ctx.lineWidth = 1.5; ctx.stroke();

    // 1a. KI 粗线
    ctx.strokeStyle = kiColor;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    let kiFirst = true;
    for (let j = Math.round(0.05 * nSteps); j <= nSteps; j++) {
        const x = xAt(j), y = yAt(kiPct(j));
        if (kiFirst) { ctx.moveTo(x, y); kiFirst = false; }
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 2. Alive 区域
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let j = 1; j <= nSteps; j++) ctx.lineTo(xAt(j), yAt(kiPct(j)));
    if (koObsSteps.length > 0) {
        ctx.lineTo(x1, yAt(1 - koPct(nSteps)));
        for (let i = koObsSteps.length - 1; i >= 0; i--) {
            const s = koObsSteps[i];
            ctx.lineTo(xAt(s), yAt(1 - koPct(s)));
            ctx.lineTo(xAt(s), yAt(1 - koPct(s - 1)));
        }
        ctx.lineTo(x0, yAt(1 - koPct(koObsSteps[0] - 1)));
    } else { ctx.lineTo(x1, yAt(1)); ctx.lineTo(x0, yAt(1)); }
    ctx.closePath();
    ctx.fillStyle = aliveColor + '33'; ctx.fill();
    ctx.strokeStyle = aliveColor; ctx.lineWidth = 1.5; ctx.stroke();

    // 3. KO 区域（顶）
    ctx.beginPath();
    ctx.moveTo(x0, y1);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, yAt(1 - koPct(nSteps)));
    if (koObsSteps.length > 0) {
        for (let i = koObsSteps.length - 1; i >= 0; i--) {
            const s = koObsSteps[i];
            ctx.lineTo(xAt(s), yAt(1 - koPct(s)));
            ctx.lineTo(xAt(s), yAt(1 - koPct(s - 1)));
        }
    }
    ctx.lineTo(x0, yAt(1 - koPct(0)));
    ctx.closePath();
    ctx.fillStyle = koColor + '33'; ctx.fill();
    ctx.strokeStyle = koColor; ctx.lineWidth = 1.5; ctx.stroke();

    // 坐标轴
    ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();

    ctx.fillStyle = th.text; ctx.font = '11px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let p = 0; p <= 1.001; p += 0.25) {
        const y = yAt(p);
        ctx.beginPath(); ctx.moveTo(x0 - 4, y); ctx.lineTo(x0, y); ctx.strokeStyle = th.axis; ctx.stroke();
        ctx.fillText((p * 100).toFixed(0) + '%', x0 - 6, y);
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xStep = lastM <= 12 ? 1 : 2;
    for (let m = 0; m <= lastM; m += xStep) {
        const x = xAt(Math.round(m * spm));
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + 4); ctx.strokeStyle = th.axis; ctx.stroke();
        ctx.fillText(m + '月', x, y0 + 6);
    }

    ctx.save(); ctx.translate(14, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#666'; ctx.font = '11px sans-serif';
    ctx.fillText('概率占比', 0, 0);
    ctx.restore();
    ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillStyle = '#666';
    ctx.fillText('时间(月)', x1, y0 + 24);

    // 图例 + 末期数值
    const kiLast = kiPct(nSteps), koLast = koPct(nSteps);
    const items = [
        { c: koColor, label: '敲出(KO)', val: koLast },
        { c: kiColor, label: '敲入(KI)', val: kiLast },
        { c: aliveColor, label: '存续(Alive)', val: 1 - koLast - kiLast }
    ];
    ctx.font = '12px sans-serif'; ctx.textBaseline = 'middle';
    let lx = x0 + 8;
    for (const it of items) {
        const txt = it.label + ' ' + (it.val * 100).toFixed(1) + '%';
        ctx.fillStyle = it.c; ctx.fillRect(lx, y1 + 4, 12, 12);
        ctx.fillStyle = '#666'; ctx.textAlign = 'left';
        ctx.fillText(txt, lx + 16, y1 + 10);
        lx += ctx.measureText(txt).width + 28;
    }

    // 锁定期虚线
    if (P.lockoutMonths > 0) {
        const lkX = xAt(Math.round(P.lockoutMonths * spm));
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(lkX, y0); ctx.lineTo(lkX, y1); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#999'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('锁定期末', lkX, y0 + 18);
    }
}

// ====== B5. PV 概率密度分布（KDE + VaR/ES） ======
export function drawPathHistogram(cv, mc, P) {
    const { ctx, W, H, th } = beginDraw(cv);

    const pvs = mc.pvs;
    if (!pvs || pvs.length === 0) {
        ctx.fillStyle = th.text; ctx.font = '14px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('无路径数据', W / 2, H / 2);
        return;
    }

    const n = pvs.length;
    const sorted = new Float64Array(pvs);
    sorted.sort();

    const varIdx = Math.floor(n * 0.05);
    const VaR95 = sorted[varIdx];
    let esSum = 0;
    for (let i = 0; i <= varIdx; i++) esSum += sorted[i];
    const ES95 = esSum / (varIdx + 1);

    let mean = 0;
    for (let i = 0; i < n; i++) mean += pvs[i];
    mean /= n;
    let varSum = 0;
    for (let i = 0; i < n; i++) {
        const d = pvs[i] - mean;
        varSum += d * d;
    }
    const std = Math.sqrt(varSum / n);

    const range = sorted[n - 1] - sorted[0];
    const hSilverman = 1.06 * std * Math.pow(n, -1 / 5);
    const bandwidth = Math.max(hSilverman, range / 80);

    const nSamples = 300;
    let pMin = sorted[0], pMax = sorted[n - 1];
    const pPad = (pMax - pMin) * 0.06;
    pMin -= pPad; pMax += pPad;
    if (pMax <= pMin) { pMin -= 0.01; pMax += 0.01; }

    const xs = new Float64Array(nSamples);
    const density = new Float64Array(nSamples);
    let maxDensity = 0;
    const norm = 1 / (n * bandwidth * Math.sqrt(2 * Math.PI));

    for (let s = 0; s < nSamples; s++) {
        const x = pMin + (pMax - pMin) * s / (nSamples - 1);
        xs[s] = x;
        let d = 0;
        for (let i = 0; i < n; i++) {
            const u = (x - pvs[i]) / bandwidth;
            d += Math.exp(-0.5 * u * u);
        }
        d *= norm;
        density[s] = d;
        if (d > maxDensity) maxDensity = d;
    }

    const pad = makePads({ L: 68, R: 90, T: 30, B: 44 });
    const x0 = pad.L, y0 = H - pad.B, x1 = W - pad.R, y1 = pad.T;
    const plotW = x1 - x0, plotH = y0 - y1;

    const xAt = v => x0 + (v - pMin) / (pMax - pMin) * plotW;
    const yAt = f => y0 - (f / maxDensity) * plotH * 0.92;

    ctx.strokeStyle = th.grid; ctx.fillStyle = th.text; ctx.font = '10px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
        const f = maxDensity * i / 5;
        const y = yAt(f);
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillText(f.toFixed(1), x0 - 5, y);
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const nXTicks = 6;
    for (let i = 0; i < nXTicks; i++) {
        const v = pMin + (pMax - pMin) * i / (nXTicks - 1);
        const x = xAt(v);
        ctx.fillText(v.toFixed(3), x, y0 + 6);
    }

    ctx.beginPath();
    ctx.moveTo(xAt(xs[0]), y0);
    for (let s = 0; s < nSamples; s++) {
        ctx.lineTo(xAt(xs[s]), yAt(density[s]));
    }
    ctx.lineTo(xAt(xs[nSamples - 1]), y0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(74, 125, 180, 0.15)';
    ctx.fill();

    ctx.strokeStyle = '#4a7db4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let s = 0; s < nSamples; s++) {
        const px = xAt(xs[s]);
        const py = yAt(density[s]);
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // VaR / ES / 理论价值
    ctx.strokeStyle = '#e67e22'; ctx.lineWidth = 2; ctx.setLineDash([6, 3]);
    ctx.beginPath(); ctx.moveTo(xAt(VaR95), y0); ctx.lineTo(xAt(VaR95), y1); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#e67e22'; ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`VaR(95%)=${VaR95.toFixed(4)}`, xAt(VaR95), y1 + 4);

    ctx.strokeStyle = '#9b2226'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(xAt(ES95), y0); ctx.lineTo(xAt(ES95), y1); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#9b2226';
    ctx.textAlign = 'center';
    ctx.fillText(`ES(95%)=${ES95.toFixed(4)}`, xAt(ES95), y1 + 20);

    const tvX = xAt(mc.price);
    ctx.strokeStyle = th.negative; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(tvX, y0); ctx.lineTo(tvX, y1); ctx.stroke();
    ctx.fillStyle = th.negative; ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const tvLabel = `理论价值=${mc.price.toFixed(4)}`;
    const tvTW = ctx.measureText(tvLabel).width;
    const tvLX = Math.min(tvX + 4, x1 - tvTW - 4);
    ctx.fillText(tvLabel, tvLX, y1 + 4);

    ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();

    ctx.save(); ctx.translate(16, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#666'; ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('概率密度', 0, 0);
    ctx.restore();

    ctx.fillStyle = '#666'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('路径终值 (PV)', x1, y0 + 24);

    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#333';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('PV 概率密度分布', x0, y1 - 6);

    const legItems = [
        { c: '#4a7db4', label: '密度曲线' },
        { c: th.negative, label: '理论价值' },
        { c: '#e67e22', label: 'VaR(95%)' },
        { c: '#9b2226', label: 'ES(95%)' },
    ];
    ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle';
    let lx = x1 + 6;
    for (const it of legItems) {
        ctx.strokeStyle = it.c; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(lx, y1 + 8); ctx.lineTo(lx + 14, y1 + 8); ctx.stroke();
        ctx.fillStyle = th.textStrong; ctx.textAlign = 'left';
        ctx.fillText(it.label, lx + 18, y1 + 8);
        lx += ctx.measureText(it.label).width + 28;
    }
}

// ====== B6. 票息累积曲线 ======
export function drawCouponAccrual(cv, P, mc) {
    const { ctx, W, H, th } = beginDraw(cv);

    const { koTimes, kiTimes } = mc;
    if (!koTimes || !kiTimes) return;
    const n = koTimes.length;
    if (n === 0) return;

    const lastM = Math.floor(P.tenorMonths + 1e-9);
    const spm = P.nSteps / P.tenorMonths;
    const cDiv = P.couponDiv !== undefined ? P.couponDiv : P.couponRate;
    const tiered = P.couponTiered;
    const cEarly = tiered ? (P.couponEarly !== undefined ? P.couponEarly : P.couponRate) : P.couponRate;
    const cLate = tiered ? (P.couponLate !== undefined ? P.couponLate : P.couponRate) : P.couponRate;
    const cSwitch = tiered ? (P.couponSwitchMonth || 1) : 1;

    const monthlyCum = new Float64Array(lastM + 1);
    for (let i = 0; i < n; i++) {
        const kt = koTimes[i];
        const kit = kiTimes[i];
        let cpAmt = 0, cpMonth = 0;
        if (kt !== Infinity) {
            const mo = kt / spm;
            const obsIdx = Math.round(mo - P.lockoutMonths);
            const rate = tiered ? (obsIdx >= cSwitch ? cLate : cEarly) : P.couponRate;
            cpAmt = rate * (mo / 12);
            cpMonth = Math.min(lastM, Math.round(mo));
        } else if (kit === Infinity) {
            cpAmt = cDiv * (P.tenorMonths / 12);
            cpMonth = lastM;
        }
        for (let m = 1; m <= cpMonth; m++) {
            monthlyCum[m] += cpAmt / cpMonth;
        }
    }
    for (let m = 0; m <= lastM; m++) {
        monthlyCum[m] /= n;
    }

    const pad = makePads({ L: 52, R: 26, T: 26, B: 44 });
    const x0 = pad.L, y0 = H - pad.B, x1 = W - pad.R, y1 = pad.T;
    const plotW = x1 - x0, plotH = y0 - y1;

    let yMax = 0;
    for (let m = 1; m <= lastM; m++) {
        if (monthlyCum[m] > yMax) yMax = monthlyCum[m];
    }
    if (yMax <= 0) { yMax = 0.01; }
    const yPad = yMax * 0.12;
    yMax += yPad;

    const xAt = m => x0 + (m / lastM) * plotW;
    const yAt = v => y0 - (v / yMax) * plotH;

    drawGridH(ctx, x0, x1, y0, y1, 5, i => (yMax * i / 5 * 100).toFixed(1) + '%', th);

    drawYAxisTitle(ctx, '预期累积票息（年化%）', 14, (y0 + y1) / 2);

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xStep = Math.max(1, Math.floor(lastM / 8));
    for (let m = 0; m <= lastM; m += xStep) {
        const x = xAt(m);
        ctx.fillText(m + '月', x, y0 + 6);
    }
    ctx.fillStyle = '#666'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('时间', x1, y0 + 24);

    ctx.beginPath();
    ctx.moveTo(xAt(0), y0);
    for (let m = 1; m <= lastM; m++) {
        ctx.lineTo(xAt(m), yAt(monthlyCum[m]));
    }
    ctx.lineTo(xAt(lastM), y0);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, y1, 0, y0);
    grad.addColorStop(0, 'rgba(45,106,79,0.35)');
    grad.addColorStop(1, 'rgba(45,106,79,0.05)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = th.series[3]; ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let m = 1; m <= lastM; m++) {
        const x = xAt(m), y = yAt(monthlyCum[m]);
        m === 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    for (let m = 1; m <= lastM; m++) {
        const x = xAt(m), y = yAt(monthlyCum[m]);
        ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = th.series[3]; ctx.fill();
    }

    const finalVal = monthlyCum[lastM];
    const fx = xAt(lastM), fy = yAt(finalVal);
    ctx.fillStyle = th.series[3]; ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('最终预期票息 ' + (finalVal * 100).toFixed(2) + '%', fx + 6, fy);

    ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0);
    ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();

    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#333';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('票息累积曲线', x0, y1 - 6);
}

// ====== B7. 逐观察日敲出概率柱图 ======
export function drawKODistribution(cv, P, mc) {
    const { ctx, W, H, th } = beginDraw(cv);

    const { koTimes } = mc;
    if (!koTimes || koTimes.length === 0) return;
    const n = koTimes.length;

    const lastM = Math.floor(P.tenorMonths + 1e-9);
    const spm = P.nSteps / P.tenorMonths;
    const obsMonths = [];
    for (let m = P.lockoutMonths + 1; m <= lastM; m++) obsMonths.push(m);
    const nObs = obsMonths.length;
    if (nObs === 0) return;

    const koCounts = new Uint32Array(nObs);
    let totalKO = 0;
    for (let i = 0; i < n; i++) {
        const kt = koTimes[i];
        if (kt === Infinity) continue;
        const mo = Math.round(kt / spm);
        const idx = obsMonths.indexOf(mo);
        if (idx >= 0) { koCounts[idx]++; totalKO++; }
    }

    const barPcts = new Float64Array(nObs);
    for (let i = 0; i < nObs; i++) barPcts[i] = koCounts[i] / n;

    const pad = makePads({ L: 52, R: 22, T: 26, B: 50 });
    const x0 = pad.L, y0 = H - pad.B, x1 = W - pad.R, y1 = pad.T;
    const plotW = x1 - x0, plotH = y0 - y1;

    let yMax = 0;
    for (let i = 0; i < nObs; i++) { if (barPcts[i] > yMax) yMax = barPcts[i]; }
    if (yMax <= 0) yMax = 0.01;
    yMax *= 1.15;

    const barW = Math.min(plotW / nObs * 0.7, 18);
    const gap = plotW / nObs;
    const xAt = i => x0 + gap * (i + 0.5);
    const yAt = v => y0 - (v / yMax) * plotH;

    drawGridH(ctx, x0, x1, y0, y1, 5, i => (yMax * i / 5 * 100).toFixed(1) + '%', th);

    for (let i = 0; i < nObs; i++) {
        const cx = xAt(i);
        const h2 = Math.max(1, yAt(0) - yAt(barPcts[i]));
        ctx.fillStyle = th.gold;
        ctx.fillRect(cx - barW / 2, yAt(barPcts[i]), barW, h2);

        if (barPcts[i] > 0.005) {
            ctx.fillStyle = th.textStrong; ctx.font = 'bold 8px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            ctx.fillText((barPcts[i] * 100).toFixed(1) + '%', cx, yAt(barPcts[i]) - 2);
        }
    }

    ctx.fillStyle = th.textStrong; ctx.font = '9px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xLabelStep = Math.max(1, Math.floor(nObs / 10));
    for (let i = 0; i < nObs; i += xLabelStep) {
        ctx.fillText(obsMonths[i] + '月', xAt(i), y0 + 6);
    }
    if ((nObs - 1) % xLabelStep !== 0) {
        ctx.fillText(obsMonths[nObs - 1] + '月', xAt(nObs - 1), y0 + 6);
    }
    ctx.fillStyle = '#666'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('观察时点', x1, y0 + 24);

    const cumKO = totalKO / n;
    ctx.fillStyle = th.textStrong; ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('累积敲出概率 ' + (cumKO * 100).toFixed(1) + '%', x0 + 8, y1 + 6);

    ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0);
    ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();

    drawYAxisTitle(ctx, '敲出概率', 14, (y0 + y1) / 2);

    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#333';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('逐观察日敲出概率分解', x0, y1 - 18);
}

// ====== B8. 路径密度热图 ======
export function drawPathDensityHeatmap(cv, P, mc) {
    const { ctx, W, H, th } = beginDraw(cv);

    const paths = mc.paths;
    if (!paths || paths.length === 0) {
        ctx.fillStyle = th.text; ctx.font = '14px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('无路径数据', W / 2, H / 2);
        return;
    }

    const nP = P.nPaths;
    const nSteps = P.nSteps;
    const spm = nSteps / P.tenorMonths;

    const lastM = Math.floor(P.tenorMonths + 1e-9);
    const nTimeBins = lastM + 1;
    const nPriceBins = 40;
    const pMin = 0.5, pMax = 1.5;

    const hist = new Float64Array(nTimeBins * nPriceBins);
    const stepToMonth = s => s / spm;

    for (let i = 0; i < nP; i++) {
        const base = i * (nSteps + 1);
        for (let s = 0; s <= nSteps; s++) {
            let m = Math.round(stepToMonth(s));
            if (m > lastM) m = lastM;
            const ratio = paths[base + s] / P.s0;
            if (ratio < pMin || ratio > pMax) continue;
            const pi = Math.floor((ratio - pMin) / (pMax - pMin) * nPriceBins);
            if (pi >= 0 && pi < nPriceBins) {
                hist[m * nPriceBins + pi]++;
            }
        }
    }

    let maxD = 0;
    for (let i = 0; i < hist.length; i++) {
        hist[i] /= nP;
        if (hist[i] > maxD) maxD = hist[i];
    }
    if (maxD <= 0) return;

    const pad = makePads({ L: 52, R: 24, T: 26, B: 44 });
    const x0 = pad.L, y0 = H - pad.B, x1 = W - pad.R, y1 = pad.T;
    const plotW = x1 - x0, plotH = y0 - y1;
    const cellW = plotW / nTimeBins;
    const cellH = plotH / nPriceBins;

    for (let mi = 0; mi < nTimeBins; mi++) {
        for (let pi = 0; pi < nPriceBins; pi++) {
            const d = hist[mi * nPriceBins + pi];
            if (d <= 0) continue;
            const intensity = Math.log10(1 + d * 9 / maxD) / Math.log10(10);
            const r = Math.round(240 - intensity * 200);
            const g = Math.round(245 - intensity * 160);
            const b = Math.round(240 - intensity * 100);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x0 + mi * cellW, y0 - (pi + 1) * cellH, cellW + 0.5, cellH + 0.5);
        }
    }

    // 边界线：KO=金 实线 / S₀=藏青 虚线 / KI=红 实线
    const drawLine = (ratio, color, dash) => {
        const py = y0 - ((ratio - pMin) / (pMax - pMin)) * plotH;
        ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        ctx.setLineDash(dash || []);
        ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color; ctx.font = '9px sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText((ratio * 100).toFixed(0) + '%', x0 + 4, py - 2);
    };
    const koRatio = P.koMode === 'descending' ? P.koStartPct : P.koPct;
    drawLine(koRatio, th.gold, []);
    drawLine(1.0, th.accent, [4, 3]);
    drawLine(P.kiPct, th.negative, []);

    ctx.fillStyle = th.textStrong; ctx.font = '9px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let pi = 0; pi <= 4; pi++) {
        const ratio = pMin + (pMax - pMin) * pi / 4;
        const py = y0 - ((ratio - pMin) / (pMax - pMin)) * plotH;
        ctx.fillText(ratio.toFixed(2), x0 - 5, py);
    }

    ctx.fillStyle = th.textStrong; ctx.font = '9px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xStep = Math.max(1, Math.floor(lastM / 8));
    for (let m = 0; m <= lastM; m += xStep) {
        ctx.fillText(m + '月', x0 + m * cellW, y0 + 6);
    }
    ctx.fillStyle = '#666'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('时间', x1, y0 + 24);

    drawYAxisTitle(ctx, 'S/S₀', 14, (y0 + y1) / 2);

    ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0);
    ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();

    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#333';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('路径密度热图（价格×时间）', x0, y1 - 6);

    // 色标（密度单色渐变，非盈亏语义）
    const cbX = x1 + 8, cbY = y1, cbW = 12, cbH = plotH;
    const grad = ctx.createLinearGradient(0, cbY + cbH, 0, cbY);
    grad.addColorStop(0, 'rgb(240,245,240)');
    grad.addColorStop(0.5, 'rgb(140,185,140)');
    grad.addColorStop(1, 'rgb(40,100,40)');
    ctx.fillStyle = grad;
    ctx.fillRect(cbX, cbY, cbW, cbH);
    ctx.strokeStyle = th.axis; ctx.lineWidth = 0.5;
    ctx.strokeRect(cbX, cbY, cbW, cbH);
    ctx.fillStyle = th.textStrong; ctx.font = '8px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('高', cbX + cbW + 3, cbY + 4);
    ctx.textBaseline = 'top';
    ctx.fillText('低', cbX + cbW + 3, cbY + cbH - 4);
}
