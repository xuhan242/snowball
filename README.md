# Snowball Demo

> 雪球结构期权定价 · Greeks 风险分解 · 对冲回测 · 压力测试 一体化系统
> 单文件 Vanilla JS · 双击即可运行

面向券商衍生品业务部面试演示的雪球结构自动定价与风控系统。基于纯 Vanilla JS + Vite 构建，最终产物为单个 `dist/index.html`（< 450KB），可在 `file://` 协议下零外部依赖运行（字体走 CDN）。

## 核心能力

**定价分析 Tab** — Monte Carlo 定价、6 维 Greeks 卡片（Delta/Gamma/Vega/Theta/Rho/RhoQ）、Greeks 场景计算器、Greeks 二维曲面热力图、远期 Greeks、敲出概率分布、时间维度概率演变、票息累积、路径密度聚类、PV 概率密度分布、CEV 局部波动率曲线、Brent 反推票息率。

**对冲回测 Tab** — 5 种对冲频率对比（日内 4 次 / 日内 2 次 / 日 1 次 / 周 1 次 / 月 1 次）、成本敏感性扫描（7 档 bps）、滚动窗口回测、累计盈亏曲线、标的路径与 Delta 持仓、盈亏归因分解（Gamma + Theta + 成本 + 残差）、IV vs RV 对比、Bootstrap 置信区间。

**压力测试 Tab** — 波动率冲击（±5/±10/±20pp）、价格跳跃（±5/±10/±20%）、历史危机情景（2015 股灾 / 2020 新冠 / 2024 量化风暴）、5×5 组合情景矩阵。

**全局功能** — 深色 / 浅色 / 跟随系统三态主题、骨架屏、错误重试、参数折叠、6 套指数预设（中证500/沪深300/中证1000/上证50/创业板指/科创50）。

## 技术架构

```
运行时活跃代码  = src/legacy/   (UI + 算法)
                + src/workers/  (Worker Pool 多线程并行)

设计备份        = src/core/     (算法层，与 legacy 数值等价)
                + src/store/    (pub-sub 状态层)
                + src/canvas/   (Canvas 绘图原语)
                + src/utils/    (工具层，部分活跃)
```

### 算法层

- **Sobol 低差异序列 + Brownian Bridge**：替代伪随机数，收敛速度从 $O(1/\sqrt{N})$ 提升到 $O(1/N)$；756 维方向数 + Acklam 正态逆 CDF（误差 < 1.15e-9）；localStorage 缓存 2MB
- **CRN 有限差分 Greeks**：所有 ±Δ 扰动共享同一组 Sobol normals，MC 噪声在差分中相关抵消；中心差分 Delta/Gamma/Vega/Rho/RhoQ，Theta 缩期限保 nSteps 严格 CRN
- **Merton 跳跃扩散**：A 股标的跳空风险建模，显著提升敲入概率拟合精度（纯 GBM 系统性低估）
- **CEV 局部波动率**：σ(S) = σ_ATM × (S₀/S)，捕捉波动率微笑
- **Brent 方法反推票息**：8-12 次迭代收敛（vs 朴素二分 20-30 次）

### Worker Pool

- 池规模自适应 `navigator.hardwareConcurrency || 4`，支持 `?workers=N` URL 参数覆盖
- 路径切分：主线程生成 Sobol normals 后按路径段切分，Transferable 零拷贝传递给 Worker
- **三级降级链**：URL Worker → Blob Worker → 主线程串行；`file://` 协议自动降级
- **合并优化**：Worker 失败时通过 `mergeFn` 合并 N 个 shards 为 1 个主线程调用，避免 N 倍串行开销

## 快速开始

### 环境要求

- Node.js ≥ 18（推荐 20 LTS）
- 现代浏览器（Chrome 100+ / Edge 100+ / Firefox 100+）

### 开发与构建

```bash
npm install
npm run dev          # Vite dev server (http://127.0.0.1:5173)
npm run build        # 产物: dist/index.html (< 450KB)
npm run preview      # 预览生产构建
```

双击 `dist/index.html` 即可在 `file://` 协议下运行。

### 测试

```bash
npm test             # = test:smoke + test:unit
npm run test:smoke   # 12 项 smoke 测试
npm run test:unit    # 单元测试 (pure Node.js)
npm run test:perf    # 4 项性能基准 (pricing/greeks/surface/backtest)
```

## 目录结构

```
snowball-v4/
├── index.html              # HTML 骨架（含全部 CSS，无 JS 内联）
├── vite.config.js          # vite-plugin-singlefile 配置
├── package.json
├── README.md / RULES.md     # 项目说明 / 规则（八荣八耻 + 不变量）
├── docs/
│   ├── v4-upgrade-plan.md   # 升级纲领（12 条不变量 + Phase 0-9 计划）
│   └── v4-iteration-log.md  # 100 轮迭代记录
├── hist_data/              # 6 个 A 股指数历史数据 (2021-01-04 ~ 2026-06-30, 1328 条/标的)
│   ├── 000016.txt / 000300.txt / 000688.txt
│   ├── 000852.txt / 000905.txt / 399006.txt
│   └── *.csv               # 原始 4 列格式（备用）
├── src/
│   ├── main.js             # 入口：import './legacy/main.js'
│   ├── legacy/             # 运行时活跃代码
│   │   ├── main.js         # UI + 事件 + Worker Pool 调度
│   │   ├── canvas.js       # 全部 Canvas 绘图函数
│   │   ├── gbm.js          # 路径模拟 + 定价 + Greeks
│   │   ├── sobol.js        # Sobol 序列 + 正态变换
│   │   ├── backtest.js     # 回测引擎 + Greeks 查表
│   │   ├── stress.js       # 压力测试情景
│   │   └── data.js         # 6 指数预设模板
│   ├── workers/            # Worker Pool (活跃)
│   │   ├── pool.js         # WorkerPool: runShards/runByPath/降级链
│   │   ├── workerLoader.js # Worker 工厂注入 + file:// 检测
│   │   ├── pricing.worker.js   # 定价 Worker (computePricingPartial + merge)
│   │   ├── greeks.worker.js     # Greeks Worker (9 扰动场景 CRN)
│   │   ├── backtest.worker.js   # 回测 Worker (buildTable + LRU 缓存)
│   │   └── stress.worker.js     # 压测 Worker
│   ├── core/               # 算法层（设计备份，与 legacy 数值等价）
│   │   ├── sobol.js / gbm.js / pricing.js / greeks.js
│   │   ├── greeks-table.js / hedge.js / backtest.js / stress.js / data.js
│   ├── store/              # 状态层（pub-sub，设计备份）
│   ├── canvas/             # Canvas 原语（axes.js + theme.js）
│   └── utils/              # 工具层（url/lru 被 workers 引用，其余备份）
│       ├── brent.js / lru.js / url.js / format.js / dom.js / perf.js
└── test/
    ├── smoke.mjs           # 12 项 smoke 测试
    ├── unit/               # 单元测试 (5 个文件)
    └── perf/               # 4 项性能基准
```

