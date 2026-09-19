// stress-charts.js - 压测 Tab 组合矩阵热图（规格见 docs/v7-charts-spec.md §D）
import { setupCanvas, getCanvasTheme, makePads } from './kit.js';

// 5×5 矩阵：delta_pv<0→红，>0→绿（盈亏语义），≈0→浅灰
export function drawStressMatrix(cv, matrixResults, P) {
    const { ctx, w, h } = setupCanvas(cv, { willReadFrequently: true });
    const th = getCanvasTheme();
    ctx.clearRect(0, 0, w, h);

    if (!matrixResults || matrixResults.length < 25) {
        ctx.fillStyle = th.text; ctx.font = '14px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('暂无数据', w / 2, h / 2);
        return;
    }

    const volShocks = [-0.10, -0.05, 0, 0.05, 0.10];
    const spotJumps = [-0.10, -0.05, 0, 0.05, 0.10];
    const findIdx = (arr, v) => {
        for (let i = 0; i < arr.length; i++) if (Math.abs(arr[i] - v) < 1e-9) return i;
        return -1;
    };

    const grid = [];
    for (let vi = 0; vi < 5; vi++) grid.push(new Array(5).fill(null));
    for (const r of matrixResults) {
        if (!r || !r.scenario) continue;
        const vi = findIdx(volShocks, r.scenario.volShock);
        const si = findIdx(spotJumps, r.scenario.spotJump);
        if (vi < 0 || si < 0) continue;
        grid[vi][si] = r;
    }

    let dMin = Infinity, dMax = -Infinity;
    let pvMin = Infinity, pvMax = -Infinity;
    let worstR = null, bestR = null;
    let validCount = 0;
    for (let vi = 0; vi < 5; vi++) {
        for (let si = 0; si < 5; si++) {
            const r = grid[vi][si];
            if (!r) continue;
            validCount++;
            const dpv = r.delta_pv;
            if (dpv < dMin) dMin = dpv;
            if (dpv > dMax) dMax = dpv;
            if (r.pv < pvMin) { pvMin = r.pv; worstR = r; }
            if (r.pv > pvMax) { pvMax = r.pv; bestR = r; }
        }
    }
    if (validCount === 0) {
        ctx.fillStyle = th.text; ctx.font = '14px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('暂无数据', w / 2, h / 2);
        return;
    }

    const absMax = Math.max(Math.abs(dMin), Math.abs(dMax), 1e-9);

    const colorMap = (dpv) => {
        const t = Math.max(-1, Math.min(1, dpv / absMax));
        if (t >= 0) {
            const s = Math.round(t * 80);
            return `hsl(120,${s}%,${85 - t * 25}%)`;
        } else {
            const s = Math.round(-t * 80);
            return `hsl(0,${s}%,${85 + t * 25}%)`;
        }
    };

    const pad = makePads({ L: 70, R: 100, T: 50, B: 50 });
    const x0 = pad.L, y0 = h - pad.B, x1 = w - pad.R, y1 = pad.T;
    const plotW = x1 - x0, plotH = y0 - y1;
    const cellW = plotW / 5, cellH = plotH / 5;

    ctx.fillStyle = th.bg;
    ctx.fillRect(x0, y1, plotW, plotH);

    const rowOf = vi => 4 - vi;

    // 第1层：格子
    for (let vi = 0; vi < 5; vi++) {
        for (let si = 0; si < 5; si++) {
            const r = grid[vi][si];
            if (!r) continue;
            const row = rowOf(vi);
            const cx = x0 + si * cellW;
            const cy = y1 + row * cellH;
            ctx.fillStyle = colorMap(r.delta_pv);
            ctx.fillRect(cx, cy, cellW, cellH);
            ctx.strokeStyle = 'rgba(150,150,150,0.55)';
            ctx.lineWidth = 0.8;
            ctx.strokeRect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1);
        }
    }

    ctx.strokeStyle = th.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y1 + 0.5, plotW - 1, plotH - 1);

    // 第2层：PV 数值
    const fontSize = Math.max(8, Math.min(11, Math.min(cellW, cellH) / 6));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let vi = 0; vi < 5; vi++) {
        for (let si = 0; si < 5; si++) {
            const r = grid[vi][si];
            if (!r) continue;
            const row = rowOf(vi);
            const cx = x0 + si * cellW + cellW / 2;
            const cy = y1 + row * cellH + cellH / 2;
            const intensity = Math.abs(r.delta_pv / absMax);
            ctx.fillStyle = intensity > 0.45 ? '#fff' : '#1a1a1a';
            ctx.fillText(r.pv.toFixed(3), cx, cy);
        }
    }

    // 第3层：特殊标记
    const drawCellBorder = (vi, si, color, lw, dash) => {
        const row = rowOf(vi);
        const cx = x0 + si * cellW;
        const cy = y1 + row * cellH;
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.setLineDash(dash || []);
        ctx.strokeRect(cx + lw / 2 + 0.5, cy + lw / 2 + 0.5, cellW - lw - 1, cellH - lw - 1);
        ctx.setLineDash([]);
    };
    drawCellBorder(2, 2, th.text, 2, [5, 3]);
    if (worstR) {
        const wvi = findIdx(volShocks, worstR.scenario.volShock);
        const wsi = findIdx(spotJumps, worstR.scenario.spotJump);
        if (wvi >= 0 && wsi >= 0) drawCellBorder(wvi, wsi, th.negative, 2.5, []);
    }
    if (bestR) {
        const bvi = findIdx(volShocks, bestR.scenario.volShock);
        const bsi = findIdx(spotJumps, bestR.scenario.spotJump);
        if (bvi >= 0 && bsi >= 0) drawCellBorder(bvi, bsi, th.positive, 2.5, []);
    }

    // 第4层：轴标签
    ctx.fillStyle = th.textStrong;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let si = 0; si < 5; si++) {
        const cx = x0 + si * cellW + cellW / 2;
        const sj = spotJumps[si];
        const label = sj === 0 ? '0%' : (sj > 0 ? '+' : '') + (sj * 100).toFixed(0) + '%';
        ctx.fillText(label, cx, y0 + 6);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let vi = 0; vi < 5; vi++) {
        const row = rowOf(vi);
        const cy = y1 + row * cellH + cellH / 2;
        const vs = volShocks[vi];
        const label = vs === 0 ? '0pp' : (vs > 0 ? '+' : '') + (vs * 100).toFixed(0) + 'pp';
        ctx.fillText(label, x0 - 5, cy);
    }

    ctx.save();
    ctx.translate(14, y1 + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = th.text;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('波动率变化', 0, 0);
    ctx.restore();

    ctx.fillStyle = th.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('标的价格变化', x0 + plotW / 2, y0 + 26);

    // 第5层：色标条
    const cbX = x1 + 14;
    const cbY = y1;
    const cbW = 14;
    const cbH = plotH;
    const grad = ctx.createLinearGradient(0, cbY + cbH, 0, cbY);
    grad.addColorStop(0, 'hsl(0,80%,60%)');
    grad.addColorStop(0.5, 'hsl(0,0%,85%)');
    grad.addColorStop(1, 'hsl(120,80%,60%)');
    ctx.fillStyle = grad;
    ctx.fillRect(cbX, cbY, cbW, cbH);
    ctx.strokeStyle = th.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(cbX, cbY, cbW, cbH);

    const fmtDelta = v => (v >= 0 ? '+' : '') + v.toFixed(3);
    ctx.fillStyle = th.textStrong;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(fmtDelta(dMax), cbX + cbW + 4, cbY + 4);
    ctx.textBaseline = 'top';
    ctx.fillText(fmtDelta(dMin), cbX + cbW + 4, cbY + cbH - 4);
    ctx.textBaseline = 'middle';
    ctx.fillText('+0.000', cbX + cbW + 4, cbY + cbH / 2);

    // 第6层：标题
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = th.textStrong;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('组合情景矩阵 (PV 相对基准变化)', x0, y1 - 8);
}
