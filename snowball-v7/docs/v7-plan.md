# snowball-v7 实施计划（执行稿）

> 版本：2026-09-17 ｜ 与 `docs/v7-design.md`（设计稿）配套使用
> 方向（已定稿）：单 HTML 量化工具推倒重写，求职作品定位，算法深度+数值可信+数据可信。
> 不执行 agent/skill 化、不做 Python 重写、不迁移 AI 助手。
> **触发**：用户说「执行/开工」后按 P1→P5 推进，每期完成汇报验收。

## 文档地图

| 文档 | 内容 | 状态 |
|---|---|---|
| `v7-design.md` | 设计稿：目录/契约/图表清单/视觉/数据字典/不变量 | ✅ |
| `v7-plan.md` | 本文件：分期任务与验收 | ✅ |
| `v7-ui-spec.md` | 27 项功能规格（自 v5 main.js+index.html 逐行抽取） | ✅ |
| `v7-charts-spec.md` | 14 图绘制规格（自 v5 canvas.js 抽取） | ✅ |

---

## 0. 现状盘点与验收总则

**已有资产（继续有效）**
- `tests/golden.json`：v5 legacy 提取的数值真相（定价/Greeks/曲面/查表/回测/压测，74.9KB）。
- `tools/extract-golden/`：提取工具（vite SSR bundle，可重跑）。
- `tools/fetch_data.py`：Wind 取数脚本（查询失败过一次，需优化，见 P5-§3）。
- `docs/v7-design.md`：设计稿（目录/契约/图表/视觉/数据字典/不变量）。
- `package.json` + `node_modules`（vite 6 + vite-plugin-singlefile，esbuild postinstall 被拦截但构建可用，已实测）。

**验收总则**
- 数值：CEV 主路径与 golden 逐位一致（Float64 同码同源，应 bit 级）；GBM 纯路径逐位一致；GBM+BB 与 jump 因修正重立基线，方向与量级人工核验并记录。
- 功能：27 项对照表逐项验收（§P4-4）。
- 体积：`dist/index.html` < 450KB。
- 兼容：`file://` 双击可跑（Worker 降级链生效）。

---

## P1 工程骨架 + 参数契约 + 数据引导

**目标**：`npm run dev` 可打开空壳页面，表单可构造合法 P 对象，数据引导文件就位。

**任务**
1. `vite.config.js`：vite-plugin-singlefile，`target: 'es2020'`，`assetsInlineLimit` 拉满，`cssCodeSplit: false`。
2. `index.html`：页面骨架（顶栏 / 参数面板 / 三 Tab / 底部状态栏），控件清单逐字段对齐 v5 `index.html`（标的、S₀、敲出模式+敲出/起始/递减、敲入、票息模式+固定/早/切换月/晚、红利票息、期限、锁定期、波动率、rf（**新增三模式控件**）、股息率、保证金、名义本金、路径数、波动率模型、跳跃三参数、BB 开关、定价/反推模式、6 枚预设按钮；回测面板：标的、日期区间、频率、成本、名义本金、4 枚运行按钮；压测：参数摘要 + 运行按钮）。**去掉 v5 的 Google Fonts 外链**（离线纯净），系统字体栈。
3. `src/styles.css`：设计系统骨架（tokens + 布局 + 组件样式基座，P4 期间充实）。
4. `src/core/format.js`：fmtMoney（亿/万/元智能格式化）/fmtPct/greeks 业务口径换算（Delta/Gamma=`g×0.01×S×N`、Vega=`g×N`、Theta=`g/12×N`、Rho/RhoQ=`g×N`，N=notional×1e4）。
5. `src/ui/form.js`：`buildParams()`（与 v5 `buildParamsFromForm` 字段/单位/派生规则逐一对齐：`tenorYears=m/12`、`nSteps=max(round(ty*252),1)`、`strikeRef=s0`）+ `validate()`（s0>0、kiPct>0、tenor≥3、vol>0、koPct>kiPct、lockout<tenor、couponRate>0（反推除外）、分段需 early+late）+ 四组联动 + 预设加载（行为规格见 `v7-ui-spec.md` §2）+ **rf 三模式状态机**（规格见 `v7-ui-spec.md` §2.3：curve 插值/手改转 custom/一键 fixed2，脚注随动）。
6. `src/data/market.js`（引导版）：先复制 v5 `data.js` 的 MARKET/PRESETS（7 月快照）+ `RF_CURVE` 占位（中债曲线 2026-09-16：0.25/0.5/1/2/3/5/7/10Y 关键点，可先用 1Y=1.2302%、2Y=1.2441%、3Y=1.2497%、5Y=1.4103% 实测值，其余补 0.25/0.5/7/10 待 P5 刷新）。快照注释写清来源与日期。
7. `tools/bootstrap_data.py`：把 v5 `hist_data/*.txt` 六文件直接压缩成 deflate+base64 → `src/data/hist-data.js`（保证引导期就有数据，且与 P5 刷新产物同格式、同一解码路径）。
8. `src/data/hist.js`：`loadHistData(code)`（`DecompressionStream('deflate')` 解码 + 缓存 + 独立副本返回，防共享引用）、`parseCSV`/`sliceHist`/`getDateRange`/`fmtDate`/`parseDate`（逐字移植 v5 backtest.js 对应函数）；Node 环境 fallback 走 `node:zlib`。
9. `src/main.js` 占位：Tab 切换 + 主题切换 + 表单装配，不接算法。

