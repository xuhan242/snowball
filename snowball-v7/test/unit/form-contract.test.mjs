// 参数契约单测：validate 全错误分支 + rf 曲线插值与端点钳位
import url from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const { validate, formState } = await import(url.pathToFileURL(path.join(root, 'src/ui/form.js')).href);
const { rfFromCurve, RF_CURVE } = await import(url.pathToFileURL(path.join(root, 'src/data/market.js')).href);

function okP(extra = {}) {
    return {
        s0: 100, koPct: 1.0, kiPct: 0.75, couponRate: 0.18, couponTiered: false,
        couponEarly: 0, couponLate: 0, tenorMonths: 24, lockoutMonths: 3,
        vol: 0.18, koMode: 'fixed', koStartPct: 1.0,
        ...extra
    };
}

function hasErr(errs, kw) {
    return errs.some(e => e.includes(kw));
}

export default async function run(t) {
    t.test('validate: 合法参数零错误', () => {
        formState.mode = 'pricing';
        const errs = validate(okP());
        if (errs.length !== 0) throw new Error('应无错误：' + errs.join(';'));
    });

    t.test('validate: 基础五分支（s0/敲入/期限/波动率/敲出空）', () => {
        formState.mode = 'pricing';
        const cases = [
            [okP({ s0: 0 }), '期初价格'],
            [okP({ kiPct: 0 }), '敲入价'],
            [okP({ tenorMonths: 2 }), '期限'],
            [okP({ vol: 0 }), '波动率'],
            [okP({ koPct: 0 }), '敲出价不能为空'],
        ];
        for (const [P, kw] of cases) {
            if (!hasErr(validate(P), kw)) throw new Error(`缺少「${kw}」：${validate(P).join(';')}`);
        }
    });

    t.test('validate: 递减模式起始敲出价 + 敲出须高于敲入 + 锁定期短于期限', () => {
        formState.mode = 'pricing';
        if (!hasErr(validate(okP({ koMode: 'descending', koStartPct: 0 })), '起始敲出价')) throw new Error('缺少起始敲出价分支');
        if (!hasErr(validate(okP({ koPct: 0.75 })), '高于敲入')) throw new Error('缺少敲出>敲入分支');
        if (!hasErr(validate(okP({ lockoutMonths: 24 })), '锁定期')) throw new Error('缺少锁定期分支');
    });

    t.test('validate: 票息>0 仅估值模式要求，反推模式豁免；分段需 early+late', () => {
        formState.mode = 'pricing';
        if (!hasErr(validate(okP({ couponRate: 0 })), '票息')) throw new Error('估值模式应拦截票息≤0');
        formState.mode = 'reverse';
        const errs = validate(okP({ couponRate: 0 }));
        if (hasErr(errs, '票息')) throw new Error('反推模式不应拦截票息');
        formState.mode = 'pricing';
        if (!hasErr(validate(okP({ couponTiered: true, couponEarly: 0.1, couponLate: 0 })), '分段票息')) throw new Error('缺少分段票息分支');
    });

    t.test('rf: 曲线插值（相邻点线性）与端点钳位', () => {
        const pts = RF_CURVE.points;
        // 1.4Y 位于 1Y 与 2Y 关键点之间（曲线固化 8 个关键期限点）
        const y1 = pts.find(p => p[0] === 1)[1];
        const y2 = pts.find(p => p[0] === 2)[1];
        const v = rfFromCurve(16.8);
        const exp = y1 + (y2 - y1) * (1.4 - 1) / (2 - 1);
        if (Math.abs(v - exp) > 1e-12) throw new Error(`rfFromCurve(16.8)=${v} ≠ ${exp}`);
        if (rfFromCurve(0) !== pts[0][1]) throw new Error('下端未钳位');
        if (rfFromCurve(2400) !== pts[pts.length - 1][1]) throw new Error('上端未钳位');
        if (rfFromCurve(24) !== y2) throw new Error('24M 应精确命中 2Y 点');
    });
}
