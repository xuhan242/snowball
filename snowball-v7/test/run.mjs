// run.mjs - 测试入口：node test/run.mjs
// 依次执行 test/unit/*.mjs 与 test/golden.test.mjs，输出 ✓/✗ 摘要，非零退出码表示失败。
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const unitDir = path.join(here, 'unit');

const files = [
    ...fs.readdirSync(unitDir).filter(f => f.endsWith('.mjs')).sort().map(f => path.join(unitDir, f)),
    path.join(here, 'golden.test.mjs'),
];

let pass = 0, fail = 0;
const failures = [];
const t0 = Date.now();

for (const file of files) {
    const rel = path.relative(here, file);
    const mod = await import(url.pathToFileURL(file).href);
    if (typeof mod.default !== 'function') {
        console.log(`SKIP ${rel}（无 default 导出）`);
        continue;
    }
    const t = {
        pending: [],
        test: (name, fn) => {
            const p = (async () => {
                try {
                    await fn();
                    pass++;
                    console.log(`  ✓ ${name}`);
                } catch (e) {
                    fail++;
                    failures.push({ file: rel, name, e });
                    console.log(`  ✗ ${name}\n      ${e.message}`);
                }
            })();
            t.pending.push(p);
        }
    };
    console.log(`▶ ${rel}`);
    await mod.default(t);
    await Promise.all(t.pending);
    t.pending.length = 0;
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n===== 测试摘要：${pass} 通过 / ${fail} 失败，耗时 ${secs}s =====`);
if (failures.length > 0) {
    console.log('失败明细：');
    for (const f of failures) console.log(`  [${f.file}] ${f.name}: ${f.e.stack || f.e.message}`);
    process.exit(1);
}