**验收**：`npm run dev` 打开页面；6 枚预设全部可加载并联动；非法参数被校验拦截并提示；`loadHistData('000905.SH')` 在浏览器与 Node 均返回 1328 行。

---

## P2 算法层移植 + 三处修正 + golden 回归

**目标**：`npm test` 全绿（单测 + golden 回归）。

**文件与来源**（源均为 `snowball-v5/src/legacy/`）：
| v7 文件 | 来源 | 改动 |
|---|---|---|
| `core/sobol.js` | `sobol.js` | **逐字移植**（含 SOBOL_B64 方向数表、1e-10 截断、2^k 补齐、原点作 path 0、Acklam ppf、localStorage 缓存守卫） |
| `core/rng.js` | 新增 | splitmix64 计数器式确定性 PRNG：seed 常量 ^ (pathIdx·nSteps + stepIdx)，输出 [0,1) 后经 Acklam 得 z；供跳跃与 BB 桥噪声使用，与参数无关，CRN 严格成立 |
| `core/paths.js` | `gbm.js` 三个 simulate* | GBM/CEV 逐字移植；**BB 修正**：桥噪声改用 rng.js 独立流（v5 复用终点正态数）；**jump 修正**：泊松计数与跳跃幅度改用 rng.js 流（v5 用 Math.random 且复用扩散正态数、(k+1) 缩放），每跳独立 `μJ+σJ·z` |
| `core/payoff.js` | `gbm.js` evaluatePaths/payoffSinglePath | 逐字移植（四分类、ACT/365、分段票息、递减敲出、锁定期） |
| `core/pricing.js` | `gbm.js` priceSnowball/priceWithNormals/findCouponForPrice | 逐字移植（模拟调度、CRN 共享 normals、二分 20 次/1e-5、分段票息同步缩放、验证步） |
| `core/greeks.js` | `gbm.js` computeGreeks/buildGreeksSurface | 逐字移植（扰动量 ΔS=1%S₀、Δσ=1pp、ΔT=12/252 保持 nSteps、Δr=Δq=10bp；Vega 分桶仅非网格调用；曲面 10 价×N 期逐行回调 + 取消） |
| `core/table.js` | `backtest.js` buildGreeksTable/lookupGreeksTable | 逐字移植（24×24 自适应网格、4096 路径、CRN 跨期截断、每 24 点 yield、双线性插值） |
| `core/backtest.js` | `backtest.js` 其余 | 逐字移植（五频率、日内子时段 Box-Muller 独立流、归因仅 Gamma+Theta+成本+残差、滚动 RV 20/60、每 200 天 yield）；数据函数移去 `data/hist.js` |
| `core/stress.js` | `stress.js` | 逐字移植（vol 7 档/spot 7 档/危机 3 情景实算 RV/5×5 矩阵/CRN runStressTest）；危机切片改从 `data/hist.js` |

**测试**（`test/run.mjs` + `test/unit/*.mjs` + `test/golden.test.mjs`），断言矩阵：

