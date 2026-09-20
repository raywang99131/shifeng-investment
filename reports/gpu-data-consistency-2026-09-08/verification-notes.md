# 核验说明

报告采用 executive-report 结构；精确对照使用表格。唯一趋势图为官方Ornn H100的12个逐日观察，单系列，日期横轴、USD/GPU/hour纵轴，不叠加不同来源。报告源状态partial反映缺少平台出处和另外两家本期完整历史；未取得历史不会被当作已验真。计算使用可复现JavaScript，运行 node build-audit.mjs。原始JSON保留在evidence。

高严重度问题：单位、结算日、跨来源拼接、签约主体。中严重度问题：滚动7日与六天区间混用、历史和方法版本缺失。事实与推断分别标明。Report结构：标题、Executive Summary、价格证据和事件核验、使用建议、待补证据、核验边界。
