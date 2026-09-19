# snowball-v7 UI 功能规格书

> 来源：逐行通读 `snowball-v5/src/legacy/main.js`（2126 行）+ `index.html`（985 行）抽取。
> 用途：P4 实现的**唯一功能依据**——不看 v5 代码也能重建同等功能语义。
> 配套：图表绘制细节见 `v7-charts-spec.md`（canvas.js 规格）。

## 0. v5 → v7 布局映射

| v5 | v7 |
|---|---|
| 顶部参数面板（可折叠+摘要行） | 左侧参数栏（264px，滚动），保留折叠为摘要行能力 |
| 顶部 Tab + body.tab-* 类切换 | 同构（顶栏下方 Tab） |
| 回测独立 bt-control-panel（body.tab-backtest 显示） | 回测控制条内嵌回测 Tab 顶部 |
| Google Fonts 外链 | 系统字体栈（离线） |
| window.onXxx 全局 onchange | 模块内 addEventListener |
| AI 侧栏/上下文/ai-assistant.js | 不迁移 |

## 1. 全局设施

- **主题**：三态循环 auto→light→dark，`localStorage['sb7-theme']`；auto 态移除 `data-theme` 属性跟随系统；切换后重绘可见图表（v5 做法是重新 renderPricingResults，v7 保持：定价区有结果则整体重渲染，回测/压测区重绘对应 canvas）。
- **反馈组件**：toast（3s 自动消失，`#toast`）；loading 遮罩（标题+副标题可变）；骨架屏三型（pricing=4卡格+3图块、backtest=3图块、stress=3卡格+1图块，shimmer 动画）；计算错误卡（标题+转义消息+重试按钮，绑定 retryFn）；参数提示卡（hint-card，非错误但需持久提示时用）。
- **全局兜底**：window error / unhandledrejection → hideLoading + toast + 恢复计算类按钮 disabled 状态。结果合法性校验：mc.price 非 NaN/Infinity 时才渲染，否则走错误卡。
- **格式化**：fmtVal=toFixed(4)；fmtPct=(×100).toFixed(1)+'%'；fmtMoney=|v|≥1e8→'X.XX亿'，≥1e4→'X.XX万'，否则整数元。

## 2. 参数面板

### 2.1 字段（id 沿用 v5）
code / s0 / koMode(fixed|descending) / ko / koStart / koStep / ki / couponMode(fixed|tiered) / coupon / couponEarly / couponSwitchMonth / couponLate / couponDiv / tenor / lockout / vol / rf / div / margin / notional / npaths(8192|16384|32768) / volModel(constant|cev|jump) / useBB / jumpLambda / jumpMean / jumpStd / targetPrice（反推模式）。

### 2.2 联动规则
- **标的切换**：s0/vol/div **仅当为空时**填充 MARKET 值（vol/div 保留 2 位小数）。
- **koMode**：fixed 显示 ko；descending 显示 koStart+koStep。
- **couponMode**：fixed 显示 coupon；tiered 显示 early+switchMonth+late。
- **volModel**：jump 显示 λ/μJ/σJ 并禁用+取消勾选 useBB；其余隐藏。
- **定价/反推模式**（radio）：reverse → 显示 targetPrice，隐藏 coupon 输入组与 couponMode 选择器（parent 级）及 early/switch/late，按钮文案「反推票息」；pricing → 恢复（重新执行 couponMode 联动），文案「开始分析」。
- **参数摘要**（折叠时显示）：标的 | 期限N月 | 票息%（tiered 显示 early→late）| 敲入% | 敲出% | 波动率%。

### 2.3 rf 三模式（v7 新增）
状态 `rfMode ∈ {curve, custom, fixed2}`，默认 curve：
- curve：rf 值 = RF_CURVE 按 tenorMonths/12 线性插值（端点钳位）；tenor 或预设变化时自动刷新；脚注「中债国债收益率曲线 · {date}」。
- custom：用户手改输入框即进入；脚注「自定义 · 偏离曲线 {±N}bp」。
- fixed2：按钮「固定口径 2%」一键回填 2.00；脚注「固定口径 2%」。按钮「恢复曲线」回到 curve。
- 预设加载与 tenor 联动只在 curve 态改写 rf。

