// cards.js - 结果卡片 HTML 生成（Greeks 六卡文案逐条移植 v5）+ 反馈组件（骨架/错误/提示）

import { fmtMoney } from '../core/format.js';

// Greeks 六卡：金额口径由调用方换算传入；文案条件分支与 v5 main.js ~L341-400 一致
export function buildGreeksCards(greeks, _fm, _dc, _gc, _vc, _tc, _rc, _rqc, _vki, _vko) {
    const vegaSkewNote = greeks.vegaKI !== undefined && (Math.abs(greeks.vegaKI) > 1e-9 || Math.abs(greeks.vegaKO) > 1e-9)
        ? ` KI处Vega ${_fm(_vki || 0)}，KO处Vega ${_fm(_vko || 0)}${Math.abs((_vki || 0) - (_vko || 0)) > 1000 ? '，偏斜敞口' + _fm(Math.abs((_vki || 0) - (_vko || 0))) : ''}。` : '';
    const cards = [
        {
            name: 'Delta', sym: 'δ', val: _dc, fmt: _fm(_dc),
            tag: greeks.delta > 0 ? '▲ 多头敞口' : '▼ 空头敞口', tagCls: 'imp',
            quant: `标的涨1% → 卖方${greeks.delta > 0 ? '盈利' : '亏损'} ${_fm(Math.abs(_dc))}`,
            risk: `标的涨→敲入概率降→卖方负债降。${greeks.delta > 0 ? '多头敞口：标的涨对卖方有利' : '空头敞口：标的涨对卖方不利'}。量级占名义本金 ${(Math.abs(greeks.delta) * 100).toFixed(2)}%。`,
            hedge: `${greeks.delta > 0 ? '做空' : '做多'}标的，对冲比率约 ${(Math.abs(greeks.delta) * 100).toFixed(1)}% 名义本金。优先级：高，每日调仓。`
        },
        {
            name: 'Gamma', sym: 'γ', val: _gc, fmt: _fm(_gc),
            tag: greeks.gamma < 0 ? '▼ 凸性空头' : '▲ 凸性多头', tagCls: Math.abs(_gc) < Math.abs(_dc) * 0.1 ? 'sec' : 'imp',
            quant: `标的涨1% → Delta变化 ${_fm(_gc)}`,
            risk: `${greeks.gamma < 0 ? '负Gamma=凸性空头，标的大幅偏离期初价时卖方亏损加速' : '正Gamma=凸性多头，标的大幅波动时卖方有利'}。当前 |Gamma| ${Math.abs(_gc) < Math.abs(_dc) * 0.1 ? '远小于 Delta，凸性风险可忽略' : '接近或超过 Delta，凸性风险显著'}。`,
            hedge: `${Math.abs(_gc) < Math.abs(_dc) * 0.1 ? '当前无需特别处理。若 Gamma 增大，提高对冲频率至日内2次' : '需提高对冲频率至日内2-4次，监控 Delta 变化加速度'}。`
        },
        {
            name: 'Vega', sym: 'ν', val: _vc, fmt: _fm(_vc),
            tag: greeks.vega < 0 ? '▼ 做空波动率' : '▲ 做多波动率', tagCls: 'core',
            quant: `vol升1pp → 卖方${greeks.vega < 0 ? '盈利' : '亏损'} ${_fm(Math.abs(_vc))}`,
            risk: `${greeks.vega < 0 ? '做空波动率，雪球卖方"卖保险"赚取波动率风险溢价' : '做多波动率'}。Vega 是雪球对冲盈亏的主导因素，量级最大（占名义本金 ${(Math.abs(greeks.vega) * 100).toFixed(2)}%）。${vegaSkewNote}`,
            hedge: `监控 IV 与 RV 价差。IV 显著高于 RV 时可买入波动率对冲。优先级：最高，核心风险敞口。`
        },
        {
            name: 'Theta', sym: 'θ', val: _tc, fmt: _fm(_tc) + '/天',
            tag: greeks.theta < 0 ? '▼ 时间衰减' : '▲ 时间收入', tagCls: 'imp',
            quant: `每过1天 → 卖方${greeks.theta < 0 ? '亏损' : '盈利'} ${_fm(Math.abs(_tc))}`,
            risk: `${greeks.theta < 0 ? '负Theta=时间衰减，期限缩短→票息累积减少→卖方亏损' : '正Theta=时间收入'}。年化约 ${_fm(Math.abs(_tc) * 252)}，需通过对冲盈亏覆盖。`,
            hedge: `Theta 是被动承受项，无法直接对冲。需保证 Delta+Vega 对冲盈利足以覆盖 Theta 衰减。`
        },
        {
            name: 'Rho', sym: 'ρ', val: _rc, fmt: _fm(_rc),
            tag: '○ 利率敏感', tagCls: 'sec',
            quant: `利率升1bp → 卖方${greeks.rho > 0 ? '盈利' : '亏损'} ${_fm(Math.abs(_rc))}`,
            risk: `利率影响贴现因子。${greeks.rho < 0 ? '加息→贴现因子降→PV降→卖方负债降，对卖方有利' : '加息对卖方不利'}。量级仅为 Vega 的 ${(Math.abs(_rc) / Math.max(Math.abs(_vc), 1) * 100).toFixed(0)}%。`,
            hedge: `通常不对冲。雪球期限1-2年，利率变动有限，Rho 影响可忽略。`
        },
        {
            name: 'RhoQ', sym: 'ρQ', val: _rqc, fmt: _fm(_rqc),
            tag: '○ 分红敏感', tagCls: 'sec',
            quant: `股息升1bp → 卖方${greeks.rhoQ > 0 ? '盈利' : '亏损'} ${_fm(Math.abs(_rqc))}`,
            risk: `股息率影响标的漂移 μ=r-q。${greeks.rhoQ < 0 ? '分红升→漂移降→敲入概率降→卖方负债降，对卖方有利' : '分红升对卖方不利'}。敏感度是 Rho 的 ${(Math.abs(_rqc) / Math.max(Math.abs(_rc), 1)).toFixed(1)} 倍。`,
            hedge: `关注成分股分红季（6-8月），分红高峰前可适当调整 Delta 对冲比率。`
        }
    ];
    let html = '<div class="greek-cards">';
    for (const c of cards) {
        const valCls = c.val > 0 ? 'pos' : (c.val < 0 ? 'neg' : 'neu');
        html += `<div class="greek-card">
<div class="greek-card-head"><div class="greek-card-title"><span class="greek-card-arrow">▼</span>${c.name} <span>${c.sym}</span></div><div class="greek-card-value ${valCls}">${c.fmt}</div></div>
<div class="greek-card-tag ${c.tagCls}">${c.tag}</div>
<div class="greek-card-quant">${c.quant}</div>
<div class="greek-card-detail"><div class="greek-card-detail-row"><strong>风险机理</strong><span>${c.risk}</span></div><div class="greek-card-detail-row"><strong>对冲建议</strong><span>${c.hedge}</span></div></div>
</div>`;
    }
    html += '</div>';
    return html;
}

