// pool.js - Worker 池：按路径分片 / 并行调度 / partial 合并 / 三级降级
// 降级链：并行 Worker →（失败）合并单任务主线程 →（再败）主线程逐 shard。
// CRN：主线程生成 Sobol normals 后按路径切分，slice() 拷贝后 Transferable 转移（禁 subarray view）。

let createWorker = () => {
    throw new Error('createWorker 未注入，请先调用 setWorkerFactory');
};

export function setWorkerFactory(fn) {
    createWorker = fn;
}

export class WorkerPool {
    constructor() {
        let param = null;
        try {
            const v = parseInt(new URLSearchParams(location.search).get('workers'));
            param = Number.isFinite(v) && v >= 1 ? v : null;
        } catch (e) { /* Node/非浏览器环境 */ }
        this.size = Math.max(1, Math.min(32, param || ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4)));
        this._nextId = 0;
        this._failed = false; // Worker 曾失败 → 后续直接主线程
        this.lastMode = 'idle'; // 'workers' | 'mainthread'，供状态栏显示
    }

    // 并行执行 shards；失败则合并为 1 个主线程任务（mergeFn），再败逐 shard 主线程
    async runShards(shards, mergeFn) {
        if (this._failed) {
            this.lastMode = 'mainthread';
            if (mergeFn) return [await this._runInMainThread(mergeFn(shards))];
            const results = [];
            for (const s of shards) results.push(await this._runInMainThread(s));
            return results;
        }
        try {
            const out = await Promise.all(shards.map(s => this._dispatch(s)));
            this.lastMode = 'workers';
            return out;
        } catch (err) {
            if (mergeFn) {
                console.warn('[WorkerPool] 并行调用失败，合并 shards 主线程重试:', err.message);
                this.lastMode = 'mainthread';
                return [await this._runInMainThread(mergeFn(shards))];
            }
            throw err;
        }
    }

    // 按路径数切分。buildShardData(startPath, endPath, normalsSlice) => {data, transfer}
    async runByPath(P, normals, workerType, buildShardData, mergeFn) {
        const nPaths = P.nPaths;
        const nSteps = P.nSteps;
        const nShards = Math.min(this.size, nPaths);
        const shardSize = Math.ceil(nPaths / nShards);

        const shards = [];
        for (let i = 0; i < nShards; i++) {
            const startPath = i * shardSize;
            const endPath = Math.min(startPath + shardSize, nPaths);
            if (startPath >= endPath) continue;
            // slice() 拷贝：subarray 是 view，不能多次 transfer
            const normalsSlice = normals.slice(startPath * nSteps, endPath * nSteps);
            const built = buildShardData(startPath, endPath, normalsSlice);
            shards.push({
                workerType,
                data: { ...built.data, startPath, endPath },
                transfer: built.transfer || [normalsSlice.buffer],
            });
        }
        const finalMergeFn = mergeFn || (() => ({
            workerType,
            data: buildShardData(0, nPaths, normals).data,
        }));
        return this.runShards(shards, finalMergeFn);
    }

    // 定价：分片 → 合并为完整定价结果（与主线程 priceSnowball 同构）
    async runPricing(P, normals, returnPaths = true) {
        const nSteps = P.nSteps;
        const partials = await this.runByPath(P, normals, 'pricing',
            (startPath, endPath, normalsSlice) => ({
                data: { P, normalsChunk: normalsSlice, returnPaths, kind: 'pricing' },
                transfer: [normalsSlice.buffer],
            }),
            shards => {
                const full = normals.slice(0, P.nPaths * nSteps);
                return {
                    workerType: 'pricing',
                    data: { P, normalsChunk: full, startPath: 0, endPath: P.nPaths, returnPaths, kind: 'pricing' },
                    transfer: [],
                };
            }
        );
        const { mergePricingPartials } = await import('./pricing.worker.js');
        return mergePricingPartials(partials, P);
    }

    // Greeks：分片求各扰动场景 partial sum → 主线程差分；vegaKI/KO 由调用方补算
    async runGreeks(P, normals) {
        const nSteps = P.nSteps;
        const partials = await this.runByPath(P, normals, 'greeks',
            (startPath, endPath, normalsSlice) => ({
                data: { P, normalsChunk: normalsSlice, kind: 'greeks' },
                transfer: [normalsSlice.buffer],
            }),
            () => ({
                workerType: 'greeks',
                data: { P, normalsChunk: normals.slice(0, P.nPaths * nSteps), startPath: 0, endPath: P.nPaths, kind: 'greeks' },
                transfer: [],
            })
        );
        const { mergeGreeksPartials } = await import('./greeks.worker.js');
        return mergeGreeksPartials(partials, P);
    }

    // Greeks 查表：按期限列分片并行；Worker 不可用/失败时主线程逐格计算（每格让步，进度逐格回调）
    async runTable(P, histPrices, onProgress) {
        const { buildGrids } = await import('../core/table.js');
        const grids = buildGrids(P, histPrices);
        const nT = grids.finalTenorGrid.length;
        const nP = grids.priceGrid.length;
        const total = nP * nT;
        const table = { priceGrid: grids.priceGrid, tenorGrid: grids.finalTenorGrid, data: {} };

        let columns = null;
        if (!this._failed && !this._factoryUnavailable()) {
            const shards = [];
            for (let ti = 0; ti < nT; ti++) {
                shards.push({
                    workerType: 'table',
                    data: { P, grids, ti },
                    transfer: [],
                });
            }
            try {
                columns = await Promise.all(shards.map(s => this._dispatch(s)));
                this.lastMode = 'workers';
            } catch (err) {
                console.warn('[WorkerPool] 查表并行失败，转主线程逐格:', err.message);
                columns = null;
            }
        }

        if (columns) {
            let done = 0;
            for (const col of columns) {
                for (const pi of Object.keys(col.cells)) {
                    table.data[pi + '_' + col.ti] = col.cells[pi];
                    done++;
                }
                if (onProgress) onProgress(done, total);
            }
            return table;
        }

        // 主线程逐格降级：单格 ~0.3s 级阻塞 + 每格让步，页面保持可响应
        this.lastMode = 'mainthread';
        const { runInMainThreadCells } = await import('./table.worker.js');
        const mega = await runInMainThreadCells({ P, grids }, done => {
            if (onProgress) onProgress(done, total);
        });
        Object.assign(table.data, mega.cells);
        if (onProgress) onProgress(total, total);
        return table;
    }

    // Worker 工厂可用性探测（同步，结果缓存）：file:// 或模块不可达时为 false
    _factoryUnavailable() {
        if (this._factoryOk === undefined) {
            try {
                const w = createWorker('table');
                w.terminate();
                this._factoryOk = true;
            } catch (e) {
                this._factoryOk = false;
            }
        }
        return !this._factoryOk;
    }

    _dispatch(shard) {
        return new Promise((resolve, reject) => {
            let worker = null;
            try {
                worker = createWorker(shard.workerType);
            } catch (e) {
                this._failed = true;
                this._runInMainThread(shard).then(resolve, reject);
                return;
            }
            const id = this._nextId++;
            let settled = false;
            let timeout = null;

            const finish = (fn, val) => {
                if (settled) return;
                settled = true;
                if (timeout) clearTimeout(timeout);
                try { worker.removeEventListener('message', onMessage); } catch (e) {}
                try { worker.removeEventListener('error', onError); } catch (e) {}
                try { worker.terminate(); } catch (e) {}
                fn(val);
            };
            const onMessage = (e) => {
                if (e.data.id !== id) return;
                if (e.data.error) finish(reject, new Error(e.data.error));
                else finish(resolve, e.data.result);
            };
            const onError = (errEvent) => {
                // 不在此处降级——否则 N 个 shard 触发 N 个并行主线程任务反而更慢；
                // 让 runShards 合并 shards 为 1 个重试。
                console.warn('[WorkerPool] Worker error 事件:', errEvent.message || 'unknown');
                this._failed = true;
                finish(reject, new Error('Worker error: ' + (errEvent.message || 'unknown')));
            };
            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onError);
            // 120s 超时；加载失败走 error 事件立即触发
            timeout = setTimeout(() => {
                this._failed = true;
                finish(reject, new Error('Worker timeout 120s'));
            }, 120000);
            try {
                worker.postMessage({ id, ...shard.data }, shard.transfer || []);
            } catch (e) {
                this._failed = true;
                this._runInMainThread(shard).then(resolve, reject);
                finish(() => {}, null);
            }
        });
    }

    // 主线程降级：动态 import worker 模块的 runInMainThread
    async _runInMainThread(shard) {
        const mod = await import(`./${shard.workerType}.worker.js`);
        if (typeof mod.runInMainThread !== 'function') {
            throw new Error(`Worker ${shard.workerType} 未导出 runInMainThread（主线程降级不可用）`);
        }
        return mod.runInMainThread(shard.data);
    }
}

let _pool = null;
export function getPool() {
    if (!_pool) _pool = new WorkerPool();
    return _pool;
}