### 2.4 预设（6 枚按钮）
loadPreset 填全部字段（含 jump 三参数、useBB、margin、notional、npaths、volModel）→ 依次触发 4 个联动 → 更新摘要与压测参数摘要 → toast。**v7 差异**：预设不含 rf 字段，rf 由 curve 态按 tenor 填。初始化时 loadPreset(0)。

## 3. 定价 Tab（13 项）

**主流程**：提交 → validate →（失败：err 区+toast+结果区 hint 卡，仍折叠面板）/（成功：loading「正在计算…/蒙特卡洛模拟 + Greeks 求解」+骨架屏）→ runPricing（Pool 并行，失败降级主线程）→ 合法性校验 → 渲染。lastP/lastMC/lastGreeks 存全局状态供回测/压测/场景计算器使用（lastP 附 code/codeText）。

① **定价卡×4**：理论价值（4 位小数；副行：利差 fmtPct(1-price)、金额=(price×notional) 万、SE±N万；第三行 95%CI 区间与 σ_path）/ 敲出概率（绿）/ 敲入概率（红）/ 亏损概率（中性，=敲入且到期亏损）。
② **Greeks 六卡**（场景计算器区块内）：
- 金额换算（N=notional×1e4，S=当前 s0）：Delta/Gamma = g×0.01×S×N；Vega = g×N；Theta = g/12×N（显示追加「/天」）；Rho/RhoQ = g×N。
- 卡结构：标题(名+符号)｜金额值(pos 绿/neg 红/neu 灰)｜方向标签｜量化句（「标的涨1%→卖方盈/亏 X」式）｜点击展开：风险机理+对冲建议。
- 文案生成规则（条件分支逐条移植）：Delta 方向按符号；Gamma 凸性方向按符号、tagCls 按 |Gamma金额|<0.1×|Delta金额| 分级、对冲建议两分支（无需处理 / 提高至日内2-4次）；Vega 固定「卖保险赚波动率溢价」叙事+占比+vegaSkewNote（KI/KO 处 Vega 金额，差>1000 加「偏斜敞口」）；Theta 符号分支+年化(|θ日|×252)；Rho 附「量级仅为 Vega 的 N%」；RhoQ 附「敏感度是 Rho 的 N 倍」+分红季提示。
- 区块脚注：计算场景行 + 卖方口径说明 + CRN 说明 + Gamma 边界精度警示（固定文案，含 ⚠ 色值 #d97706）。
③ **Greeks 场景计算器**：greeksTime(0/1/3/6 月后)+greeksPrice(S/S₀ 默认 1.00)+greeksVol(空=当前)；校验（需先定价、priceRatio>0、newTenor>0）；pp = {s0×ratio, tenor=newTenor, nSteps=max(round(newTenor/12×252),20)}，主线程 computeGreeks；重渲染六卡+脚注（场景行显示时点/价格比/剩余期限/σ/本金）。
④ **Greeks 压力情景表**（3×3，异步增量）：spot {0.90,1.00,1.10} × vol {−5pp, 基准, +5pp}；每格逐个 nextFrame 计算 PV+Δ金额+ν金额；中列 vol 下边框强调；脚注「PV=理论价值|Δ=Delta(标的涨1%金额)|ν=Vega(vol升1pp金额)|CRN共享随机数」。
⑤–⑩ **六张图**：路径密度热图 / 时间维度概率演变 / 逐观察日敲出概率 / 票息累积 / PV 概率密度 / CEV 局部波动率（含 3 行表：敲入/ATM/敲出位置的常数σ vs CEV σ=vol/位置比例 与偏斜 pp，红字强调；仅 useLocalVol 显示）。图上方的 note 说明文案逐条移植（各含颜色/线型图例说明）。
⑪ **Greeks 二维曲面区**（折叠面板「高级分析」）：
- 「生成 Greeks 曲面」按钮 + 进度条（行级回调 ti+1/total）+ 4 子 Tab（delta/gamma/vega/theta）+ 动态播放（1800ms 循环点击子 Tab，可停止）。
- 缓存键 = 18 字段 join('|')（s0,koPct,kiPct,couponRate,tenor,lockout,vol,rf,div,notional,nPaths,useLocalVol,koMode,couponTiered,early,late,switchMonth,couponDiv）；命中直接重绘，未命中重算。
- 渐进绘制：ti≥1 起每行回调时重绘热图+ATM 远期曲线；完成时进度条 100%→1.2s 后隐藏。
- 首次回调即写 priceGrid/tenorGrid（防空引用）；定价完成后 100ms 自动启动计算（保持折叠）。
- 热图脚注：蓝=负 白=零 红=正值｜虚线=KI/KO/S₀｜金额口径与六卡一致。
⑫ **ATM 远期 Greeks 图**：曲面容器内第二张 canvas，S/S₀=1.0 处各 Greek 随剩余期限变化。
⑬ **反推票息模式**：提交 → loading「反推票息中…/二分查找 + MC 定价」→ 结果 4 卡（反推票息率%/验证理论价值+误差%/二分区间[lo,hi]%/迭代次数）+ 业务说明段（目标价值含义、平价/溢价折价判定、算法说明：Sobol+CRN 二分保单调）。
**页脚**：耗时 X s｜路径数｜步数｜计息 ACT/365｜敲出固定/递减｜波动率模型名｜数据来源标识（v7：Wind 快照+日期）。

