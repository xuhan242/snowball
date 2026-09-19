# snowball-v7 设计稿

> 版本：v7.0.0 ｜ 算法基线：snowball-v5 `src/legacy`（= v4.101 运行时同源）｜ 日期：2026-09-17

## 1. 目标与硬性约束

1. **单 HTML 可运行**：`dist/index.html` 双击即可运行（`file://` 协议），体积 < 450KB。
2. **功能全保留**：v4/v5 三大 Tab 共 27 项功能一项不少（清单见 §6）。
3. **算法数值可回归**：以 `tests/golden.json`（从 v5 提取）做黄金基准；CEV 默认路径逐位一致。
4. **单一架构**：只有一套运行时架构，不留备份层、不留 legacy 双轨。
5. **AI 助手不迁移**（v5 唯一增量，需 API key，违背纯离线卖点）。
6. 数据经 Wind 转载库刷新，每个数字注明来源与截止日期。

## 2. 目录结构（单一架构）

```
snowball-v7/
├── index.html                 # 页面骨架（表单 + 三 Tab + 容器）
├── vite.config.js             # vite-plugin-singlefile 单文件构建
├── src/
│   ├── main.js                # 入口：启动、Tab 切换、事件装配
│   ├── styles.css             # 设计系统（tokens + 组件样式 + 明暗主题）
│   ├── core/                  # 算法层（零 DOM 依赖，Node 可测）
│   │   ├── sobol.js           # Sobol 序列（自 v5 逐字移植，含方向数表）
│   │   ├── rng.js             # 计数器式确定性 PRNG（splitmix64，新增）
│   │   ├── paths.js           # 路径模拟：GBM / CEV / BB / Merton 跳跃
│   │   ├── payoff.js          # evaluatePaths 四分类 + 单路径 payoff
│   │   ├── pricing.js         # priceSnowball / priceWithNormals / 反推票息
│   │   ├── greeks.js          # computeGreeks (CRN) / buildGreeksSurface
│   │   ├── table.js           # buildGreeksTable 576 点查表 + 双线性插值
│   │   ├── backtest.js        # backtestHedge + 滚动 RV + 数据切片
│   │   ├── stress.js          # 四类情景构建 + runStressTest
│   │   └── format.js          # fmtMoney / fmtPct / greeks 业务口径换算
│   ├── data/
│   │   ├── market.js          # MARKET 快照 / PRESETS / RF_CURVE（手写，来源注释）
│   │   └── hist-data.js       # 历史数据（tools/fetch_data.py 生成，deflate+base64）
│   ├── workers/
│   │   ├── pool.js            # Worker 池调度（分片/合并/三级降级）
│   │   ├── workerLoader.js    # Blob Worker 装载 + file:// 检测
│   │   ├── pricing.worker.js  # 定价分片
│   │   └── greeks.worker.js   # Greeks 分片
│   ├── charts/                # Canvas 图表工具与各图实现
│   │   ├── kit.js             # 坐标轴/网格/图例/tooltip/DPR/主题
│   │   ├── pricing-charts.js  # 定价 Tab 8 图
│   │   ├── backtest-charts.js # 回测 Tab 4 图
│   │   └── stress-charts.js   # 压测 Tab 2 图
│   └── ui/
│       ├── form.js            # 参数表单：读写、联动、校验、rf 三模式
│       ├── cards.js           # 结果卡片（估值/概率/Greeks 六卡）
│       └── panels.js          # 各 Tab 面板装配（运行调度 + 渲染编排）
├── tools/
│   ├── fetch_data.py          # Wind 库取数 → src/data/hist-data.js（幂等）
│   └── extract-golden/        # v5 黄金基准提取（SSR bundle，已产出）
└── test/
    ├── run.mjs                # 测试入口
    ├── unit/                  # 算法单测（sobol/payoff/greeks/backtest/stress）
    └── golden.test.mjs        # 黄金回归（CEV 路径逐位、其余容差断言）
```

## 3. 参数契约（唯一事实源）

P 对象字段与 v5 `buildParamsFromForm` 完全一致（字段名、单位、派生规则），由 `ui/form.js`
单一函数产出，`core/` 只消费不构造：

- 小数口径：kiPct/koPct/koStartPct（比例），couponRate/couponDiv/couponEarly/couponLate、
  vol/rf/div/marginRate（小数）；表单展示为百分数。
