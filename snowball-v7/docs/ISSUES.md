# ISSUES（停车清单）

> 夜间开发中遇到但未在本夜解决的事项，按影响排序。均不阻塞验收（27 项功能/数值回归/体积达标）。

## ISSUES-1 file:// 降级模式下 Greeks 查表 ~90s —— 已关闭（2026-09-19）
- 原现象：`file://`（或单文件构建）下 ES module Worker 不可用，查表退化为合并单任务主线程串行，552 点约 90s；且该降级路径整段同步零让步，Chrome 在阻塞 5~10s 时弹「此页面没有响应」，进度显示冻结（用户实测 2025-09-17~2026-09-17 全年区间复现）。
- 关闭方式（2026-09-19）：降级路径改为主线程**逐格**计算——`table.js` 拆出 `prepareTableColumn`/`computeTableCell`（单格同步、列准备一次），`table.worker.js` 新增 `runInMainThreadCells`（每格一次 MessageChannel 让步 + 逐格进度回调），`pool.runTable` 预探测 Worker 工厂可用性（file:// 直接走逐格）。单格阻塞 ~0.3s 量级，不触发无响应弹窗，页面全程可交互、进度平滑走动。
- 让步原语用 MessageChannel 而非 setTimeout：后台标签页定时器被浏览器节流（1s~1min/次），MessageChannel 任务不受定时器节流，切走标签页不拖慢建表。
- 验证：Node 下 `runTable` 降级与串行 `buildGreeksTable` 552 格逐位一致（含 p 字段）；preview（同为降级路径）建表期间 evaluate 探针 14~178ms 秒回、进度 25→295→…→552 持续爬升。file:// 建表总时长仍 ~2 分钟（无 Worker 的固有代价；Blob 内联 worker 会使 dist 超 450KB 预算，不做）。
- http/Worker 路径（按列分片并行）零改动。

## ISSUES-2 回测盈亏绝对量级偏小、多频率对比「残差占比」比率爆炸 —— 已关闭（2026-09-18 批次二A）
- 现象：累计对冲盈亏为百元级（1000 万名义本金），残差占比可达数千 %。
- 原因：v5 引擎的 `N/btS0` 缩放口径下 Delta 持仓盈亏量级如此（golden 回测值同为百元级：daily cumPnL=157.33）。
- 处置：逐位移植保留原口径（golden 对齐优先级最高），未擅自改口径；如需展示优化，应在引擎层统一改并重立 golden。
- 关闭方式（2026-09-18）：批次二A 在引擎层完成四处单位口径修正（盈亏 ×N、Gamma 绝对点位 dS²、成本按成交金额 ×S_t、Theta ÷12 交易日与卡片统一），
  golden 回测键重立为 tests/golden-v7-scaled.json（legacy 复刻先与 golden.json 逐位一致后仅改缩放重取；其余键不动），
  node test/run.mjs 38/0。推导与前后对照见 docs/backtest-scaling-fix.md §1–§6。

## ISSUES-3 两个图表的固定亮色系在暗色主题下对比强烈
- 现象：路径密度热图（绿色单色渐变）与票息累积（绿色渐变填充）使用 v5 固定亮色带，暗色底上刺眼但可读。
- 处置：保留 v5 色带（charts-spec 允许）；后续可为主题增加第二套密度色带。

## ISSUES-4 真实浏览器 file:// 双击冒烟未人工执行 —— 已关闭（02:10）
- 现象：走查通过 vite preview（主线程降级路径）与 vite dev（Worker 路径）两个 http 环境完成；自动化浏览器不支持 file:// 导航。
- 关闭方式：用系统 Edge headless 直接加载 `file:///D:/snowball/snowball-v7/dist/index.html` 截图冒烟，页面完整渲染、预设 0 自动加载（s0=Wind 快照价 7654.9785）、快照日期正确、零外链无加载失败。截图 docs/screenshots/file-proto-smoke.png。
- 残留：file:// 下「开始分析」交互未点击（headless 截图模式不可交互）；但定价主线程路径与 preview 单文件构建完全同构（协议差异仅影响 Worker 可用性，两者 Worker 均不可达），风险已覆盖。

