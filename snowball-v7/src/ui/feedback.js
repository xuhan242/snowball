// feedback.js - 全局反馈组件：toast / loading / 执行模式
const $ = id => document.getElementById(id);

let toastTimer = null;
export function showToast(msg, ms = 3000) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function showLoading(title, sub) {
    if (title !== undefined) $('loadingTitle').textContent = title;
    if (sub !== undefined) $('loadingSub').textContent = sub;
    $('loading').classList.add('active');
}

export function hideLoading() {
    $('loading').classList.remove('active');
}

export function setExecMode(text) {
    $('execMode').textContent = '执行模式：' + text;
    $('execModeFooter').textContent = text;
}

export function nextFrame() {
    return new Promise(r => {
        let settled = false;
        const settle = () => { if (!settled) { settled = true; r(); } };
        requestAnimationFrame(() => requestAnimationFrame(settle));
        setTimeout(settle, 100);
    });
}
