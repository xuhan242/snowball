# Snowball 雪球结构定价台 v7

> 雪球结构期权定价 · Greeks 风险分解 · 账本口径对冲回测 · 压力测试 一体化工具
> 单文件 Vanilla JS · 零外部依赖 · 双击即可运行

![Vanilla JS](https://img.shields.io/badge/Vanilla%20JS-f7df1e?style=flat-square&logo=javascript&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![Size](https://img.shields.io/badge/bundle-415KB%20%3C%20450KB-success?style=flat-square)
![Tests](https://img.shields.io/badge/tests-44%20passing-success?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

## 在线体验

👉 **https://xuhan242.github.io/snowball/**

整个应用打包为单个 `index.html`（415KB，无 CDN / 无网络字体 / 无后端），也可以下载仓库根目录的 `index.html` 双击直接运行（`file://` 协议自动降级主线程计算）。

## 功能（三 Tab，27 项）

- **定价分析**：Monte Carlo 定价（PV / 四概率 / 标准误 / 95%CI）、6 维 Greeks 卡片（Delta/Gamma/Vega/Theta/Rho/RhoQ，1% 标准化金额 + 卖方视角文案）、Greeks 场景计算器、Greeks 二维曲面热力图、逐观察日敲出概率、时间维度概率演变、票息累积、路径密度热图、PV 密度分布（KDE + VaR/ES）、CEV 局部波动率曲线、反推票息（二分 + CRN）。
- **对冲回测（账本口径）**：五频率对比、成本敏感度扫描（0–50bps + 盈亏平衡）、滚动窗口逐年回测、账本累计盈亏（负债腿逐日盯市 + 对冲腿 + 成本）、绩效指标（Sharpe/Sortino/Calmar + Bootstrap 95% CI）、归因四项分解（Γ/Θ/成本/未归因项 ε，恒等式精确闭合）、IV vs RV、滚动 RV 20/60、标的路径 + Delta 持仓双轴。
- **压力测试**：波动率冲击 7 档、价格跳跃 7 档、历史危机 3 情景（2015 股灾 / 2020 新冠 / 2024 量化风暴，实际波动率运行时实算）、5×5 组合矩阵热图、最劣情景汇总。

## 数值可信：三层 golden 基准逐位回归

| 基线 | 覆盖 | 断言 |
|---|---|---|
| `tests/golden.json`（v5 提取，只读） | Sobol 指纹、CEV/GBM 定价、Greeks、反推票息、曲面、查表 552 格、压测、危机 | 逐位一致 |
| `tests/golden-v7-scaled.json` | 回测腿级键（单位口径修正后重立） | 逐位一致 |
| `tests/golden-v7-book.json` | 查表 PV 552 格 + 账本回测三频率 | 逐位一致 |

`node test/run.mjs` → **44 断言全绿**为交付门槛；对冲回测的账本口径（负债腿盯市入账、归因恒等式）推导见 `snowball-v7/docs/book-accounting.md`。

## 技术要点

- **Sobol 低差异序列**（756 维方向数表、Gray 码增量、Acklam 逆正态）+ **CRN 有限差分 Greeks**（扰动重定价共用随机数，消除 MC 噪声）。
- 路径模型：GBM / CEV 局部波动率（β=0）/ Brownian Bridge 方差缩减 / Merton 跳跃（确定性流，可复现）。
- **Worker 池三级降级**：按路径分片 Transferable 传输 → 合并单任务 → 主线程逐格（MessageChannel 让步，后台标签不被定时器节流）；`file://` 与 http 两种形态数值逐位一致。
- **快照数据内嵌**（deflate+base64）：6 指数日线（2018 起 + 2015 危机补段）、股息率、中债国债收益率曲线 8 期限点（快照 2026-09-17），无风险利率三模式（曲线插值 / 自定义 / 固定口径 2%）。
- 明暗双主题、桌面最小宽 1200px、红绿仅表达盈亏。

## 目录结构

```
├── index.html            # 在线部署页 = snowball-v7/dist 构建产物（双击可跑）
├── snowball-v7/          # 完整项目：源码 / 测试 / golden 基准 / 设计与推导文档
│   ├── src/core/         # 算法层（Sobol、定价、Greeks、查表、账本回测、压测）
│   ├── src/workers/      # Worker 池与三级降级
│   ├── test/             # 44 断言（单测 + golden 黄金回归）
│   └── docs/             # 设计规格 / 回测口径推导 / 账本口径推导 / 截图
└── dist/index.html       # 同根 index.html（保留旧路径兼容）
```

## 本地开发

```bash
cd snowball-v7
npm install        # vite + vite-plugin-singlefile
node test/run.mjs  # 44 断言（golden 逐位回归）
npm run build      # 产出单文件 dist/index.html
```

## License

MIT
