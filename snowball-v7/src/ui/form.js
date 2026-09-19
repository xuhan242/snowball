// form.js - 参数表单：读取、校验、联动、预设、rf 三模式状态机
// P 对象字段与单位 = 唯一参数契约（v7-design.md §3），core/ 只消费不构造。

import { MARKET, PRESETS, RF_CURVE, rfFromCurve } from '../data/market.js';
import { fmtPct } from '../core/format.js';

export const formState = {
    rfMode: 'curve', // curve | custom | fixed2
    mode: 'pricing'  // pricing | reverse
};

const $ = id => document.getElementById(id);

// ====== 参数契约（与 v5 buildParamsFromForm 逐字段对齐） ======
export function buildParams() {
    const volModel = $('volModel').value;
    const useLocalVol = volModel === 'cev';
    const useJump = volModel === 'jump';
    const couponMode = $('couponMode').value;
    const isTiered = couponMode === 'tiered';
    const koMode = $('koMode').value;
    const cFixedRaw = parseFloat($('coupon').value);
    const cFixed = isNaN(cFixedRaw) ? 0 : cFixedRaw / 100;
    const cEarly = parseFloat($('couponEarly')?.value || '0') / 100;
    const cLate = parseFloat($('couponLate')?.value || '0') / 100;
    const cDivRaw = parseFloat($('couponDiv')?.value);
    const cDivFallback = isTiered ? cLate : cFixed;
    const cDiv = isNaN(cDivRaw) ? cDivFallback : cDivRaw / 100;
    const koFixedRaw = parseFloat($('ko').value);
    const koFixed = isNaN(koFixedRaw) ? 0 : koFixedRaw / 100;
    const koStart = (parseFloat($('koStart').value) || 100) / 100;
    const P = {
        s0: parseFloat($('s0').value),
        koPct: koMode === 'descending' ? koStart : koFixed,
        kiPct: parseFloat($('ki').value) / 100,
        couponRate: isTiered ? cEarly : cFixed,
        couponDiv: cDiv,
        couponTiered: isTiered,
        couponEarly: cEarly,
        couponLate: cLate,
        couponSwitchMonth: parseInt($('couponSwitchMonth')?.value || '1'),
        tenorMonths: parseInt($('tenor').value),
        lockoutMonths: parseInt($('lockout').value),
        vol: parseFloat($('vol').value) / 100,
        rf: parseFloat($('rf').value) / 100,
        div: parseFloat($('div').value) / 100,
        marginRate: parseFloat($('margin').value) / 100,
        notional: parseFloat($('notional').value) || 1,
        nPaths: parseInt($('npaths').value),
        useLocalVol: useLocalVol,
        useJump: useJump,
        jumpLambda: parseFloat($('jumpLambda').value) || 0.5,
        jumpMean: parseFloat($('jumpMean').value) || 0,
        jumpStd: parseFloat($('jumpStd').value) || 0.08,
        koMode: koMode,
        koStartPct: koStart,
        koStepPct: (parseFloat($('koStep').value) || 0.5) / 100,
        useBB: $('useBB')?.checked ?? true
    };
    P.tenorYears = P.tenorMonths / 12;
    P.nSteps = Math.max(Math.round(P.tenorYears * 252), 1);
    P.strikeRef = P.s0;
    return P;
}

// ====== 参数校验 ======
export function validate(P) {
    const errs = [];
    if (!P.s0 || P.s0 <= 0) errs.push('期初价格必须 > 0');
    if (!P.kiPct || P.kiPct <= 0) errs.push('敲入价必须 > 0');
    if (!P.tenorMonths || P.tenorMonths < 3) errs.push('期限至少 3 个月');
    if (!P.vol || P.vol <= 0) errs.push('波动率必须 > 0');
    if (P.koMode === 'fixed' && !P.koPct) errs.push('敲出价不能为空');
    if (P.koMode === 'descending' && !P.koStartPct) errs.push('起始敲出价不能为空');
    if (P.koMode === 'fixed' && P.koPct > 0 && P.koPct <= P.kiPct) errs.push('固定敲出价必须高于敲入价');
    if (P.lockoutMonths >= P.tenorMonths) errs.push('锁定期必须短于期限');
    if (formState.mode === 'pricing' && P.couponRate <= 0) errs.push('敲出票息率必须 > 0');
    if (P.couponTiered && (!P.couponEarly || !P.couponLate)) errs.push('分段票息模式需填写早期/晚期票息');
    return errs;
}