## 4. 回测 Tab（9 项）

**入口守卫**：需 lastP（未定价 → toast「请先在定价分析 Tab 完成定价」）。
**面板初始化**（首次进入 Tab）：btCode 镜像定价标的下拉；日期 min/max=数据区间；默认区间=最近 1 年（end=range.end，start=年份-1 同月日）；info 行显示数据范围与提示；syncBtFromPricing（同步 code/notional，hint 显示「已同步定价参数：…」或 ⚠ 未定价）。

**通用流程**（runBacktest）：校验 5 项（标的/日期非空、start<end、cost≥0、notional>0）→ sliceHist（<20 条报错）→ P={...lastP, notional:btNotional}，**btS0=区间首日价**（建表用 btP.s0=btS0）→ Greeks 表缓存（键=15 字段：btS0,kiPct,koPct,couponRate,tenor,lockout,vol,rf,div,koMode,tiered,early,late,switchMonth,价格比区间 min-max.toFixed(3)）→ 576 点建表（进度条「Greeks 表 cur/total」）→ backtestHedge（进度「回测 cur/total」）→ 渲染（双 rAF 后绘 4 图）。

⑭ **摘要卡×5**：累计对冲盈亏（绿/红+占本金%）、标的区间收益%（含 s0→sEnd）、最大回撤（金额+峰谷%）、交易成本（红字-金额+占盈亏%）、回测配置（频率+N日+标的+期限）。
⑮–⑱ **四图**：累计盈亏曲线 / 标的路径+Delta 持仓 / 盈亏归因分解 / IV vs RV（含滚动 20/60 日 RV——即功能㉑并入此图）。
⑲ **回测结论卡**：关键指标（总盈亏/占本金/年化收益/最大回撤/对冲质量）+ 归因四项（Gamma Scalping/Theta 衰减/交易成本/离散对冲损耗，各带一句 desc）+ 主要正贡献/主要拖累 + **绩效指标表**（年化收益率/年化波动率/Sharpe/Sortino/Calmar/盈亏比/胜率，公式：annRet=总盈亏/N÷(n/252)、annVol=√(var×252)/N、sharpe=(annRet−rf)/annVol、sortino 用下行波动、calmar=总收益/(maxDD/N)、winRate=日盈利占比、plRatio=均盈/均亏）+ **Bootstrap CI**（500 次重采样日 PnL，90/95/99 三档分位数；**v7 变更：随机源换 rng.js 确定性流**）+ 业务解读 narrative（生成规则：盈亏方向→标的涨跌与对冲盈亏→主导因素（|maxGain| vs |maxLoss|）→正/负贡献句→残差占比分级（<20 优秀/<40 良好/<60 一般/≥60 较差）→残差>40% 建议提频、成本占比>30% 建议降频）+ 波动率参考段（RV vs 定价 vol 差值 pp、|差|>3pp 提示）+ 方法论脚注（576 点/双线性插值/CRN/4096 路径/耗时）。
⑳ **多频率对比**：五频率顺序 intraday4/intraday2/daily/weekly/monthly 逐一回测（共用表缓存）→ 表（频率/累计盈亏(%) best 绿加粗/交易成本 worst 红/离散残差 best 绿/Gamma PnL/Theta PnL）+ 推荐块（按累计盈亏排序取首；含盈亏%/成本占比/残差占比）。
㉑ **成本敏感度扫描**：档位 [0,1,2,5,10,20,50]bps 共用表缓存逐档回测 → 折线图（盈亏平衡点=第一个 cumPnL≤0 的档位，图内标注）。
㉒ **滚动窗口回测**：按 startYear..endYear 逐年切片（<20 条跳过），**各年独立 s0=当年首日价**（表缓存按整个区间的 btS0 建，仅 P.s0 换年）→ 表（年份/累计盈亏%/Gamma/Theta/成本/残差/年化 RV）+ 汇总行（合计/年均/最佳年/最差年）。

