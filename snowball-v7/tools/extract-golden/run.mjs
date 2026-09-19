// 构建 SSR bundle 并执行；默认产出 tests/golden.json（v5 legacy 全量提取），
// `scaled` 模式产出 tests/golden-v7-scaled.json（批次二A：仅重立回测键），
// `book` 模式产出 tests/golden-v7-book.json（v7.1.0：查表 PV + 账本级回测键），
// `checkup` 模式跑数值体检表（不写文件）。
import { execSync } from 'node:child_process';
import { pathToFileURL, pathToFileURL as toURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const v7Root = path.resolve(here, '../..');
const mode = process.argv[2] || 'golden';

execSync('npx vite build --ssr entry.mjs --outDir .golden-build --emptyOutDir --minify false --logLevel warn', {
    cwd: here, stdio: 'inherit', shell: true,
});

const bundle = path.join(here, '.golden-build/entry.js');
const mod = await import(pathToFileURL(bundle).href);

if (mode === 'scaled') {
    const outFile = path.join(v7Root, 'tests', 'golden-v7-scaled.json');
    const keys = await mod.mainScaled(outFile, path.join(v7Root, 'tests', 'golden.json'));
    fs.rmSync(path.join(here, '.golden-build'), { recursive: true, force: true });
    console.log('golden-v7-scaled.json written:', keys.join(', '));
} else if (mode === 'book') {
    const outFile = path.join(v7Root, 'tests', 'golden-v7-book.json');
    const keys = await mod.mainBook(outFile, path.join(v7Root, 'tests', 'golden-v7-scaled.json'));
    fs.rmSync(path.join(here, '.golden-build'), { recursive: true, force: true });
    console.log('golden-v7-book.json written:', keys.join(', '));
} else if (mode === 'checkup') {
    await mod.mainCheckup();
    fs.rmSync(path.join(here, '.golden-build'), { recursive: true, force: true });
} else {
    const outFile = path.join(v7Root, 'tests', 'golden.json');
    const keys = await mod.main(outFile);
    fs.rmSync(path.join(here, '.golden-build'), { recursive: true, force: true });
    console.log('golden.json written:', keys.join(', '));
}
