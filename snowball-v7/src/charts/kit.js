// kit.js - Canvas 绘图工具：DPR 适配 / 主题色 / 坐标轴 / 网格 / 格式化
// 语义色约定：红/绿只表达盈亏正负（positive/negative）；KO=金，KI=红障碍，S₀=藏青虚线。

export function getCanvasTheme() {
    const cs = getComputedStyle(document.documentElement);
    const get = (name, fallback) => {
        const v = cs.getPropertyValue(name).trim();
        return v || fallback;
    };
    return {
        bg: get('--canvas-bg', '#fff'),
        grid: get('--canvas-grid', '#f5f5f5'),
        axis: get('--canvas-axis', '#ccc'),
        text: get('--canvas-text', '#888'),
        textStrong: get('--canvas-text-strong', '#555'),
        accent: get('--accent', '#2456d6'),
        gold: get('--gold', '#c9a227'),
        series: [
            get('--canvas-series-1', '#2456d6'),
            get('--canvas-series-2', '#c0392b'),
            get('--canvas-series-3', '#1e7f4f'),
            get('--canvas-series-4', '#e67e22'),
            get('--canvas-series-5', '#1a73e8'),
            get('--canvas-series-6', '#8e44ad'),
            get('--canvas-series-7', '#8c564b'),
            get('--canvas-series-8', '#d3568f'),
        ],
        positive: get('--canvas-positive', '#1e7f4f'),
        negative: get('--canvas-negative', '#c0392b'),
    };
}

// 开场三件套：setupCanvas + getCanvasTheme + clearRect
export function beginDraw(cv) {
    const { ctx, w: W, h: H } = setupCanvas(cv);
    const th = getCanvasTheme();
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H, th };
}

export function makePads(opts = {}) {
    return {
        L: opts.L ?? 50,
        R: opts.R ?? 20,
        T: opts.T ?? 20,
        B: opts.B ?? 40,
    };
}

// 水平网格线 + Y 轴标签
export function drawGridH(ctx, x0, x1, y0, y1, steps, fmt, th) {
    ctx.strokeStyle = th.grid;
    ctx.fillStyle = th.text;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const stepH = (y0 - y1) / steps;
    for (let i = 0; i <= steps; i++) {
        const y = y0 - i * stepH;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.fillText(fmt(i), x0 - 5, y);
    }
}

// Y 轴标题（旋转 -90°）
export function drawYAxisTitle(ctx, text, x, yCenter) {
    ctx.save();
    ctx.translate(x, yCenter);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
}

// display:none→grid 切换后 rect 可能为 0：rect→offset→computed CSS→600×240 回退链
export function setupCanvas(cv, options = {}) {
    const dpr = window.devicePixelRatio || 1;
    let w = cv.getBoundingClientRect().width;
    let h = cv.getBoundingClientRect().height;
    if (w === 0) w = cv.offsetWidth || 0;
    if (h === 0) h = cv.offsetHeight || 0;
    if (w === 0) {
        const cssW = getComputedStyle(cv).width;
        if (cssW && cssW.endsWith('px')) w = parseFloat(cssW);
    }
    if (h === 0) {
        const cssH = getComputedStyle(cv).height;
        if (cssH && cssH.endsWith('px')) h = parseFloat(cssH);
    }
    if (w === 0) w = 600;
    if (h === 0) h = 240;
    cv.width = w * dpr;
    cv.height = h * dpr;

    const ctxOptions = {};
    if (options.willReadFrequently) ctxOptions.willReadFrequently = true;
    if (options.desynchronized) ctxOptions.desynchronized = true;

    const ctx = Object.keys(ctxOptions).length > 0
        ? cv.getContext('2d', ctxOptions)
        : cv.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, w, h };
}

export function drawAxes(ctx, x0, y0, x1, y1, xLabel, yLabel) {
    const th = getCanvasTheme();
    ctx.strokeStyle = th.axis; ctx.fillStyle = th.text; ctx.font = '11px sans-serif'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
    if (yLabel) {
        ctx.save(); ctx.translate(x0 - 44, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(yLabel, 0, 0); ctx.restore();
    }
    if (xLabel) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(xLabel, x1 - 4, y0 + 24); }
}

// 色彩映射（蓝(负)→白→红(正)，HSL 插值）
export function colorScale(v, vmin, vmax) {
    const absMax = Math.max(Math.abs(vmin), Math.abs(vmax), 1e-9);
    const t = Math.max(-1, Math.min(1, v / absMax));
    if (t >= 0) {
        const s = Math.round(t * 80);
        return `hsl(0,${s}%,${85 - t * 25}%)`;
    } else {
        const s = Math.round(-t * 80);
        return `hsl(240,${s}%,${85 + t * 25}%)`;
    }
}

// 色标条（蓝→白→红）
export function drawColorBar(ctx, x, y, w, h, vmin, vmax) {
    const grad = ctx.createLinearGradient(0, y + h, 0, y);
    grad.addColorStop(0, 'hsl(240,80%,60%)');
    grad.addColorStop(0.5, 'hsl(0,0%,85%)');
    grad.addColorStop(1, 'hsl(0,80%,60%)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    const fmtBar = v => {
        const av = Math.abs(v);
        if (av >= 1e8) return (v / 1e8).toFixed(1) + '亿';
        if (av >= 1e4) return (v / 1e4).toFixed(1) + '万';
        if (av >= 100) return Math.round(v).toString();
        return v.toFixed(2);
    };
    ctx.fillStyle = '#555';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fmtBar(vmax), x + w + 4, y);
    ctx.textBaseline = 'bottom';
    ctx.fillText(fmtBar(vmin), x + w + 4, y + h);
    ctx.textBaseline = 'middle';
    ctx.fillText('0', x + w + 4, y + h / 2);
}

// 金额轴格式化
export function fmtMoneyAxis(v) {
    const a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(1) + '万';
    if (a >= 100) return Math.round(v).toString();
    return v.toFixed(0);
}

// YYYYMMDD → MM-DD
export function fmtDateShort(dateStr) {
    if (!dateStr || dateStr.length !== 8) return '';
    return dateStr.slice(4, 6) + '-' + dateStr.slice(6, 8);
}
