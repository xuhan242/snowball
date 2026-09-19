# snowball-v7 图表绘制规格（自 v5 src/legacy/canvas.js 逐函数抽取）

> 来源行号 = snowball-v5/src/legacy/canvas.js。P4 实现唯一图表依据。
> v7 适配总则：① 颜色一律经 kit 的 theme 对象（CSS 变量 --canvas-*），不得散落硬编码；但各函数中标注「固定色」的语义色（KO 绿 / KI 红 / 曲线配色）可保留为 v5 同值或换 design §7 等价语义色；② 红绿只表达盈亏正负（positive/negative 变量），路径密度热图的绿色单色渐变允许保留（非红绿对立编码），也可换蓝色单色渐变；③ DPR 适配与尺寸回退链照抄 setupCanvas。

## A. 工具层（kit.js）

### A1. setupCanvas(cv, options?) — L93
- dpr = devicePixelRatio||1。尺寸回退链：getBoundingClientRect → offsetWidth/Height → computed style px → 默认 600×240。
- cv.width=w*dpr; cv.height=h*dpr; options.willReadFrequently / desynchronized 传入 getContext；ctx.scale(dpr,dpr)。返回 {ctx,w,h}。

### A2. getCanvasTheme() — L9
- 读 CSS 变量：bg(--canvas-bg,#fff) grid(--canvas-grid,#f5f5f5) axis(--canvas-axis,#ccc) text(--canvas-text,#888) textStrong(--canvas-text-strong,#555) series[8]（--canvas-series-1..8，回退 #1b4332,#d62728,#2ca02c,#ff7f0e,#1a73e8,#9467bd,#8c564b,#e377c2）positive(--canvas-positive,#2d6a4f) negative(--canvas-negative,#9b2226)。v7 照抄变量名。

### A3. beginDraw(cv) — L38：setupCanvas+getCanvasTheme+clearRect(0,0,W,H)，返回 {ctx,W,H,th}。
### A4. makePads(opts) — L46：默认 L50 R20 T20 B40。
### A5. drawGridH(ctx,x0,x1,y0,y1,steps,fmt,th) — L57：水平网格+右对齐 Y 标签，10px，步高 (y0−y1)/steps，i=0..steps。
### A6. drawYAxisTitle(ctx,text,x,yCenter) — L75：rotate −90°，#666 11px 居中。
### A7. drawAxes(ctx,x0,y0,x1,y1,xLabel,yLabel) — L132：L 形轴线 axis 色 11px；yLabel 在 x0−44 旋转；xLabel 在 (x1−4,y0+24) 右对齐。
### A8. colorScale(v,vmin,vmax) — L209：t=clamp(v/absMax,−1,1)，absMax=max(|vmin|,|vmax|,1e−9)。t≥0：hsl(0, round(t·80), 85−t·25)（白→红）；t<0：hsl(240, round(−t·80), 85+t·25)（白→蓝）。零值 85% 亮度。
### A9. drawColorBar(ctx,x,y,w,h,vmin,vmax,key) — L222：纵向渐变 底 hsl(240,80%,60%) →中 hsl(0,0%,85%) →顶 hsl(0,80%,60%)；边框 #ccc；右侧标签 fmtBar（≥1e8 亿1dp / ≥1e4 万1dp / ≥100 整数 / else 2dp）：vmax 顶、vmin 底、'0' 中。
### A10. fmtMoneyAxis(v) — L1865：≥1e8 → 2dp 亿；≥1e4 → 1dp 万；≥100 → 整数；else toFixed(0)。
### A11. fmtDateShort(d) — L1874：YYYYMMDD → MM-DD。

## B. 定价 Tab 图（8）

### B1. drawVolCurve(cv,P) — CEV 局部波动率 — L144
- !P.useLocalVol → display:none 返回。边距 68/25/16/32。X 域 [0.65,1.15]（S/S₀），网格 0.7..1.1 步 0.1 标签 %；Y 域 [vol·100−10, vol·100+15]，从 ceil(vMin) 步 5 画网格右标签。
- CEV 曲线：lv=vol·(1/m)·100，200 点，series[0] 2.5px。
- mark(shortLabel,money,color,yOff)：竖虚线 [2,2] 至底 + 白底标签框（rgba(255,255,255,0.9)，文字=shortLabel+lv 1dp%）。三处：敲入 σ=(kiPct, negative)、ATM σ=(1.0, series[0]，与 KO 像素距 <55 时 yOff=−16)、敲出 σ=(koMode=descending?koStartPct:koPct, positive)。
- 常数σ 参考横线 [4,4] text 色，右下标「常数σ」。

### B2. drawGreeksHeatmap(cv,surface,greekKey,P) — Greeks 二维曲面热图 — L257
- willReadFrequently。surface={priceGrid[10],tenorGrid[N],data{'pi_ti':g}}。金额换算：delta/gamma → g×0.01×S×N（S=priceGrid[pi]·P.s0，N=notional·1e4）；vega→g×N；theta→g/12×N。空数据→「暂无数据」居中。
- pads L52 R90 T52 B44；cellW=plotW/nT，cellH=plotH/nP；行序 nP−1−pi（价高在上）。先铺 th.bg。
- 第1层格子：colorScale 填充 + 边框 rgba(150,150,150,0.55) 0.8px。badge 规则：label 格式 ≥1e8 亿1dp/≥1e4 万1dp/≥100 整/≥10 整/≥1 1dp/else '0'；showBadge = cellW≥32 || intensity>0.25 || av≥1000；badgeBg intensity>0.45 ? rgba(0,0,0,0.5) : rgba(255,255,255,0.75)；文字反色；fontSize cellW<40→8/<55→9/else 10。外框 axis 1px。
- 第2层边界线（y=T+(nP−1−pi+0.5)·cellH）：KO 行（descending 用 koStartPct）positive 2.5px 实线；KI 行 negative 2.5px 实线；S₀ 行（1.0 最近行）text 1.6px 虚线 [6,3]。findPi=最近比例行。
- 第3层 badge：圆角矩形 r=3，bold 字，宽 min(文本+8（fontSize<9 则+5）, cellW−2)，高 fontSize+5。
- Y 轴：priceGrid[pi].toFixed(2) 右对齐；Y 标题 'S/S₀' rotate −90° @x=12。X 轴：'N月' 自适应字号（cellW<30→8/<45→9/else 10），间距 < max(字号×3.2, 文本宽+4) 跳过、末列强制；X 标题 '剩余期限' 11px 居中 @h−10。
- 色标 drawColorBar @(x1+10,T,14,plotH)。标题 `${greekLabel} 二维曲面` bold 13 @(pad.L, T−8)；同行右侧图例：KO N%（positive 实线块）、S₀（text 虚线块 [3,2]）、KI N%（negative 实线块），色块 12×3，间距 measureText+28。

### B3. drawForwardGreeks(cv,surface,P) — ATM 远期 Greeks — L478
- atmPi=priceGrid 中最近 1.0 行。四序列（delta/gamma/vega/theta）取 data[atmPi_ti] 换算金额。固定色：delta #2d6a4f / gamma #e67e22 / vega #c0392b / theta #3498db。valid<2→「数据不足」。无 data→「请先生成 Greeks 曲面」。
- Y 域全部点 ±12% pad。pads L68 R30 T18 B44。X=期限月值域。drawGridH 5 段 fmtMoneyAxis。零线 #bbb 虚线 [4,3]。四线 2px。X 刻度 min(6,len) 均分。
- 轴、Y 标题 '金额 (元)'@x=14、X 标签 '剩余期限'。标题 '远期 Greeks（ATM 月度演变）' bold 13 @(x0,y1−6)。图例在绘图区右侧 x1+6 起，线段 16px + 文字，步进 文本宽+32。

### B4. drawKOEvolution(cv,P,mc) — 时间维度概率演变（堆叠面积）— L593
- 输入 mc.koTimes/kiTimes（步索引或 Infinity）。增量法：kit≠Infinity→kiDelta[kit]++（曾 KI 永不退出）；elif kt≠Infinity→koDelta[kt]++（纯 KO）。前缀和→koPct(j)/kiPct(j)=Δ/n。
- koObsSteps=[round(m·spm) for m=lockout+1..floor(tenorMonths+1e−9)]，spm=nSteps/tenorMonths。pads L48 R20 T18 B44。
- 配色固定：KO #27ae60 / KI #c0392b / Alive #3498db，填充 + '33' 透明。
- 绘制顺序：① KI 区（底）：沿 kiPct(j) j=1..nSteps 折线闭合填充 + 1.5px 描边；①a KI 粗线 3.5px（自 5% 步起）。② Alive 区（中）：底=KI 曲线、顶=KO 阶梯（倒序遍历 obsSteps：x(s) 处 1−koPct(s) → 1−koPct(s−1) 垂直跳变），填充+描边。③ KO 区（顶）：y1 顶边 → 1−koPct(nSteps) → 阶梯倒序 → 1−koPct(0)，填充+描边。
- 轴：Y 0/25/50/75/100%；X 月刻度步长 lastM≤12?1:2，4px 刻度线；Y 标题 '概率占比'@x=14；X 标签 '时间(月)'。
- 图例（绘图区左上内）：12×12 色块+label+末期值 %（KO/KI/Alive=1−ko−ki），步进 文本+28。锁定期虚线 #999 [3,3] + '锁定期末' @(y0+18)。

### B5. drawPathHistogram(cv,mc,P) — PV 概率密度（KDE+VaR/ES）— L749
- 输入 mc.pvs。sorted 副本；VaR95=sorted[floor(n·0.05)]；ES95=sorted[0..varIdx] 均值。std→Silverman h=1.06·σ·n^(−1/5)，下限 range/80。300 采样点，域=[min−6%,max+6%]；高斯核 norm=1/(n·h·√(2π))。
- pads L68 R90 T30 B44；yAt 峰值×0.92。Y 网格 5 段 toFixed(1)；X 6 刻度 toFixed(3)。
- 填充 rgba(74,125,180,0.15) + 曲线 #4a7db4 2px。VaR 竖线 #e67e22 2px [6,3] 标签 bold 11 @(y1+4)；ES 竖线 #9b2226 2px [4,4] 标签 @(y1+20)；理论价值竖线 th.negative 2.5px 实线，标签左对齐 min(tvX+4, x1−文本宽−4) @(y1+4)。
- 轴；Y 标题 '概率密度'@x=16；X 标签 '路径终值 (PV)'。标题 'PV 概率密度分布' bold 13 @(x0,y1−6)。图例右侧 x1+6：密度/理论价值/VaR/ES，线段 14px。

### B6. drawCouponAccrual(cv,P,mc) — 票息累积曲线 — L1269
- cDiv=couponDiv??couponRate；tiered：early/late 缺省回退 couponRate，cSwitch=couponSwitchMonth||1。逐路径：KO→mo=kt/spm，obsIdx=round(mo)−lockout，rate=tiered?(obsIdx≥cSwitch?late:early):couponRate，cpAmt=rate·(mo/12)，cpMonth=min(lastM,round(mo))；未 KO 未 KI（持有到期未敲入）→cpAmt=cDiv·(tenorMonths/12)，cpMonth=lastM；cpAmt/cpMonth 均摊至月 1..cpMonth；最后 /n。
- yMax=max 月值（≤0 取 0.01）+12%。pads L52 R26 T26 B44。网格 5 段百分比 1dp；Y 标题 '预期累积票息（年化%）'；X 刻度步 max(1,floor(lastM/8))。
- 绿色渐变填充（顶 rgba(45,106,79,0.35)→底 0.05）；线 series[0] 2.5px；月点 r=3 实心；终点标签 '最终预期票息 X.XX%' bold 11。轴；标题 '票息累积曲线' @(x0,y1−6)。

### B7. drawKODistribution(cv,P,mc) — 逐观察日敲出概率柱图 — L1392
- obsMonths=lockout+1..lastM；koCounts=round(kt/spm) 落入 obs 月计数；barPcts=count/n。yMax=max×1.15（0→0.01 基底）。barW=min(plotW/nObs×0.7,18)。pads L52 R22 T26 B50。
- 柱色 >0 → #2d6a4f，=0 → #ddd；>0.005 加标签 bold 8px 1dp%。X 标签步 max(1,floor(nObs/10))+末位强制。左上 '累积敲出概率 X.X%' bold 11 @(x0,y1−6)。Y 标题 '敲出概率'；标题 '逐观察日敲出概率分解' @(x0,y1−18)。

### B8. drawPathDensityHeatmap(cv,P,mc) — 路径密度热图 50×50 — L1489
- mc.paths 平铺 Float64Array（nP×(nSteps+1)）。时间 bin=lastM+1（月），价格 bin=40（S/S₀∈[0.5,1.5]）【v5 40 格；ui-spec 记 50×50 以实现为准 40×(lastM+1)】。计数→/nP 归一。cell 色：intensity=log10(1+9d/maxD)/log10(10)；rgb(240−200i, 245−160i, 240−100i)；rect +0.5 溢出防缝。
- 边界线：KO（descending→koStartPct）positive 实线、1.0 text 虚线 [4,3]、KI negative 实线，均 1.5px，左上标 'NN%'。pads L52 R24 T26 B44。
- Y 5 刻度 toFixed(2)；X 月步 max(1,floor(lastM/8))；Y 标题 'S/S₀'；X 标签 '时间'。轴；标题 '路径密度热图（价格×时间）'。右侧色标 12px：渐变 (240,245,240)/(140,185,140)/(40,100,40) 底→顶 + '高/低'。

## C. 回测 Tab 图（5）

### C1. drawBtPnl(cv,result) — 累计盈亏曲线 — L930
- 归因分量线性插值 t=i/(n−1)：gPath=gammaPnL·t / tPath=thetaPnL·t / cPath=totalCost·t。Y 域含 cumPnL+三分量 ±10% pad。pads L70 R130 T18 B44。
- 网格 5 段 fmtMoneyAxis；零线 #bbb [4,3]；X 6 日期刻度 fmtDateShort。
- 虚线 1.5px：Gamma #9b2226 [5,3]、Theta #f4a261 [5,3]、成本 th.text [2,2]；主曲线 cumPnL 2.4px 按终值符号 #2d6a4f/#9b2226 + 同色 0.12 透明填充至零线。
- 轴；Y 标题 '累计盈亏 (元)'；X 标签 '日期'；标题 '累计盈亏曲线'。图例右列 x1+6 起：色/线型样本 20px + label + fmtMoneyAxis(终值) @x1+120，行距 16。

### C2. drawBtPath(cv,result,P,btS0) — 标的路径+障碍线+Delta 次轴 — L1070
- 价格域：path.S ∪ {kiPrice=kiPct·btS0, koPrice=(descending?koStartPct:koPct)·btS0, btS0} ±8% pad。Delta 域：path.delta，且 ≤−0.05 / ≥0.05。pads L70 R70 T18 B44。
- 网格（价格左轴）5 段 toFixed(1)。障碍线 1.5px：S₀ text 虚线 [4,3]、敲入 negative 实线、敲出 positive 实线，标签左上 x0+4。
- 价格线 #1a1a1a 2px；Delta 线 #6a4c93 1.5px 虚线 [3,2]（次轴）；右轴 5 刻度 toFixed(2) 紫色。轴；Y 标题 '标的价格'；右标题 'Delta' rotate +90°@W−8；X 6 日期刻度；标签 '日期'。标题 '标的价格路径与 Delta 持仓'。

### C3. drawBtDecomp(cv,result) — 盈亏归因柱状 — L1186
- items：GammaPnL / ThetaPnL / −|totalCost| / residual。Y 域含 0 ±15% pad。pads L70 R30 T30 B50。barW=plotW/4×0.55。
- 网格 5 段；零线 th.text 1.2px；柱色 ≥0 #2d6a4f / <0 #9b2226；值标签 bold 11 上/下方；X 类目标签。轴；Y 标题 '金额 (元)'；标题 '盈亏归因分解' @(x0,y1−8)；右上 '合计: fmtMoneyAxis(cumPnL)'。

### C4. drawIVvsRV(cv,result,P) — IV vs RV（含滚动 RV20/60）— L1621
- 输入 result.rv20[{idx,date,rv}]/rv60；iv=P.vol。Y 域含全部 RV+iv ±12% pad。pads L60 R26 T32 B44。
- 网格 5 段百分比 1dp。IV 横线 th.negative 2px [6,3] + 右上标 'IV (定价σ) = X%'；RV20 实线 #2d6a4f 2px；RV60 虚线 #3498db 1.5px [4,3]（X 按 idx 归一）；RV20 散点步 max(1,floor(n/80))，r=3，rv>iv→#d62728 否则 #2d6a4f，白描边 0.5。
- X 6 日期刻度 9px；Y 标题 '波动率 (年化%)'；轴；标题 th.textStrong。图例左上 @(x0+8,y1−6)：RV20/RV60/IV + 红点 'RV>IV' + 绿点 'RV<IV'。

### C5. drawCostSensitivity(cv,data,N,breakeven) — 成本敏感度折线 — L1763
- data=[{costBps,cumPnL}]。Y 域 ±15% pad。pads L70 R120 T30 B50。网格 5 段 fmtMoneyAxis；零线 th.text 1.5px [5,3] + '盈亏平衡线' @(x1−60)。
- 主线 #2d6a4f 2.5px + 填充 rgba(45,106,79,0.1) 至零线；数据点 r=5 按符号绿/红 + 白描边 1.5 + 值标签 bold 10 上方 −8。盈亏平衡竖线 th.negative 2px [4,2] + '盈亏平衡 ≈ Nbps' @(y1+4)。
- X 逐点 'Nbps'；Y 标题 '累计盈亏 (元)'；X 标签 '单边成本 (bps)'；标题 '成本敏感性扫描'。副行 '对冲频率: {freq} | 名义本金: fmtMoneyAxis(N)' @(x0,y1−18)。**v7 变更**：freqLabel 由参数传入，不读 DOM #btFreq。

## D. 压测 Tab 图（1）

### D1. drawStressMatrix(cv,matrixResults,P) — 5×5 组合矩阵热图 — L1884
- willReadFrequently。len<25→「暂无数据」。轴值 volShock/spotJump ∈ {−0.10,−0.05,0,+0.05,+0.10}（1e−9 浮点匹配）。grid[vi][si]；delta_pv 域 → absMax；pv 最小→worst、最大→best。色映射：t≥0 hsl(120, t·80, 85−t·25)（灰→绿）；t<0 hsl(0, −t·80, 85+t·25)（灰→红）。
- pads L70 R100 T50 B50；rowOf(vi)=4−vi（顶=+10pp）。第1层格子+0.8 边框+外框；第2层格内 PV 文本 pv.toFixed(3)，字号 clamp(8, min(cellW,cellH)/6, 11) bold，intensity>0.45 白字否则 #1a1a1a；第3层特殊框（内缩 lw/2+0.5）：基准格(2,2) text 2px [5,3]、worst negative 2.5px、best positive 2.5px；第4层轴标签：X '0%/±N%'、Y '±Npp/0pp' + 标题 '波动率变化'/'标的价格变化'@y0+26；第5层色标 @(x1+14,14 宽)：底红→中灰→顶绿，标签 fmtDelta（带符号 3dp）max/min/'+0.000'；第6层标题 '组合情景矩阵 (PV 相对基准变化)' bold 13 @(x0,y1−8)。

## E. 非 canvas 呈现（HTML 表格，非本规格范围）
Greeks 六卡、3×3 压力情景表、远期 Greeks 表、五频率对比表、滚动窗口表、压测三表（vol/spot/crisis）、汇总卡——均为 DOM 表格/卡片，见 v7-ui-spec.md §3–5。
