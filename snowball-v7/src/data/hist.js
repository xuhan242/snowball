// hist.js - 历史数据解码与切片（浏览器 DecompressionStream / Node zlib 双通道）
// 解码后每次返回独立副本，防止调用方共享引用互写。

import { HIST_DATA } from './hist-data.js';

const textCache = new Map();

async function inflate(b64) {
    if (typeof DecompressionStream !== 'undefined') {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
        return new Response(stream).text();
    }
    // Node 环境 fallback
    const zlib = (await import('node:zlib')).default;
    const buf = zlib.inflateSync(Buffer.from(b64, 'base64'));
    return buf.toString('utf-8');
}

async function rawText(code) {
    if (textCache.has(code)) return textCache.get(code);
    const b64 = HIST_DATA[code];
    if (!b64) throw new Error(`无 ${code} 的历史数据`);
    const text = await inflate(b64);
    textCache.set(code, text);
    return text;
}

// 解析紧凑格式: "日期 价格;日期 价格;..."（时间正序）——逐字移植 v5 parseCSV
export function parseCSV(text) {
    const points = text.trim().split(';');
    const out = [];
    for (const pt of points) {
        const parts = pt.trim().split(' ');
        if (parts.length < 2) continue;
        const dateStr = parts[0];
        const price = parseFloat(parts[1]);
        if (dateStr && isFinite(price)) out.push([dateStr, price]);
    }
    return out;
}

// 返回 [[dateStr, price], ...] 独立副本（按日期升序；危机补段拼接后保持有序）
export async function loadHistData(code) {
    const text = await rawText(code);
    const data = parseCSV(text);
    data.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return data;
}

export async function getDateRange(code) {
    const data = await loadHistData(code);
    if (data.length === 0) return { start: '', end: '' };
    return { start: data[0][0], end: data[data.length - 1][0] };
}

export function fmtDate(dateStr) {
    if (!dateStr || dateStr.length !== 8) return '';
    return dateStr.slice(0, 4) + '-' + dateStr.slice(4, 6) + '-' + dateStr.slice(6, 8);
}

export function parseDate(dateStr) { return dateStr.replace(/-/g, ''); }

export async function sliceHist(code, startDate, endDate) {
    const data = await loadHistData(code);
    return data.filter(([d]) => d >= startDate && d <= endDate);
}
