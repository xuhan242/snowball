// table.worker.js - Greeks 查表分片：一个 shard = 一个期限列（24 个价格点）
// 输入: { P, grids, ti }
// 输出: { ti, cells: {pi: greeks} }

import { prepareTableColumn, computeTableCell } from '../core/table.js';

export function computeTableShard(P, grids, ti) {
    const prep = prepareTableColumn(P, grids, ti);
    const cells = {};
    for (let pi = 0; pi < grids.priceGrid.length; pi++) {
        cells[pi] = computeTableCell(P, grids, prep, pi);
    }
    return { ti, cells };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.onmessage = (e) => {
        const { id, P, grids, ti } = e.data;
        try {
            const result = computeTableShard(P, grids, ti);
            self.postMessage({ id, result });
        } catch (err) {
            self.postMessage({ id, error: err.message });
        }
    };
}

export async function runInMainThread(data) {
    return computeTableShard(data.P, data.grids, data.ti);
}

// 主线程逐格降级：每格算完让步一次，单格阻塞 ~0.3s 量级，
// 避免长块占用主线程触发浏览器「页面无响应」弹窗；进度逐格回调。
// 让步用 MessageChannel 而非 setTimeout：后台标签页的定时器会被节流（1s~1min/次），
// MessageChannel 任务不受定时器节流，切走标签页也不拖慢建表。
function yieldToUI() {
    if (typeof MessageChannel === 'undefined') {
        return new Promise(r => setTimeout(r, 0));
    }
    return new Promise(r => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => { ch.port1.close(); r(); };
        ch.port2.postMessage(0);
    });
}

export async function runInMainThreadCells(data, onCell) {
    const { P, grids } = data;
    const cells = {};
    let done = 0;
    for (let c = 0; c < grids.finalTenorGrid.length; c++) {
        const prep = prepareTableColumn(P, grids, c);
        for (let pi = 0; pi < grids.priceGrid.length; pi++) {
            cells[pi + '_' + c] = computeTableCell(P, grids, prep, pi);
            done++;
            if (onCell) onCell(done);
            await yieldToUI();
        }
    }
    return { ti: -1, cells };
}
