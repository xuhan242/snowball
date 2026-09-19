// main.js - 入口：主题、Tab 切换、全局兜底、面板装配
import './styles.css';
import { MARKET_SNAPSHOT_DATE } from './data/market.js';
import { initForm, loadPreset } from './ui/form.js';
import { initPanels } from './ui/panels.js';
import { showToast, setExecMode } from './ui/feedback.js';

const $ = id => document.getElementById(id);

// ====== 主题：三态循环 auto → light → dark，localStorage['sb7-theme'] ======
const THEME_KEY = 'sb7-theme';
const themeLabel = () => ({ auto: '自动', light: '浅色', dark: '深色' });

function applyTheme(mode) {
    if (mode === 'auto') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', mode);
    }
    $('themeLabel').textContent = themeLabel()[mode];
}

function cycleTheme() {
    const cur = localStorage.getItem(THEME_KEY) || 'auto';
    const next = cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto');
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    document.dispatchEvent(new CustomEvent('sb7:theme-changed', { detail: { theme: next } }));
}

function initTheme() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
    $('themeToggle').addEventListener('click', cycleTheme);
}

// ====== Tab 切换 ======
const TAB_IDS = ['pricing', 'backtest', 'stress'];

function switchTab(tab) {
    document.body.classList.remove('tab-pricing', 'tab-backtest', 'tab-stress');
    document.body.classList.add('tab-' + tab);
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    TAB_IDS.forEach(t => {
        const el = $('result-' + t);
        if (el) el.classList.toggle('active', t === tab);
    });
    document.dispatchEvent(new CustomEvent('sb7:tab-changed', { detail: { tab } }));
}

function initTabs() {
    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

// ====== 全局兜底 ======
function initGlobalGuards() {
    window.addEventListener('error', e => {
        try { document.getElementById('loading').classList.remove('active'); } catch (_) {}
        showToast('发生未预期错误: ' + ((e.error && e.error.message) || e.message || '未知'));
        ['submitBtn', 'btSubmitBtn', 'btMultiFreqBtn', 'btCostScanBtn', 'btRollingBtn', 'runStressBtn'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.disabled = false;
        });
    });
    window.addEventListener('unhandledrejection', e => {
        try { document.getElementById('loading').classList.remove('active'); } catch (_) {}
        showToast('计算异常中断: ' + ((e.reason && e.reason.message) || e.reason || '未知'));
        ['submitBtn', 'btSubmitBtn', 'btMultiFreqBtn', 'btCostScanBtn', 'btRollingBtn', 'runStressBtn'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.disabled = false;
        });
    });
}

// ====== 启动 ======
function boot() {
    initTheme();
    initTabs();
    initGlobalGuards();

    $('snapshotDate').textContent = MARKET_SNAPSHOT_DATE;
    $('versionFooter').textContent = $('versionDisplay').textContent;
    $('buildTimeDisplay').textContent = '零外部依赖 · file:// 可运行';
    setExecMode('就绪');

    initForm(showToast);
    loadPreset(0);
    initPanels();
}

boot();