## 5. 压测 Tab（5 项）

- 顶部参数摘要（进入 Tab 时刷新）：标的|期限|敲入%|敲出%|波动率%|路径数。
㉓ **运行**：loading 分四批（波动率冲击 7 个→价格跳跃 7 个→历史危机 N 个→组合矩阵 25 个），每批 nextFrame；共享一组 normals（CRN）；骨架屏；完成 toast。
㉔ **关键发现摘要卡×3**：最差情景（PV 最低，非基准）/ 最大 PV 降幅（delta_pv 最负+降幅%）/ Vega 变化最大（|Δvega| 最大+原始 Vega）；红 #d62728 / 绿 #2ca02c 着色。
㉕ **波动率冲击表**：列=情景/波动率/PV/ΔPV/Vega(金额)/ΔVega(金额)；基准行底色、最劣行左红边；ΔPV 红/绿/灰着色。
㉖ **价格跳跃表**：列=情景/标的价格/PV/ΔPV/Delta(金额)/ΔDelta(金额)。
㉗ **历史危机表**：列=危机/实际波动率%/PV/ΔPV；无基准行、无最劣标注；数据加载失败显示空态文案。
㉘ **5×5 组合矩阵热图**：vol{−10,−5,0,+5,+10}pp × spot{−10,−5,0,+5,+10}%，色映射 ΔPV（红=亏损绿=盈利），canvas 绘制（规格见 charts-spec）。

## 6. v5 死代码与不迁移清单

| 项 | 处置 |
|---|---|
| loadExample / loadExample2（无按钮绑定） | 不迁移 |
| AI 全家（__aiContext/pushSnapshot/ai-assistant.js/AI 按钮与样式） | 不迁移 |
| window.onXxx 全局函数 | 改模块内绑定 |
| redrawVisibleCanvases 的空 canvas 遍历 | 直接按 Tab 重渲染/重绘 |
| 技术手册旧口径（Theta /252、jump λ=2） | 以代码为准（θ/12、λ=0.5） |

## 7. v7 有意行为变更（相对 v5）

1. rf 三模式（§2.3），预设不再自带 rf。
2. 危机情景 2015/2020 随 Wind 数据（2015 起）恢复实算，三档齐全。
3. Bootstrap 随机源换确定性 rng（500 次结果可复现）。
4. 页脚/卡片数据脚注统一「来源+快照日期」。
5. 回测 info 行的数据范围随实际 hist 窗口动态显示（不再写死 2021-01-04~2026-06-30）。