- 派生：`tenorYears = tenorMonths/12`；`nSteps = max(round(tenorYears*252), 1)`；`strikeRef = s0`。
- 校验（提交前拦截）：s0>0；kiPct>0；tenorMonths≥3；vol>0；koMode=fixed 时 koPct>kiPct；
  lockoutMonths<tenorMonths；couponRate>0（反推模式除外）；分段票息需 early/late。

**rf 三模式**（v7 新增）：
- `curve`（默认）：按 tenorMonths 匹配 `RF_CURVE`（中债国债收益率曲线，取数脚本固化关键期限点），
  非标准期限线性插值；脚注显示「中债国债收益率曲线 · YYYY-MM-DD」。
- `custom`：用户改写输入框任意值，脚注显示与曲线值的偏离 bp。
- `fixed2`：一键回填 2.00%（卖方常用固定口径），脚注标注「固定口径 2%」。

## 4. 算法移植与三处修正

**逐字移植**（保证 CEV 路径与 v5 逐位一致）：sobol.js（含方向数表、1e-10 截断、2^k 补齐、
含 Sobol 原点作为 path 0 的既有行为）、simulatePaths（GBM/CEV）、evaluatePaths 四分类与
ACT/365 计息、computeGreeks 扰动量（ΔS=1%·S0，Δσ=1pp，ΔT=12/252 保持 nSteps，Δr=Δq=10bp）、
findCouponForPrice（二分 20 次/1e-5，分段票息同步缩放）、buildGreeksTable（24×24 自适应网格、
4096 路径、CRN 跨期截断）、backtestHedge（归因仅 Gamma+Theta+成本+残差）、stress 四类情景。

**三处修正**：
1. **跳跃扩散**（v5 缺陷：跳跃幅度复用当步扩散正态数且多跳按 (k+1) 缩放；泊松计数用
   Math.random 不可复现）→ 修正为：扩散仍用 Sobol 正态；跳跃次数与幅度改用 `rng.js`
   计数器式确定性 PRNG（seed 与参数无关，CRN 成立），每跳独立幅度 `μJ + σJ·z_k`。
2. **Brownian Bridge**（v5 缺陷：桥噪声复用生成终点的正态数，与 W_T 相关）→ 修正为：
   桥噪声来自 `rng.js` 独立确定性流，与终点正态数独立；方差核 `t(1-t)·nSteps` 不变。
3. **口径统一以代码为准**：Theta 日金额 = (PV(T-12/252y) − PV(T))/12 × N（技术手册旧版
   「/252」表述作废）；跳跃默认参数 λ=0.5、μJ=0、σJ=0.08（技术手册旧版 λ=2 作废）。

**回归策略**：CEV 定价/Greeks/曲面/查表/回测/压测与 golden 逐位或 1e-9 级一致；
GBM+BB 与 jump 模式因修正重立基线（重跑 extract-golden 时以 v7 值另存 `golden-v7-fixed.json`
并人工核对方向合理性：BB 修正后敲入概率应略升、jump 修正后均值与 v5 接近但可复现）。

## 5. 数据字典（Wind 转载库）

| 数据 | 表/字段 | 快照口径 | 固化位置 |
|---|---|---|---|
| 指数日行情 | `aindexeodprices.S_DQ_CLOSE` | 2015-01-01 ~ 最新交易日，6 指数 | `hist-data.js`（deflate+base64） |
| 最新收盘（s0） | 同上，MAX(TRADE_DT) | 快照日收盘 | `market.js` MARKET |
| 股息率 div | `aindexvaluation.DIVIDEND_YIELD` | 快照日（百分数值/100） | `market.js` MARKET |
| 波动率 vol | 近 252 日对数收益年化 RV（自算） | 快照日往前 252 交易日 | `market.js` MARKET |
| rf 曲线 | `cbondcurvecnbd`（中债国债收益率曲线，期限 0.25/0.5/1/2/3/5/7/10Y） | 快照日 | `market.js` RF_CURVE |
| 危机情景 | 自 `hist-data.js` 切片实算年化 RV | 2015 股灾/2020 新冠/2024 量化风暴 | 运行时计算（不再写死） |

- 预设 PRESETS 结构与 v5 一致（6 指数），s0/div/vol/rf 全部刷新为快照值并注释来源与日期。
- 历史数据编码：`"YYYYMMDD close;..."` 明文 → `CompressionStream('deflate')` 兼容格式由
  Python `zlib` 压缩、base64 存储；浏览器启动时 `DecompressionStream('deflate')` 解压（异步）。