## 核心算法

### 雪球 Payoff 四象限

| 路径类型 | 收益 | 触发条件 |
|---|---|---|
| 敲出 | 按持有月份折算票息 | 观察日 S ≥ 敲出价 |
| 红利票息 | 到期拿满票息 | 未敲入未敲出到期 |
| 敲入亏损 | 承担跌幅 | 曾敲入且到期亏损 |
| 敲入赎回 | 拿回本金 | 曾敲入但到期回升 |

计息基准：**ACT/365**（自然日，ty = 月数 / 12）

### Greeks 业务口径（长江证券衍生品业务部标准）

| Greek | 口径 |
|---|---|
| Delta / Gamma | 1% 标的变动影响（金额） |
| Vega | 1pp 波动率变动影响（金额） |
| Theta | 每日变动影响（金额） |
| Rho / RhoQ | 1bp 利率 / 股息率变动影响（金额） |

### CRN 有限差分公式

```
delta = (PV(s₀+ds) - PV(s₀-ds)) / (2·ds)     // 共享 normals，差分消去 MC 噪声
gamma = (PV(s₀+ds) - 2·PV(s₀) + PV(s₀-ds)) / ds²
vega  = (PV(vol+v) - PV(vol-v)) / (2·v) / 100
theta = PV(tenor-12d) - PV(tenor)              // 保持 nSteps 不变，dt 自动变小
rho   = (PV(rf+10bp) - PV(rf-10bp)) / (2·10bp) / 100
rhoQ  = (PV(div+10bp) - PV(div-10bp)) / (2·10bp) / 100
```

MC 路径数下限 `nPaths ≥ 8192`（默认 8192，可选 16384 / 32768）。

## 性能指标

| 场景 | 目标 | 实测 |
|---|---|---|
| MC 定价 (8192 路径, 4 Worker) | < 1s | < 1s ✓ |
| Greeks (CRN 9 扰动) | < 2s | < 2s ✓ |
| Greeks 二维曲面 (10×6=60 点) | < 15s | < 15s ✓ |
| 回测建表 (24×24=576 格) | < 30s | < 30s ✓ |
| 压力测试 (25 情景) | ≈ 10×单次定价 | ✓ |

构建产物体积：`dist/index.html < 450KB`（含全部 JS + CSS + 6 指数历史数据）。

## 键盘快捷键

| 键位 | 功能 |
|---|---|
| `1` / `2` / `3` | 切换到 定价 / 回测 / 压测 Tab |
| `Ctrl+Enter` / `Cmd+Enter` | 提交当前 Tab 主表单 |
| `t` | 切换深色 / 浅色主题 |
| `d` | 启动 / 停止演示模式 |
| `p` | 打开 / 关闭性能面板 |
| `?` | 显示快捷键帮助 |
| `Esc` | 关闭弹层 / 停止演示 |

输入框内单字符快捷键自动禁用，避免误触。

## 数据来源

- 6 个 A 股指数历史数据：中证500 / 沪深300 / 中证1000 / 上证50 / 创业板指 / 科创50
- 数据区间：2021-01-04 ~ 2026-06-30，1328 条/标的（日频收盘价）
- 市场数据快照：同花顺 iFinD MCP（截至 2026-07-13）
- 股息率：沪深300=2.91% / 中证500=1.24% / 中证1000=1.06% / 上证50=3.54% / 创业板指=0.84% / 科创50=0.16%

## 工程约束

- **单文件产出**：`npm run build` 产出 `dist/index.html`，`file://` 可运行，零外部依赖
- **纯 Vanilla JS**：禁止 React / Vue / Svelte / TypeScript；禁止运行时依赖
- **核心算法零改动**：`core/sobol.js`、`core/gbm.js`、`core/backtest.js`、`core/stress.js` 仅允许添加 JSDoc 注释
- **CRN 一致性**：所有 Worker 接收同一组 Sobol normals 的不同路径段，合并顺序无关，结果与单线程完全一致（容差 < 1e-10）
- **Greeks 双口径**：Delta/Gamma 显示为 1% 标的变动影响金额，Vega 为 1pp 波动率变动金额，Theta 为每日变动金额，Rho/RhoQ 为 1bp 变动金额
- **MC 路径数下限**：所有定价与风险计算 `nPaths ≥ 8192`
- **Vega 归因移除**：归因组件简化为 Gamma + Theta + 交易成本 + 离散损耗（30 日滚动 RV 做 Vega 归因是概念错误）