// 骨架屏三型
export function showSkeleton(target, type) {
    if (!target) return;
    let html = '';
    if (type === 'pricing') {
        html = '<div class="skeleton-grid">' + '<div class="skeleton-block skeleton-card"></div>'.repeat(4) + '</div>' + '<div class="skeleton-block skeleton-chart"></div>'.repeat(3);
    } else if (type === 'backtest') {
        html = '<div class="skeleton-block skeleton-chart"></div>'.repeat(3);
    } else if (type === 'stress') {
        html = '<div class="skeleton-grid">' + '<div class="skeleton-block skeleton-card"></div>'.repeat(3) + '</div>' + '<div class="skeleton-block skeleton-chart"></div>';
    }
    target.innerHTML = html;
    target.style.display = '';
}

// 计算错误卡（转义消息 + 重试）
export function showComputationError(container, error, retryFn) {
    const msg = (error && error.message) || String(error);
    const esc = msg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (!container) {
        console.error('[showComputationError] container 为 null，原始错误:', error);
        return;
    }
    container.style.display = '';
    container.innerHTML = `
        <div class="error-card">
            <div class="error-title">计算出错</div>
            <div class="error-msg">${esc}</div>
            ${retryFn ? '<button class="error-retry" type="button">重试</button>' : ''}
        </div>`;
    const retryBtn = container.querySelector('.error-retry');
    if (retryBtn && retryFn) retryBtn.addEventListener('click', retryFn);
}

// 参数提示卡（非错误但需持久提示）
export function showHintCard(container, title, bodyHtml) {
    if (!container) return;
    container.style.display = '';
    container.innerHTML = `
        <div class="hint-card">
            <div class="hint-title">${title}</div>
            <div class="hint-body">${bodyHtml}</div>
        </div>`;
}