## ISSUES-5 cbondcurvecnbd 的 MAX(TRADE_DT) 聚合查询超时
- 现象：`SELECT MAX(TRADE_DT) ... WHERE B_ANAL_CURVENAME='中债国债收益率曲线'` 60s 超时（表大，谓词选择性差）。
- 已解决：改用小窗口（近 1~2 月）+ ORDER BY TRADE_DT 的取回后取最新日方案（实测秒级）；已固化在 tools/fetch_data.py。

## ISSUES-6 归因残差（未归因项）占比无法收窄到 |cumPnL| 的 50% 以内 —— 已关闭（2026-09-18 v7.1.0）
- 原现象：口径修正后数值体检表六格 |residual|/|cumPnL| = 167%~488%，全部超验收线 50%；2024H1 三格量级超名义 ±10%。
- 根因（批次二A 取证已证实）：cumPnL 仅期货对冲腿，负债端不逐日盯市，residual 被迫吸收整个负债现值变化 ΔV×N。
- 关闭方式（2026-09-18 v7.1.0）：负债腿逐日盯市入账，回测升级账本（book）口径——查表增存 PV（p，取自
  computeGreeks 同一次 CRN 基准定价，零额外模拟），引擎逐日双腿入账，归因恒等式「账本盈亏 = Γ归因 + Θ归因 − 成本 + ε」
  精确闭合，ε 净化为真离散对冲误差。未归因项绝对量从 ±(11~23)%N 收窄至 ±(1.5~6.2)%N。
  推导与符号表：docs/book-accounting.md；回归安全网：tests/golden-v7-book.json（三层锁，extractor 三步法生成）；
  引擎/展示层全量切换账本口径。node test/run.mjs 全绿（golden.json / golden-v7-scaled.json 腿级键 / golden-v7-book.json 均逐位一致）。
- 残留：|ε|/|账本盈亏| 仍有 3/6 格 ≥50%（分母效应：账本基数小而 L/TE 与之同量级），另立 ISSUES-7 跟踪。

## ISSUES-7 v7.1.0 遗留：账本口径 |ε|/|账本盈亏| 仍有 3/6 格 ≥50%（分母效应，非误差扩大）
- 现象：tools/book-checkup.mjs 六格中 2024H1 weekly 97.8%、2025H1 daily 50.7%、2025H1 weekly 51.1% 超 50% 阈值（其余 29.9%~44.4% 可接受，0 格达 <20% 优秀）。
- 已试（取证，恒等式 ε = L − TE 六格精确闭合，残差 <1e-6 元，见 docs/book-accounting.md §8.1）：
  - L（对冲腿一日滞后项）：legacy 引擎「调仓在盈亏结算后」时序，为 golden-v7-scaled 腿级键逐位锁定，账本层不可修正；
    V 型窗口（2024H1）L 达 ±(4~6)%N，2024H1 weekly 的 97.8% 即 L=−5.66%N 对 bookPnL=5.31%N 的分母效应；
  - TE（盯市 Taylor 余项）：插值平滑 + θ 12 日差分线性摊销 + 期限轴 2 月钳位 + MC 残余噪声；2025H1 TE=−1.67%N 对 bookPnL≈3.8%N。
- 怀疑点/后续方向（均超出 v7.1.0 范围）：(a) 若允许重立腿级 golden，可修引擎时序为「先调仓后结算」消除 L；(b) θ 差分改 1 交易日步长需逐日二次定价（现被「禁止二次模拟」约束）；(c) 查表加密或 p 与 Greeks 插值一致性重构可压 TE。
- 当前处置：展示层对 ε 占比 ≥50% 红字标注并在口径说明中写明阈值；ε 绝对量已从 ±(11~23)%N（ISSUES-6 时代）收窄至 ±(1.5~6.2)%N。
