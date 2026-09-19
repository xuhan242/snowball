# snowball-v7 · 雪球结构定价台

单 HTML 雪球结构期权定价与风险分析工具。求职作品：算法深度（Sobol + CRN Greeks + 对冲回测 + 压力测试）+ 数值可信（v5 legacy 黄金基准逐位回归）+ 数据可信（Wind 转载库正式刷新，快照与来源逐处注明）。

## 运行方式

- **双击运行**：`dist/index.html` 直接打开（`file://` 协议自动降级主线程计算，零外部依赖、无 CDN/网络字体）。
- **开发**：`npm run dev`（Vite dev server，Worker 池多核并行可用）。
- **构建**：`npm run build` → 产出单文件 `dist/index.html`（预算 <450KB）。
- **测试**：`node test/run.mjs`（单测 + golden 黄金回归，全绿为交付门槛）。

## 功能（三 Tab，27 项）

- **定价分析（13）**：MC 定价卡（PV/四概率/SE/CI）、Greeks 六卡（1% 标准化金额 + 卖方视角三层文案）、Greeks 场景计算器、Greeks 二维曲面热力图（10 价×N 期，四 Greek 切换 + 动态播放）、远期 Greeks 表、逐观察日敲出概率、时间维度概率演变、票息累积曲线、路径密度热图、PV 密度分布（KDE + VaR/ES）、CEV 局部波动率曲线、反推票息（二分 + CRN）、ATM 远期 Greeks。
- **对冲回测（9，账本口径）**：五频率对比、成本敏感度扫描（0–50bps + 盈亏平衡）、滚动窗口逐年回测、账本累计盈亏曲线（负债腿盯市 + 对冲腿 + 成本）、绩效指标（Sharpe/Sortino/Calmar + Bootstrap 95% CI，确定性重采样）、账本归因四项分解（Γ/Θ/成本/未归因项 ε，恒等式精确闭合）、IV vs RV、滚动 RV 20/60、标的路径 + Delta 持仓双轴。负债腿逐日按查表 PV 盯市（与 Greeks 同 CRN 同网格），推导见 docs/book-accounting.md。
- **压力测试（5）**：波动率冲击 7 档、价格跳跃 7 档、历史危机 3 情景（2015 股灾 / 2020 新冠 / 2024 量化风暴，实际波动率运行时实算）、5×5 组合矩阵热图、最劣情景汇总卡。

## 算法与数值基准

- 核心层 `src/core/` 自 `snowball-v5/src/legacy` 逐字移植（Sobol 方向数表、GBM/CEV 路径、四分类 payoff、CRN 有限差分 Greeks、24×24 查表双线性插值、五频率回测、压测情景）。
- **三处修正**（v7 相对 v5）：① Merton 跳跃的泊松计数与跳跃幅度改用确定性流（`core/rng.js`，可复现）；② Brownian Bridge 桥噪声与终点正态数独立；③ 口径统一以代码为准（Theta 日金额 = g/12×N、跳跃 λ=0.5）。
- **黄金基准**：`tests/golden.json`（v5 提取，只读）。CEV/GBM 路径全部断言逐位一致；BB/jump 因修正另立基线 `tests/golden-v7-fixed.json`；对冲回测腿级键自批次二A 起对 `tests/golden-v7-scaled.json` 断言（单位口径修正后重立，推导见 docs/backtest-scaling-fix.md）；账本级键（查表 PV 552 格 + 账本回测）自 v7.1.0 起对 `tests/golden-v7-book.json` 断言（extractor 三步法生成，推导见 docs/book-accounting.md）。
- `npm test` 等价命令：`node test/run.mjs`，含 44 项断言（golden 矩阵 + 边界单测 + Worker 分片合并一致性；runner 逐文件 await，摘要计数真实）。

## 数据