- 压缩后总体积预估 120~150KB；若单文件超 450KB 预算，回退方案为窗口缩至 2018-01-01 并将
  危机区间数据单独内联（三段合计 <8KB）。

## 6. 功能清单（27 项，验收对照表）

**定价 Tab（13）**：①MC 定价（PV+四概率+SE+耗时脚注）②Greeks 六卡（1% 标准化金额 +
风险方向 + 三层业务含义 + 正绿负红零灰 + 卖方视角）③Greeks 场景计算器（S/S₀、σ、期限三输入
→ 六卡更新）④Greeks 二维曲面热力图（10 价×N 期，Delta/Gamma/Vega/Theta 四切换，KO/KI 边界
2.5px 实线、S₀ 1.6px 虚线、格内数值 badge）⑤远期 Greeks 表⑥逐观察日敲出概率柱图
⑦时间维度概率演变（堆叠面积）⑧票息累积曲线⑨路径密度聚类热图（50×50）⑩PV 密度分布
（KDE Silverman + 95%/99% VaR 虚线 + ES 填充）⑪CEV 局部波动率曲线⑫反推票息模式
（隐藏票息输入、按钮换文案）⑬ATM 远期 Greeks。
**回测 Tab（9）**：⑭五频率对比表（intraday4/2 摘要+daily/weekly/monthly 精确）⑮成本敏感度
扫描（1/3/5/10/20/50bps）⑯滚动窗口回测（逐年）⑰累计 PnL 曲线⑱绩效指标（Sharpe/Sortino/
Calmar/最大回撤 + Bootstrap 1000 次 95% CI）⑲PnL 归因分解（四项，注明 Vega 已移除）
⑳IV vs RV 对比㉑滚动 RV（20/60 日）㉒标的路径 + Delta 持仓双轴图。
**压测 Tab（5）**：㉓波动率冲击 7 档㉚价格跳跃 7 档㉛历史危机 3 情景（实算波动率）
㉜5×5 组合矩阵热图㉝压测汇总卡片（最劣情景标注）。

**不变量**（v6-prompt 第九章继承，共 29 条）：MC 路径 ≥8192；Sobol+CRN；CEV σ(S)=σ·(S₀/S)；
Vega 归因移除；回测 s0=首日收盘；Greeks 双口径换算（Delta/Gamma=g×0.01×S×N、Gamma 二阶
含 0.5 由卡片层承担、Vega=g×N、Theta=g/12×N、Rho/RhoQ=g×N）；卖方视角文案；曲面绘制顺序
格子→虚线→badge；金额智能格式化（亿/万/元）；HIST 数据独立副本不共享引用。

## 7. 视觉规范（重设计，kri-v5 纪律）

- **色板语义**：红/绿仅表达盈亏与正负；主色藏青 `#2456d6`（light）/`#5b8def`（dark）；
  强调金 `#c9a227` 用于高亮与 KO 线；中性灰分层；图表序列色板 8 色固定顺序。
- **明暗双主题**：CSS custom properties 切换，默认 light，持久化 localStorage。
- **字阶**：12（脚注/轴标）/13（表格）/14（正文）/16（卡片标题）/20（页标题）；数字一律
  `tabular-nums`。
- **组件**：卡片 radius 10px + 细边框 + 浅阴影；每个结果卡片带口径脚注（数据来源/截止日/
  计算口径）；空态统一文案样式；表格斑马纹 + 数字右对齐。
- **布局**：顶栏（标题/版本/主题切换/Worker 状态）+ 左侧参数栏（264px，预设按钮 6 枚）+
  主区 Tab + 卡片网格（自流式，桌面优先，最小宽 1200px）。

## 8. 性能与构建

- Worker 池：默认 `hardwareConcurrency`（上限 32），按路径分片、Transferable 零拷贝
  （slice 而非 subarray）、120s 超时、三级降级（并行→合并单任务→主线程串行），
  `file://` 下直接走主线程（Blob module worker 不可用）。
- 构建目标：`dist/index.html` < 450KB；预算：JS ~250KB + 数据 ~140KB + CSS ~45KB + HTML ~8KB。
- 后台 Tab 节流应对：曲面每行 yield、查表每 24 点 yield、回测每 200 天 yield。