// ====== rf 三模式（curve / custom / fixed2） ======
export function curveRfValue() {
    const tenor = parseInt($('tenor').value) || 24;
    return rfFromCurve(tenor);
}

function renderRfFootnote() {
    const note = $('rfNote');
    const btnCurve = $('rfCurveBtn');
    const v = parseFloat($('rf').value);
    const curveDate = RF_CURVE.date && RF_CURVE.date.length === 8
        ? `${RF_CURVE.date.slice(0, 4)}-${RF_CURVE.date.slice(4, 6)}-${RF_CURVE.date.slice(6, 8)}`
        : RF_CURVE.date;
    if (formState.rfMode === 'curve') {
        note.textContent = `中债国债收益率曲线 · ${curveDate}`;
        if (btnCurve) btnCurve.style.display = 'none';
    } else if (formState.rfMode === 'fixed2') {
        note.textContent = '固定口径 2%';
        if (btnCurve) btnCurve.style.display = '';
    } else {
        const dev = (v - curveRfValue()) * 10000;
        const sign = dev >= 0 ? '+' : '';
        note.textContent = `自定义 · 偏离曲线 ${sign}${dev.toFixed(1)}bp`;
        if (btnCurve) btnCurve.style.display = '';
    }
}

// curve 态下按当前 tenor 重写 rf（预设/期限联动只在此态生效）
export function refreshCurveRf() {
    if (formState.rfMode !== 'curve') return;
    $('rf').value = (curveRfValue() * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    renderRfFootnote();
}

// ====== 表单联动 ======
export function onCodeChange() {
    const m = MARKET[$('code').value];
    if (!m) return;
    const s0El = $('s0'), volEl = $('vol'), divEl = $('div');
    if (!s0El.value) s0El.value = m.price;
    if (!volEl.value) volEl.value = (m.vol * 100).toFixed(2);
    if (!divEl.value) divEl.value = (m.div * 100).toFixed(2);
}

export function onKoModeChange() {
    const mode = $('koMode').value;
    $('koFixedGroup').style.display = mode === 'fixed' ? '' : 'none';
    $('koDescStartGroup').style.display = mode === 'descending' ? '' : 'none';
    $('koDescStepGroup').style.display = mode === 'descending' ? '' : 'none';
}

export function onCouponModeChange() {
    const isTiered = $('couponMode').value === 'tiered';
    $('couponFixedGroup').style.display = isTiered ? 'none' : '';
    $('couponEarlyGroup').style.display = isTiered ? '' : 'none';
    $('couponSwitchGroup').style.display = isTiered ? '' : 'none';
    $('couponLateGroup').style.display = isTiered ? '' : 'none';
}

export function onVolModelChange() {
    const isJump = $('volModel').value === 'jump';
    $('jumpLambdaGroup').style.display = isJump ? '' : 'none';
    $('jumpMeanGroup').style.display = isJump ? '' : 'none';
    $('jumpStdGroup').style.display = isJump ? '' : 'none';
    $('useBB').disabled = isJump;
    if (isJump) $('useBB').checked = false;
}

export function onModeChange() {
    const mode = document.querySelector('input[name="pricingMode"]:checked').value;
    formState.mode = mode;
    const targetGroup = $('targetPriceGroup');
    const couponModeWrap = $('couponMode').closest('.form-group');
    if (mode === 'reverse') {
        targetGroup.style.display = '';
        $('couponFixedGroup').style.display = 'none';
        couponModeWrap.style.display = 'none';
        $('couponEarlyGroup').style.display = 'none';
        $('couponSwitchGroup').style.display = 'none';
        $('couponLateGroup').style.display = 'none';
        $('submitBtn').textContent = '反推票息';
    } else {
        targetGroup.style.display = 'none';
        couponModeWrap.style.display = '';
        onCouponModeChange();
        $('submitBtn').textContent = '开始分析';
    }
}

// ====== 参数摘要 ======
export function updateParamSummary() {
    const code = $('code').value;
    const name = MARKET[code]?.name || code;
    const isTiered = $('couponMode').value === 'tiered';
    const couponTxt = isTiered
        ? `${$('couponEarly').value || '0'}%→${$('couponLate').value || '0'}%`
        : `${$('coupon').value || '0'}%`;
    const koTxt = $('koMode').value === 'descending'
        ? `${$('koStart').value || '100'}%-${$('koStep').value || '0'}%`
        : `${$('ko').value || '—'}%`;
    const html = `<b>${name}</b><span class="sep">|</span>期限${$('tenor').value || '—'}月`
        + `<span class="sep">|</span>票息${couponTxt}`
        + `<span class="sep">|</span>敲入${$('ki').value || '—'}%`
        + `<span class="sep">|</span>敲出${koTxt}`
        + `<span class="sep">|</span>波动率${$('vol').value || '—'}%`;
    document.getElementById('paramSummary').innerHTML = html;
}

export function updateStressParamsSummary() {
    const code = $('code').value;
    const name = MARKET[code]?.name || code;
    const el = document.getElementById('stressParamText');
    if (el) {
        el.textContent = `${name} | 期限 ${$('tenor').value}月 | 敲入 ${$('ki').value}% | 敲出 ${$('ko').value}% | 波动率 ${$('vol').value}% | 路径数 ${$('npaths').value}`;
    }
}

// ====== 预设加载（v7：预设不含 rf，curve 态按 tenor 填充） ======
export function loadPreset(idx) {
    const p = PRESETS[idx];
    if (!p) return;
    $('code').value = p.code;
    $('s0').value = p.s0;
    $('ki').value = p.ki;
    $('ko').value = p.ko;
    $('koMode').value = p.koMode;
    $('koStart').value = p.koStart;
    $('koStep').value = p.koStep;
    $('vol').value = p.vol;
    $('div').value = p.div;
    $('tenor').value = p.tenor;
    $('lockout').value = p.lockout;
    $('couponMode').value = p.couponMode;
    $('coupon').value = p.coupon;
    if ($('couponEarly')) $('couponEarly').value = p.couponEarly;
    if ($('couponLate')) $('couponLate').value = p.couponLate;
    if ($('couponDiv')) $('couponDiv').value = p.couponDiv;
    if ($('couponSwitchMonth')) $('couponSwitchMonth').value = p.couponSwitchMonth;
    $('npaths').value = p.npaths;
    $('volModel').value = p.volModel;
    $('margin').value = p.margin;
    $('notional').value = p.notional;
    if ($('jumpLambda')) $('jumpLambda').value = p.jumpLambda;
    if ($('jumpMean')) $('jumpMean').value = p.jumpMean;
    if ($('jumpStd')) $('jumpStd').value = p.jumpStd;
    if ($('useBB')) $('useBB').checked = p.useBB;
    onCodeChange();
    onKoModeChange();
    onCouponModeChange();
    onVolModelChange();
    refreshCurveRf();
    updateParamSummary();
    updateStressParamsSummary();
    document.dispatchEvent(new CustomEvent('sb7:preset-loaded', { detail: { preset: p } }));
}

// ====== 初始化装配 ======
export function initForm(showToast) {
    $('code').addEventListener('change', () => { onCodeChange(); updateParamSummary(); updateStressParamsSummary(); });
    $('koMode').addEventListener('change', onKoModeChange);
    $('couponMode').addEventListener('change', onCouponModeChange);
    $('volModel').addEventListener('change', onVolModelChange);
    document.querySelectorAll('input[name="pricingMode"]').forEach(r => r.addEventListener('change', onModeChange));
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            loadPreset(parseInt(btn.dataset.preset));
            showToast('已加载预设：' + PRESETS[parseInt(btn.dataset.preset)].name);
        });
    });

    // rf 三模式事件
    $('rf').addEventListener('input', () => {
        if (formState.rfMode !== 'custom') formState.rfMode = 'custom';
        renderRfFootnote();
    });
    $('rfFixed2Btn').addEventListener('click', () => {
        formState.rfMode = 'fixed2';
        $('rf').value = '2.00';
        renderRfFootnote();
    });
    $('rfCurveBtn').addEventListener('click', () => {
        formState.rfMode = 'curve';
        refreshCurveRf();
    });
    $('tenor').addEventListener('change', refreshCurveRf);

    // 更多设置折叠
    const advRow = $('advSettings');
    $('advToggle').addEventListener('click', () => advRow.classList.toggle('collapsed'));

    // 参数栏折叠（仅定价 Tab 有效，回测/压测 Tab 隐藏参数栏）
    const collapseBtn = document.getElementById('railToggle');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            const collapsed = document.body.classList.toggle('rail-collapsed');
            collapseBtn.textContent = collapsed ? '展开参数 ▼' : '收起参数 ▲';
            collapseBtn.setAttribute('aria-expanded', String(!collapsed));
        });
    }

    refreshCurveRf();
    updateParamSummary();
    updateStressParamsSummary();
}