| 断言组 | golden 键 | 容差 |
|---|---|---|
| Sobol 指纹 | sobol.first8_of_8192x504 / first4_of_64x8 | 逐位 |
| CEV 定价 | pricing_cev.{price,koProb,kiProb,kiLossProb,surviveProb,priceSE} | 逐位 |
| CEV Greeks | greeks_cev.{delta,gamma,vega,theta,rho,rhoQ,vegaKI,vegaKO} | 逐位 |
| 反推票息 | coupon_solve.{coupon,verifyPrice,iterations} | 逐位 |
| 曲面 | surface.{priceGrid,tenorGrid,delta,gamma 全网格} | 逐位 |
| 查表 | table.{priceGrid,tenorGrid,cells(552)} | 逐位 |
| 回测 | backtest.{daily,weekly,monthly} 九项金额+pathLast | 逐位 |
| 压测 | stress.{base_pv,vol(7),spot(7),matrix(25)} 的 pv/delta_pv/delta/vega | 逐位 |
| 危机 | crisis[0]（2024 量化风暴 crisisVol+delta_pv） | 逐位 |
| GBM | pricing_gbm / greeks_gbm | 逐位 |
| BB/jump | （不比对 golden） | 方向断言：BB 修正后与 v5 值差 <1%、jump 两次调用可复现、均值与 v5 同量级 |

逐位断言不一致先查移植偏差（运算顺序/Float64/字段漏项），**禁止放宽容差**。另存 `tests/golden-v7-fixed.json` 记录 BB/jump 新基线并在文件头注明修正说明。

**边界单测**（`test/unit/`）：反推票息分段模式同步缩放；couponDiv 空回退 coupon_late；descending 模式用 koStartPct；validate 全错误分支；rfFromCurve 插值与端点钳位；payoff 四分类手算样例（构造路径验证 KO/KI/红利/敲入赎回各分支金额）。

**验收**：`node test/run.mjs` 全绿；输出 golden 对照摘要表（各断言 ✓/Δ）。

---

## P3 Worker 池 + 三级降级链

**目标**：定价/Greeks/查表多核并行，`file://` 自动降级主线程。

**消息协议**（对齐 v5 pool.runByPath 行为，P3 前通读 v5 `workers/pool.js`+`workerLoader.js` 后定稿）：
```
主线程 → Worker:  { P, normalsChunk: Float64Array, startPath, endPath,
                    kind: 'pricing'|'greeks', returnPaths?: boolean, taskId }
                  transfer: [normalsChunk.buffer]   // slice() 拷贝后转移，禁 subarray
Worker → 主线程:  { taskId, ok: true, partial: <按 kind 的分片结果> }
                  或 { taskId, ok: false, error: message }
调度: nShards = min(pool.size, nPaths)；shardSize = ceil(nPaths/nShards)；
      每 shard 独立 Worker 用完即销毁；120s 超时 reject；
      error 事件置 pool._failed → 后续调用直接走「合并单任务主线程」→ 再败走「主线程串行」。
Greeks 合并后 vegaKI/vegaKO 由主线程补算（v5 行为，非网格调用才有）。
```

**任务**（参考源：`v5/src/workers/` 的 `pool.js`、`workerLoader.js`、`pricing.worker.js`、`greeks.worker.js`、`backtest.worker.js`、`stress.worker.js`）：
1. `workers/workerLoader.js`：Blob Worker 装载 + `file://` 协议检测（直接走主线程）。
2. `workers/pool.js`：按上述协议实现调度与合并（定价/希腊值 partial merge 规则与 v5 一致）。
3. 定价/Greeks/查表三个 worker 入口。
4. 顶部状态栏显示当前执行模式（N worker 并行 / 主线程降级）。

**验收**：4 核环境定价（8192 路径）< 1s；Greeks < 2s；`file://` 打开降级正常出结果；模拟 Worker 失败降级链生效；Pool 路径与主线程路径数值逐位一致（同 normals 分片再合并 = 整体计算）。

---

## P4 UI 三 Tab + 27 项功能 + 图表重设计

**目标**：功能逐项对照 v5 验收，视觉按设计稿 §7 落地。

**功能依据**：`v7-ui-spec.md`（27 项功能规格，含字段联动、文案生成规则、缓存键、交互时序、死代码清单）；**图表依据**：`v7-charts-spec.md`（14 图绘制规格）。两份规格已完成，P4 直接按规格实现，无需回读 v5 源码（有疑点再回查）。

