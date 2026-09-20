# CDS 新模型并行验证

2026-09-14 升级采用 QuantLib 1.43 的 ISDA 引擎，固定标准北美高级合约的 40% 回收率，使用官方 NYM 日历、完整票息与应计返还、结算折现。主图和 Excel 继续保留现有模型；新结果写入同一快照的 `creditRisk.cdsModelComparison`，页面展示新旧利差、周变化及历史明细。截图回填不参与复算，也没有引入截图拟合参数。

首次安装、校验并生成结果：

```sh
npm run setup:cds-pricing
npm run test:cds-pricing
npm run refresh:cds-comparison
```

默认安装到忽略版本控制的 `server/data/cds-python-venv`，不依赖临时试验环境。`CDS_SETUP_PYTHON` 可指定创建环境用的 Python 3.9+；`ICE_CDS_PYTHON` 可指定已有 QuantLib 1.43 解释器。Docker 两个后端镜像使用 Debian 运行时安装该依赖。使用其他容器/构建平台时，须执行相同 Python 安装步骤并配置解释器。

以后每次 ICE 导入，都会用实际历史原始价格重算并保存对比结果。手动命令只更新对比数据，使用与看板刷新一致的写入锁，不改工作簿和主序列。超时、运行环境缺失、模型或配置错误会展示“复算失败”，保留上次成功日期；不会把旧结果标成当前数据，也不会阻断原模型导入。

**标准曲线尚需授权数据输入。** 未配置或未覆盖相应日期时，新模型继续使用保存的美国国债收益率代理曲线，页面明确标注“代理曲线 · 估计值”，不将其标成 SOFR 或官方利差。换用标准曲线需要与估值日期匹配的标准折现因子；不能把原始 OIS 报价直接当作零利率。

设置 `ICE_CDS_STANDARD_CURVES_FILE` 指向本地 UTF-8 JSON 文件。文件格式为以下结构；数值仅为格式示例，不能用于生产：

```json
{
  "curves": [{
    "curveId": "usd-standard-rfr-2026-09-11",
    "asOf": "2026-09-11",
    "marketDataAsOf": "2026-09-10",
    "currency": "USD",
    "sourceKind": "isda-standard-rfr",
    "sourceUrl": "https://rfr.spglobal.com/",
    "discountFactors": [
      { "date": "2026-09-11", "discountFactor": 1.0 },
      { "date": "2032-09-11", "discountFactor": 0.8 }
    ]
  }]
}
```

`asOf` 是曲线估值日，须与 ICE 日期相同；`marketDataAsOf` 是输入利率日期，须早于估值日且相差不超过 7 个日历日（粗粒度过期上限，不代替 T−1 营业日的来源核对）。节点必须按真实日期递增，正且有限，首个节点为估值日、折现因子 1，覆盖合约最后支付日；不允许同一天多条曲线。配置文件格式错误将显式失败，不会静默降级。文件来源声明由导入方负责核对，格式校验不代表报价真实性验证。此接口读取标准化折现因子，不自动替用户注册数据提供商或接受条款。

新模型历史按相同曲线类型和同一合约计算周变化。标准曲线开始覆盖某日时，跨“国债代理/标准曲线”的变动暂不展示，避免把口径切换当作信用变动。旧模型与新模型的数值差并不是对真实市场价的误差。

启用正式替换之前，需要独立日期、同一合约/期限、报价字段与时点的市场基准，并覆盖付息日前后等边界。这一版本固定为并行验证，没有自动提升为正式序列的开关。

参考：[ISDA 转换规格](https://www.cdsmodel.com/documentation.html)、[参数和 NYM 日历](https://www.cdsmodel.com/fee-computations.html)、[QuantLib 官方测试](https://github.com/lballabio/QuantLib/blob/master/test-suite/creditdefaultswap.cpp)。