- **来源**：Wind 转载库快照：指数日行情、股息率、中债国债收益率曲线（8 个关键期限点）。
- **快照**：见 `src/data/market.js` 头部注释（当前 2026-09-17）；页面顶栏与各卡片脚注同步显示。
- **历史窗口**：2018-01-02 起（每指数 ~2115 行）+ 危机区间补段（2015 股灾 000905 单独并入），deflate+base64 内联于 `src/data/hist-data.js`，运行时 `DecompressionStream` 解压。
- **刷新**：数据内嵌于构建产物；快照更新需自备数据源（取数脚本未随仓库发布），重新生成 `src/data/` 后 `npm run build`。
- rf 三模式：曲线插值（默认）/ 手改 custom（脚注显示偏离 bp）/ 固定口径 2% 一键回填。

## 目录结构

```
snowball-v7/
├── index.html               # 页面骨架（参数栏 + 三 Tab + 容器）
├── vite.config.js           # vite-plugin-singlefile 单文件构建
├── src/
│   ├── main.js              # 入口：主题三态 / Tab / 全局兜底
│   ├── styles.css           # 设计系统（明暗双主题 CSS 变量）
│   ├── core/                # 算法层（零 DOM，Node 可测）
│   │   ├── sobol.js / rng.js / paths.js / payoff.js / pricing.js
│   │   ├── greeks.js / table.js / backtest.js / stress.js / format.js
│   ├── data/
│   │   ├── market.js        # MARKET 快照 / PRESETS / RF_CURVE（脚本生成）
│   │   └── hist-data.js     # 历史行情内联（脚本生成）
│   ├── workers/             # Worker 池：定价/Greeks/查表分片 + 三级降级
│   ├── charts/              # Canvas 图表（kit + 定价 8 图 + 回测 5 图 + 压测矩阵）
│   └── ui/                  # 表单契约 / 卡片 / 面板装配 / 反馈
├── tools/
│   ├── extract-golden/      # golden 提取工具（v5 侧）
│   └── book-checkup.mjs     # 账本口径数值体检
├── test/                    # run.mjs + unit/ + golden.test.mjs
└── docs/                    # 设计/规格/口径推导文档/问题清单/截图
```

## 版本

v7.1.0（2026-09-18 深度升级：负债腿盯市入账，回测账本口径，ISSUES-6 关闭）。
v7.0.0（2026-09-18 夜间自主开发交付）。

## 工作记录

- 2026-09-19（缺陷修复）：修复 file:// 双击场景回测建表触发 Chrome「此页面没有响应」。根因：查表 Worker 化后，降级路径把 552 格合并成单个零让步同步任务（连续阻塞主线程 90~140s），进度冻结。修复：table.js 拆出 prepareTableColumn/computeTableCell，table.worker.js 新增 runInMainThreadCells 逐格计算（每格 MessageChannel 让步——不受后台标签定时器节流——并逐格回调进度），pool.runTable 预探测 Worker 工厂可用性、不可用直走逐格；http Worker 路径零改动。验证：Node 降级与串行版 552 格逐位一致（含 p 字段）；preview 同路径实测建表期间 evaluate 探针 14~178ms、进度 25→295→552 持续爬升。ISSUES-1 关闭（file:// 总时长 ~2 分钟属无 Worker 固有代价）。

- 2026-09-18（合规清理）：删除全部机构名表述。UI：rf 快捷按钮更名「固定口径 2%」（元素 id 与内部状态同步更名），Greeks 口径说明改「卖方业务口径」（定价卡与场景计算器两处）；tools/fetch_data.py 生成模板同步（防止数据刷新回写旧表述）；v7-design/v7-plan/v7-ui-spec/overnight-log/README 同步中性化。重建 dist/index.html 414.6KB 零外链、全仓 grep 机构名零命中；9 张截图全部重制（含新按钮文案），删除 4 张含旧表述的历史截图（file-proto-smoke/batch2a-file-smoke/backtest-scaled-light/dark）；node test/run.mjs 全绿。

