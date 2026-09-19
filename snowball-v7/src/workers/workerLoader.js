// workerLoader.js - Worker 创建 + 可用性检测 + 降级链入口
// 降级链：URL Worker（http/https）→ 检测不可达/singlefile → 主线程；file:// 直接主线程。

import { setWorkerFactory } from './pool.js';

export function isFileProtocol() {
    try {
        return location.protocol === 'file:';
    } catch (e) {
        return false;
    }
}

const WORKER_PATHS = {
    pricing: './pricing.worker.js',
    greeks: './greeks.worker.js',
    table: './table.worker.js',
};

// singlefile 构建下 Worker 文件不存在，构造函数不抛错但 error 事件时机不稳；
// 同步 HEAD 提前探测并缓存，避免计算卡在等待 error 事件。
function isWorkerUrlReachable(url) {
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', url, false);
        xhr.send();
        if (xhr.status < 200 || xhr.status >= 400) return false;
        const ct = xhr.getResponseHeader('Content-Type') || '';
        if (ct.includes('text/html')) return false; // SPA 回退
        return true;
    } catch (e) {
        return false;
    }
}

const _unreachable = new Set();

function workerFactory(type) {
    if (isFileProtocol()) {
        throw new Error('file:// 协议不支持 ES module Worker，降级到主线程');
    }
    if (_unreachable.has(type)) {
        throw new Error(`Worker(${type}) 模块不可达（已缓存），降级到主线程`);
    }
    const path = WORKER_PATHS[type];
    if (!path) throw new Error(`未知 Worker 类型: ${type}`);
    const workerUrl = new URL(path, import.meta.url).href;
    if (!isWorkerUrlReachable(workerUrl)) {
        _unreachable.add(type);
        throw new Error(`Worker(${type}) 模块不可达，降级到主线程`);
    }
    return new Worker(workerUrl, { type: 'module' });
}

export function initWorkers() {
    setWorkerFactory(workerFactory);
}

// 池规模：?workers=N 覆盖 → hardwareConcurrency（上限 32，下限 1）
export function getWorkersParam() {
    try {
        const v = parseInt(new URLSearchParams(location.search).get('workers'));
        return Number.isFinite(v) && v >= 1 ? v : null;
    } catch (e) {
        return null;
    }
}