**27 项功能验收对照表**（编号即验收勾选项）：
- 定价 Tab（13）：①MC 定价卡（PV+四概率+SE+耗时脚注）②Greeks 六卡（金额+风险方向+三层业务含义+正绿负红零灰+卖方视角，v5 main.js ~L341-400 文案口径）③Greeks 场景计算器（S/S₀、σ、期限三输入→六卡联动，~L431/681）④Greeks 二维曲面热力图（10 价×N 期、Delta/Gamma/Vega/Theta 四切换、KO/KI 2.5px 实线、S₀ 1.6px 虚线、绘制顺序格子→虚线→badge）⑤远期 Greeks 表⑥逐观察日敲出概率柱图⑦时间维度概率演变堆叠面积⑧票息累积曲线⑨路径密度聚类热图（50×50）⑩PV 密度分布（KDE Silverman+95/99% VaR 虚线+ES 填充）⑪CEV 局部波动率曲线⑫反推票息模式（隐藏票息输入+按钮换文案+结果区）⑬ATM 远期 Greeks。
- 回测 Tab（9）：⑭五频率对比表（best/worst 标注+推荐语）⑮成本敏感度扫描（0/1/2/5/10/20/50bps+盈亏平衡点）⑯滚动窗口回测（逐年结果表）⑰累计 PnL 曲线（主曲线+Gamma/Theta/成本虚线）⑱绩效指标（Sharpe/Sortino/Calmar/最大回撤+Bootstrap 1000 次 95%CI）⑲PnL 归因四项分解（注明 Vega 归因已移除）⑳IV vs RV 对比图㉑滚动 RV 20/60 日㉒标的路径+Delta 持仓双轴。
- 压测 Tab（5）：㉓波动率冲击 7 档表㉔价格跳跃 7 档表㉕历史危机 3 情景表（实算 RV 值入表）㉖5×5 组合矩阵热图㉗压测汇总卡（最劣情景）。

**图表实现**：`charts/kit.js`（DPR 适配、坐标轴/网格/图例/tooltip/主题 token）+ 三组图表文件；14 个绘图函数口径全部来自 v5 canvas.js 规格卡，视觉 token 换设计稿色板（语义红绿仅表达盈亏，KO 金实线 / KI 红实线 / S₀ 藏青虚线）。

**验收**：对照表 27/27；每图与 v5 同参数下数据一致（抽样核对）；明暗主题切换无破版；桌面最小宽 1200px。

---

## P5 打包验证 + Wind 数据正式刷新 + 文档收尾

**任务**
1. `npm run build` → 体积检查 < 450KB；超标按「先压数据（窗口回退 2018）再压代码」顺序处置并记录。
2. 浏览器冒烟（browser-use）：`file://` 打开 dist，6 预设轮跑一遍定价/回测/压测，截图存档核对 27 项渲染。
3. **Wind 取数优化重跑**：`fetch_data.py` 改为逐指数单查（`S_INFO_WINDCODE='X' AND TRADE_DT>='20150101'`，避开 IN+区间大扫描）+ 连接/读超时 + 逐步打印；曲线查询加 `TRADE_DT>='20260101'` 下限。产出正式 `src/data/hist-data.js`（2015 起）与 `src/data/market.js`（最新快照），页脚/卡片脚注显示数据来源与截止日期；危机情景随之三档全部实算。
4. `README.md`（v7 项目）：用途/运行方式（dev/build/双击）/目录结构/数据来源与刷新方式/测试与 golden 说明/版本。
5. `D:\snowball\README.md`：工作区 README 建或末尾追加「工作记录」一条（日期、任务、涉及文件、结果）。
6. **临时文件清理**：`.golden-build`（已有 run.mjs 自动删）、任何调试日志/截图过程产物、node_modules 不进交付物。

**验收**：双击 dist 全功能可用；体积达标；数据脚注日期 = 最新交易日；测试全绿。

---

## 附 A. 已知不改写清单

- Sobol 原点作 path 0（v5 既有行为，为 golden 对齐保留，技术手册新增说明）。
- kiProb 口径 = 敲入且未敲出路径占比（v5 一致）。
- Vega PnL 归因移除（RV 不可近似 IV）。
- 危机情景波动率由运行时实算（替代 v5 对 2015/2020 的静默跳过）。

## 附 B. 风险与对策

| 风险 | 对策 |
|---|---|
| canvas.js/main.js 口径抽漏导致功能缩水 | P4 前置通读 + 27 项对照表逐勾验收，缺项补做 |
| 数据刷新后体积超 450KB | deflate 预估 ~130KB；超标窗口回退 2018，危机区间单独内联 |
| esbuild postinstall 被拦 | 已实测构建可用；若换环境失败，按 npm 提示 approve |
| Worker 在个别浏览器 file:// 行为差异 | 降级链兜底 + 冒烟覆盖 Chrome/Edge |