- 2026-09-18（批次二A）：对冲回测引擎单位口径统一 + golden 回测基线重立。任务内容：backtest.js 四处修正（对冲盈亏 ×N 去 ÷btS0、Gamma 归因绝对点位 dS²、交易成本按成交金额 ×S_t、Theta ÷12 交易日与 Greeks 卡片统一）；tools/extract-golden 增加 legacy 复刻验证与 scaled 重取模式，产出 tests/golden-v7-scaled.json；展示层同步（panels.js/backtest-charts.js/index.html 指标卡金额单位与 %N 相对指标、归因更名「未归因项」、结论卡口径说明）。涉及文件：src/core/backtest.js、src/ui/panels.js、src/charts/backtest-charts.js、index.html、test/golden.test.mjs、tools/extract-golden/{entry,run}.mjs、tests/golden-v7-scaled.json、docs/{backtest-scaling-fix,batch2a-brief,STATE,overnight-log,ISSUES,acceptance-report}.md、docs/screenshots/backtest-scaled-{light,dark}.png。结果：node test/run.mjs 38 断言全绿（非回测键对 golden.json 逐位、回测键对 golden-v7-scaled.json 逐位）；dist 403KB<450KB 零外链；归因残差占比超标定为框架结构性问题记 ISSUES-6（cumPnL 仅期货腿、负债端不盯市），单位修正本身经复刻/倍数/逐位/盯市探针四重验证。

- 2026-09-18（v7.1.0 深度升级）：负债腿盯市入账（ISSUES-6 根治）+ 批次一/三收尾。任务内容：查表每格增存 p（PV，取自 computeGreeks 同次 CRN 基准定价，零额外模拟）+ lookupGreeksTable PV 双线性；backtest.js 逐日账本化（负债腿 −ΔV×N 与对冲腿同移动配对，恒等式「账本盈亏 = Γ归因 + Θ归因 − 成本 + ε」精确闭合，腿级旧字段与语句序逐位保留，结果增账本级字段与 path[].bookCumPnL/liabCumPnL）；新基线 tests/golden-v7-book.json（extractor book 三步法：552 格 p 与 v5 legacy priceWithNormals 逐格一致 → 腿级复刻与 golden-v7-scaled 逐位一致 → 账本循环提取，v7 引擎独立实现逐位对齐）；展示层全面切账本口径（指标卡主卡+两腿分项、归因瀑布、多频率/成本扫描/滚动/绩效 Bootstrap 序列、阈值 ε<20% 优秀/<50% 可接受/≥50% 红字）；批次一修复（feedback.js nextFrame rAF+setTimeout(100ms) 竞速、CEV 偏斜表敲出行补 CEV Σ 格）；修复回测面板 btPanel 无显示路径的 v7.0 遗留缺陷（定价完成后自动显示）；tools/book-checkup.mjs 数值体检入库；overnight-log 顶部勘误段（02:10 后时间戳为预写，mtime 为证）。涉及文件：src/core/{greeks,table,backtest}.js、src/ui/{panels,feedback}.js、src/charts/backtest-charts.js、index.html、package.json、test/golden.test.mjs、tools/extract-golden/{entry,run}.mjs、tools/book-checkup.mjs、tests/golden-v7-book.json、docs/{v71-brief,book-accounting,STATE,overnight-log,ISSUES,acceptance-report}.md、docs/screenshots/（定价/曲面/概率演变/回测/压测 × 明暗 8 张 + file 冒烟）、根 README。结果：node test/run.mjs 全绿（三层锁：golden.json 只读逐位 / scaled 腿级逐位 / book 账本逐位）；体检六格 ε=L−TE 精确闭合，|ε/账本盈亏| 3/6 格 ≥50% 记 ISSUES-7（legacy 调仓时序滞后的分母效应，非推导/实现错误；未归因项绝对量从 ±(11~23)%N 收窄至 ±(1.5~6.2)%N）；dist 414.6KB<450KB 零外链，Edge headless file:// 冒烟通过，遮挡窗口定价 3s 完成（nextFrame 补丁实测），dev Worker 路径 2025H1 回测归因四项与账本盈亏精确自洽，双主题截图齐。
