# The Block 本次可直接访问的 JSON

核实日期：2026-10-18。扫描 The Block 44 个公开目录入口，发现 516 个去重 JSON 地址，其中 375 个返回 HTTP 200，141 个返回 HTTP 403。

说明：200 仅表示本次本地请求成功并检查了响应前部，不保证部署服务器可访问、数据完整、实时性或正式免费 API 权限。频率、原始来源按响应元数据记录。

扫描缺口：11 个 on-chain-metrics 目录返回 403，未枚举其中全部资源；该索引不是 The Block 内部所有接口的完整清单。

推荐星级按对当前交易看板的参考价值评估：★★★★★ 优先接入；★★★★ 重要补充；★★★ 按需选用；★★ 专题研究；★ 低优先级。星级不代表访问权限、数据质量或交易信号强度；是否可访问仍以 HTTP 列为准。

## DeFi / cryptocurrency-lending（1 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Total Value Locked Solana in Lending USD](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedsolanainlendingusd_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |

## DeFi / derivatives（26 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [DEX Options Daily Notional Volume](https://data.tbstat.com/dashboard/openfinance_dexnoncustodial_dexoptionsdailynotionalvolume_daily_defillama.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Daily | DefiLlama |
| [DEX Options Notional Volume Market Share](https://data.tbstat.com/dashboard/openfinance_dexnoncustodial_dexoptionsnotionalvolumemarketshare_daily_defillama.json) | 各平台或类别成交量占比 | ★★ | 200 | Daily | DefiLlama |
| [DEX to CEX Futures Trade Volume](https://data.tbstat.com/dashboard/openfinance_dexnoncustodial_dextocexfuturestradevolume_monthly_others.json) | 去中心化与中心化交易所成交量之比 | ★★★ | 200 | Monthly | Others |
| [Daily HIP-3 Open Interest showed by DEX](https://data.tbstat.com/dashboard/openfinance_exchanges_dailyhipopeninterestshowedbydex_daily_hyperliquid.json) | 未平仓合约的规模或分组分布 | ★★★ | 200 | Daily | Hyperliquid |
| [Daily HIP-3 Volume Showed by Asset](https://data.tbstat.com/dashboard/openfinance_exchanges_dailyhipvolumeshowedbyasset_daily_hyperliquid.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Daily | Hyperliquid |
| [Daily HIP-3 Volume per DEX in USD Bar](https://data.tbstat.com/dashboard/openfinance_exchanges_dailyhipvolumeperdexinusdbar_daily_hyperliquid.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Daily | Hyperliquid |
| [Daily Hyperliquid Liquidations](https://data.tbstat.com/dashboard/openfinance_exchanges_dailyhyperliquidliquidations_daily_tokenterminal.json) | 被强制平仓的规模或数量，具体方向和周期见指标名 | ★★★★ | 200 | Daily | Token Terminal |
| [Daily Hyperliquid Open Interest](https://data.tbstat.com/dashboard/openfinance_exchanges_dailyhyperliquidopeninterest_daily_tokenterminal.json) | 未平仓合约的规模或分组分布 | ★★★ | 200 | Daily | Token Terminal |
| [Daily Hyperliquid Total Cumulative Liquidations](https://data.tbstat.com/dashboard/openfinance_exchanges_dailyhyperliquidtotalcumulativeliquidations_daily_tokenterminal.json) | 被强制平仓的规模或数量，具体方向和周期见指标名 | ★★★★ | 200 | Daily | Token Terminal |
| [Daily Hyperliquid Total Cumulative Volume in USD](https://data.tbstat.com/dashboard/openfinance_exchanges_dailyhyperliquidtotalcumulativevolumeinusd_daily_hyperliquid.json) | 从历史起点累积的成交量，不是单日成交量 | ★★ | 200 | Daily | Hyperliquid |
| [Daily Hyperliquid Volume USD](https://data.tbstat.com/dashboard/openfinance_exchanges_dailyhyperliquidvolumeusd_daily_hyperliquid.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Daily | Hyperliquid |
| [HIP-3 Volume Market Share of Hyperliquid Perpetuals](https://data.tbstat.com/dashboard/openfinance_exchanges_hipvolumemarketshareofhyperliquidperpetuals_daily_hyperliquid.json) | 各平台或类别成交量占比 | ★★ | 200 | Daily | Hyperliquid |
| [Hyperliquid Daily revenue per builder in USD](https://data.tbstat.com/dashboard/openfinance_exchanges_hyperliquiddailyrevenueperbuilderinusd_daily_other.json) | 公司、协议或平台收入及其分组分布 | ★★ | 200 | Daily | Other |
| [Hyperliquid Daily volume per builder in USD](https://data.tbstat.com/dashboard/openfinance_exchanges_hyperliquiddailyvolumeperbuilderinusd_daily_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Daily | Other |
| [Hyperliquid vs Binance Perpetual Trading Volume](https://data.tbstat.com/dashboard/openfinance_derivatives_hyperliquidvsbinanceperpetualtradingvolume_monthly_defillama.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Monthly | DefiLlama |
| [Hyperliquid vs Exchanges Open Interest Monthly](https://data.tbstat.com/dashboard/openfinance_derivatives_hyperliquidvsexchangesopeninterestmonthly_monthly_defillama.json) | 未平仓合约的规模或分组分布 | ★★★ | 200 | Monthly | DefiLlama |
| [Hyperliquid vs Exchanges Perpetual Trading Volume](https://data.tbstat.com/dashboard/openfinance_derivatives_hyperliquidvsexchangesperpetualtradingvolume_monthly_defillama.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Monthly | DefiLlama |
| [PaperTrade Cumulative Liquidation Volume](https://data.tbstat.com/dashboard/openfinance_derivatives_papertradecumulativeliquidationvolume_daily_other.json) | 强制平仓金额或数量 | ★★★ | 200 | Daily | Other |
| [PaperTrade Cumulative Volume](https://data.tbstat.com/dashboard/openfinance_derivatives_papertradecumulativevolume_daily_other.json) | 从历史起点累积的成交量，不是单日成交量 | ★★ | 200 | Daily | Other |
| [PaperTrade Daily Liquidation Volume](https://data.tbstat.com/dashboard/openfinance_derivatives_papertradedailyliquidationvolume_daily_other.json) | 强制平仓金额或数量 | ★★★ | 200 | Daily | Other |
| [PaperTrade Daily Open Interest](https://data.tbstat.com/dashboard/openfinance_derivatives_papertradedailyopeninterest_daily_other.json) | 未平仓合约的规模或分组分布 | ★★★ | 200 | Daily | Other |
| [PaperTrade Daily Volume](https://data.tbstat.com/dashboard/openfinance_derivatives_papertradedailyvolume_daily_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Daily | Other |
| [PaperTrade TVL](https://data.tbstat.com/dashboard/openfinance_derivatives_papertradetvl_daily_other.json) | 协议或生态的锁仓资产价值 | ★★ | 200 | Daily | Other |
| [Perpetual Protocol Trade Market Share](https://data.tbstat.com/dashboard/openfinance_derivatives_perpetualprotocoltrademarketshare_daily_defillama.json) | 各组成部分在该指标中的占比 | ★★ | 200 | Daily | DefiLlama |
| [Perpetual Protocol Trade Volume](https://data.tbstat.com/dashboard/openfinance_derivatives_perpetualprotocoltradevolume_daily_defillama.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Daily | DefiLlama |
| [Total Staked Assets by Validator (Market Share)](https://data.tbstat.com/dashboard/onchainmetrics_hyperliquid_totalstakedassetsbyvalidatormarketshare_daily_other.json) | 各组成部分在该指标中的占比 | ★★ | 200 | Daily | Other |

## DeFi / dex-non-custodial（12 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [DEX Aggregator Market Share](https://data.tbstat.com/dashboard/openfinance_dexnoncustodial_dexaggregatormarketshare_monthly_tokenterminal.json) | 各组成部分在该指标中的占比 | ★★ | 200 | Monthly | Token Terminal |
| [DEX Aggregator Volume](https://data.tbstat.com/dashboard/openfinance_dexnoncustodial_dexaggregatorvolume_monthly_tokenterminal.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Monthly | Token Terminal |
| [DEX Transactions Market Share by Chain (Daily)](https://data.tbstat.com/dashboard/openfinance_exchanges_dextransactionsmarketsharebychaindaily_daily_tokenterminal.json) | 各组成部分在该指标中的占比 | ★★ | 200 | Daily | Token Terminal |
| [DEX Users Market Share by Chain (Daily)](https://data.tbstat.com/dashboard/openfinance_exchanges_dexusersmarketsharebychaindaily_daily_tokenterminal.json) | 各组成部分在该指标中的占比 | ★★ | 200 | Daily | Token Terminal |
| [DEX Volume](https://data.tbstat.com/dashboard/openfinance_dexnoncustodial_dexvolume_monthly_coingecko.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Monthly | Coingecko |
| [DEX to CEX Spot Trade Volume Updated](https://data.tbstat.com/dashboard/openfinance_dexnoncustodial_dextocexspottradevolumeupdated_monthly_others.json) | 去中心化与中心化交易所成交量之比 | ★★★ | 200 | Monthly | Others |
| [Daily DEX Transactions Per Chain](https://data.tbstat.com/dashboard/openfinance_exchanges_dailydextransactionsperchain_daily_tokenterminal.json) | 交易笔数及其按链分布 | ★★ | 200 | Daily | Token Terminal |
| [Daily DEX Users Per Chain](https://data.tbstat.com/dashboard/openfinance_exchanges_dailydexusersperchain_daily_tokenterminal.json) | 用户或活跃地址数量及其分布 | ★★ | 200 | Daily | Token Terminal |
| [Ethereum vs Solana DEX Volume](https://data.tbstat.com/dashboard/openfinance_dexnoncustodial_ethereumvssolanadexvolume_weekly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Weekly | Other |
| [MetaDAO Futarchy AMM Fees in USD](https://data.tbstat.com/dashboard/openfinance_exchanges_metadaofutarchyammfeesinusd_daily_defillama.json) | 协议、平台或市场收取的手续费 | ★★ | 200 | Daily | DefiLlama |
| [MetaDAO Futarchy AMM Volume (USD)](https://data.tbstat.com/dashboard/openfinance_exchanges_metadaofutarchyammvolumeusd_daily_defillama.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Daily | DefiLlama |
| [Share of DEX Volume](https://data.tbstat.com/dashboard/openfinance_dexnoncustodial_shareofdexvolume_monthly_defillama.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Monthly | DefiLlama |

## DeFi / prediction-markets（22 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Hyperliquid HIP-4 Cumulative Volume](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_hyperliquidhipcumulativevolume_daily_tokenterminal.json) | 从历史起点累积的成交量，不是单日成交量 | ★★ | 200 | Daily | Token Terminal |
| [Hyperliquid HIP-4 Daily Volume USD](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_hyperliquidhipdailyvolumeusd_daily_tokenterminal.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Daily | Token Terminal |
| [Kalshi Daily Active Markets](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_kalshidailyactivemarkets_daily_other.json) | 活跃市场数量 | ★★ | 200 | Daily | Other |
| [Kalshi Open Interest USD Daily](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_kalshiopeninterestusddaily_daily_other.json) | 未平仓合约的规模或分组分布 | ★★★ | 200 | Daily | Other |
| [Kalshi Volume Per Category Market Share](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_kalshivolumepercategorymarketshare_daily_other.json) | 各组成部分在该指标中的占比 | ★★ | 200 | Daily | Other |
| [Kalshi Volume Per Category USD](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_kalshivolumepercategoryusd_daily_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Daily | Other |
| [Polymarket Crypto Up or Down Daily USD Volume Notional The Block Source](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_polymarketcryptoupordowndailyusdvolumenotionaltheblocksource_daily_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Daily | Other |
| [Polymarket Crypto Up or Down Daily Volume Market Share by Timeframe](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_polymarketcryptoupordowndailyvolumemarketsharebytimeframe_daily_other.json) | 各平台或类别成交量占比 | ★★ | 200 | Daily | Other |
| [Polymarket US Fees USD - Monthly](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_polymarketusfeesusdmonthly_monthly_other.json) | 协议、平台或市场收取的手续费 | ★★ | 200 | Monthly | Other |
| [Polymarket US Trades - Monthly](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_polymarketustradesmonthly_monthly_other.json) | 市场成交笔数 | ★★ | 200 | Monthly | Other |
| [Polymarket Volume Per Category Market Share in Percentage The Block Source](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_polymarketvolumepercategorymarketshareinpercentagetheblocksource_daily_other.json) | 各组成部分在该指标中的占比 | ★★ | 200 | Daily | Other |
| [Polymarket Volume Per Category USD The Block Source](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_polymarketvolumepercategoryusdtheblocksource_daily_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Daily | Other |
| [Polymarket pUSD Supply Token Terminal](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_polymarketpusdsupplytokenterminal_daily_tokenterminal.json) | Polymarket pUSD 的供应量 | ★★ | 200 | Daily | Token Terminal |
| [Polymarket, Polymarket US, and Kalshi Cumulative Volume USD](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_polymarketpolymarketusandkalshicumulativevolumeusd_monthly_other.json) | 从历史起点累积的成交量，不是单日成交量 | ★★ | 200 | Monthly | Other |
| [Polymarket, Polymarket US, and Kalshi Open Interest US Dollars](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_polymarketpolymarketusandkalshiopeninterestusdollars_daily_other.json) | 未平仓合约的规模或分组分布 | ★★★ | 200 | Daily | Other |
| [Polymarket, Polymarket US, and Kalshi Volume Market Share](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_polymarketpolymarketusandkalshivolumemarketshare_monthly_other.json) | 各平台或类别成交量占比 | ★★ | 200 | Monthly | Other |
| [Polymarket, Polymarket US, and Kalshi Volume in USD](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_polymarketpolymarketusandkalshivolumeinusd_monthly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Monthly | Other |
| [Polymarket, Polymarket US, and Kalshi Weekly Volume in USD](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_polymarketpolymarketusandkalshiweeklyvolumeinusd_weekly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Weekly | Other |
| [Prediction Markets to Spot Exchanges Volume Ratio](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_predictionmarketstospotexchangesvolumeratio_monthly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Monthly | Other |
| [Weekly Prediction Market Notional Volume](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_weeklypredictionmarketnotionalvolume_weekly_artemis.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Weekly | Artemis |
| [Weekly Prediction Market Notional Volume Market Share](https://data.tbstat.com/dashboard/openfinance_predictionmarkets_weeklypredictionmarketnotionalvolumemarketshare_weekly_artemis.json) | 各平台或类别成交量占比 | ★★ | 200 | Weekly | Artemis |
| [Yearly Venture Funding \u2014 Prediction Markets](https://data.tbstat.com/dashboard/alternativemetrics_funding_yearlyventurefundingpredictionmarkets_yearly_other.json) | 加密行业风险投资融资金额，按类别或阶段统计 | ★★ | 200 | Yearly | Other |

## DeFi / real-world-assets（14 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [RWA Market Cap Market Share by Asset Class](https://data.tbstat.com/dashboard/openfinance_rwa_rwamarketcapmarketsharebyassetclass_daily_other.json) | 各组成部分在该指标中的占比 | ★★ | 200 | Daily | Other |
| [RWA Market Cap Market Share by Blockchain Percentage](https://data.tbstat.com/dashboard/openfinance_rwa_rwamarketcapmarketsharebyblockchainpercentage_daily_other.json) | 各组成部分在该指标中的占比 | ★★ | 200 | Daily | Other |
| [RWA Market Cap Market Share by Issuer](https://data.tbstat.com/dashboard/openfinance_rwa_rwamarketcapmarketsharebyissuer_daily_other.json) | 各组成部分在该指标中的占比 | ★★ | 200 | Daily | Other |
| [RWA Market Cap Market Share by Issuer Country](https://data.tbstat.com/dashboard/openfinance_rwa_rwamarketcapmarketsharebyissuercountry_daily_other.json) | 各组成部分在该指标中的占比 | ★★ | 200 | Daily | Other |
| [RWA Market Cap by Asset Class Absolute](https://data.tbstat.com/dashboard/openfinance_rwa_rwamarketcapbyassetclassabsolute_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Other |
| [RWA Market Cap by Blockchain](https://data.tbstat.com/dashboard/openfinance_rwa_rwamarketcapbyblockchain_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Other |
| [RWA Market Cap by Issuer](https://data.tbstat.com/dashboard/openfinance_rwa_rwamarketcapbyissuer_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Other |
| [RWA Market Cap by Issuer Country](https://data.tbstat.com/dashboard/openfinance_rwa_rwamarketcapbyissuercountry_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Other |
| [RWA Market Cap by Protocol Absolute](https://data.tbstat.com/dashboard/openfinance_rwa_rwamarketcapbyprotocolabsolute_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Other |
| [RWA Monthly Volume USD by Asset Class](https://data.tbstat.com/dashboard/openfinance_rwa_rwamonthlyvolumeusdbyassetclass_monthly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Monthly | Other |
| [RWA Monthly Volume by Blockchain USD Bar Chart](https://data.tbstat.com/dashboard/openfinance_rwa_rwamonthlyvolumebyblockchainusdbarchart_monthly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Monthly | Other |
| [RWA USD Monthly Volume by Issuer Bar Chart](https://data.tbstat.com/dashboard/openfinance_rwa_rwausdmonthlyvolumebyissuerbarchart_monthly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★ | 200 | Monthly | Other |
| [Tokenized Equities As A Share Of Stablecoin Supply](https://data.tbstat.com/dashboard/openfinance_rwa_tokenizedequitiesasashareofstablecoinsupply_daily_tokenterminal.json) | 稳定币供应量及其分组分布 | ★★ | 200 | Daily | Token Terminal |
| [Total Value Locked RWA by Protocol](https://data.tbstat.com/dashboard/openfinance_rwa_totalvaluelockedrwabyprotocol_daily_defillama.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Defillama |

## DeFi / total-value-locked-tvl（14 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Share of Total Value Locked by Language](https://data.tbstat.com/dashboard/openfinance_tvl_shareoftotalvaluelockedbylanguage_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelocked_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked Avalanche](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedavalanche_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked BSC](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedbsc_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked Fantom](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedfantom_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked L1s Comparison Growth](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedlscomparisongrowth_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked Polygon](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedpolygon_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked Solana](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedsolana_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked by Category](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedbycategory_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked by Protocol](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedbyprotocol_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked by chain](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedbychain_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked in DEXs](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedindexs_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked in Lending](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedinlending_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |
| [Total Value Locked in Liquid Staking](https://data.tbstat.com/dashboard/openfinance_tvl_totalvaluelockedinliquidstaking_daily_other.json) | DeFi 锁定资产价值及其分组分布，受资产价格影响 | ★★★ | 200 | Daily | Other |

## ETF / bitcoin-etf（28 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [BITO Performance](https://data.tbstat.com/dashboard/markets_stucturedprodcuts_bitoperformance_daily_other.json) | BITO 比特币期货 ETF 的表现序列 | ★★★ | 200 | Daily | Other |
| [BTC ETFs On-Chain Holdings as Percentage of Supply](https://data.tbstat.com/dashboard/markets_structuredproducts_btcetfsonchainholdingsaspercentageofsupply_daily_artemis.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Artemis |
| [BTC Futures ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_btcfuturesetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [BTC Spot ETF Cumulative Volumes in USD](https://data.tbstat.com/dashboard/markets_structuredproducts_btcspotetfcumulativevolumesinusd_daily_yahoofinance.json) | 从历史起点累积的成交量，不是单日成交量 | ★★★ | 200 | Daily | Yahoo Finance |
| [BTC Spot ETF Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_btcspotetfflows_daily_other.json) | ETF 或基金的资金流入与流出 | ★★★★ | 200 | Daily | Other |
| [BTC Spot ETF Flows In BTC](https://data.tbstat.com/dashboard/markets_structuredproducts_btcspotetfflowsinbtc_daily_other.json) | 以 BTC 数量计价的 ETF 资金流 | ★★★★ | 200 | Daily | Other |
| [BTC Spot ETF Market Share](https://data.tbstat.com/dashboard/markets_structuredproducts_btcspotetfmarketshare_daily_yahoofinance.json) | 各组成部分在该指标中的占比 | ★★★ | 200 | Daily | Yahoo Finance |
| [BTC Spot ETF Total Net Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_btcspotetftotalnetflows_daily_other.json) | 现货 ETF 单日净流入合计，正值为净流入、负值为净流出 | ★★★★★ | 200 | Daily | Other |
| [BTC Spot ETF Total Net Flows In BTC](https://data.tbstat.com/dashboard/markets_structuredproducts_btcspotetftotalnetflowsinbtc_daily_other.json) | 以 BTC 数量计价的现货 ETF 单日净流入合计 | ★★★★★ | 200 | Daily | Other |
| [BTC Spot ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_btcspotetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [BTC Spot ETF vs Spot Market Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_btcspotetfvsspotmarketvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [BTC Spot vs Futures ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_btcspotvsfuturesetfvolumes_daily_yahoofinance.json) | 现货与期货相关产品成交量对照 | ★★★ | 200 | Daily | Yahoo Finance |
| [Bitcoin ETFs AUM](https://data.tbstat.com/dashboard/markets_structuredproducts_bitcoinetfsaum_daily_artemis.json) | ETF 或基金管理资产规模 | ★★★★ | 200 | Daily | Artemis |
| [Bitcoin ETFs AUM (BTC)](https://data.tbstat.com/dashboard/markets_structuredproducts_bitcoinetfsaumbtc_daily_artemis.json) | ETF 或基金管理资产规模 | ★★★★ | 200 | Daily | Artemis |
| [Bitcoin ETFs AUM ex-GBTC](https://data.tbstat.com/dashboard/markets_structuredproducts_bitcoinetfsaumexgbtc_daily_artemis.json) | ETF 或基金管理资产规模 | ★★★★ | 200 | Daily | Artemis |
| [BlackRock Bitcoin ETF (IBIT) AUM](https://data.tbstat.com/dashboard/markets_structuredproducts_blackrockbitcoinetfibitaum_daily_artemis.json) | ETF 或基金管理资产规模 | ★★★★ | 200 | Daily | Artemis |
| [Daily premium of GBTC help](https://data.tbstat.com/dashboard/markets_grayscale_dailypremiumofgbtchelp_daily_coinglass.json) | 基金价格相对资产净值的每日溢价或折价 | ★★★ | 200 | Daily | coinglass |
| [Daily volume of GBTC](https://data.tbstat.com/dashboard/markets_grayscale_dailyvolumeofgbtc_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [FBTC Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_fbtcflows_daily_other.json) | ETF 或基金的资金流入与流出 | ★★★★ | 200 | Daily | Other |
| [FBTC Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_fbtcvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [Fidelity Bitcoin ETF (FBTC) AUM](https://data.tbstat.com/dashboard/markets_structuredproducts_fidelitybitcoinetffbtcaum_daily_artemis.json) | ETF 或基金管理资产规模 | ★★★★ | 200 | Daily | Artemis |
| [Grayscale Revenue from GBTC and ETHE](https://data.tbstat.com/dashboard/markets_grayscale_grayscalerevenuefromgbtcandethe_monthly_other.json) | 公司、协议或平台收入及其分组分布 | ★★★ | 200 | Monthly | Other |
| [Hong Kong BTC Spot ETF Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_hongkongbtcspotetfflows_daily_other.json) | ETF 或基金的资金流入与流出 | ★★★★ | 200 | Daily | Other |
| [Hong Kong BTC Spot ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_hongkongbtcspotetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [Hong Kong Spot ETF AUMs](https://data.tbstat.com/dashboard/markets_structuredproducts_hongkongspotetfaums_daily_other.json) | ETF 或基金管理资产规模 | ★★★ | 200 | Daily | Other |
| [IBIT Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_ibitflows_daily_other.json) | ETF 或基金的资金流入与流出 | ★★★★ | 200 | Daily | Other |
| [IBIT Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_ibitvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [Mixed Strategy ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_mixedstrategyetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |

## ETF / crypto-etfs（14 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [DOGE Spot ETF Cumulative Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_dogespotetfcumulativevolumes_daily_yahoofinance.json) | 从历史起点累积的成交量，不是单日成交量 | ★★★ | 200 | Daily | Yahoo Finance |
| [DOGE Spot ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_dogespotetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [HYPE Spot ETF Cumulative Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_hypespotetfcumulativevolumes_daily_yahoofinance.json) | 从历史起点累积的成交量，不是单日成交量 | ★★★ | 200 | Daily | Yahoo Finance |
| [HYPE Spot ETF Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_hypespotetfflows_daily_other.json) | ETF 或基金的资金流入与流出 | ★★★ | 200 | Daily | Other |
| [HYPE Spot ETF Market Share](https://data.tbstat.com/dashboard/markets_structuredproducts_hypespotetfmarketshare_daily_yahoofinance.json) | 各组成部分在该指标中的占比 | ★★★ | 200 | Daily | Yahoo Finance |
| [HYPE Spot ETF Total Daily Flows and HYPE Price](https://data.tbstat.com/dashboard/markets_structuredproducts_hypespotetftotaldailyflowsandhypeprice_daily_yahoofinance.json) | ETF 单日资金流与币价的对照 | ★★★ | 200 | Daily | Yahoo Finance |
| [HYPE Spot ETF Total Net Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_hypespotetftotalnetflows_daily_other.json) | 现货 ETF 单日净流入合计，正值为净流入、负值为净流出 | ★★★★★ | 200 | Daily | Other |
| [HYPE Spot ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_hypespotetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [LINK Spot ETF Cumulative Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_linkspotetfcumulativevolumes_daily_yahoofinance.json) | 从历史起点累积的成交量，不是单日成交量 | ★★★ | 200 | Daily | Yahoo Finance |
| [LINK Spot ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_linkspotetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [LTC Spot ETF Cumulative Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_ltcspotetfcumulativevolumes_daily_yahoofinance.json) | 从历史起点累积的成交量，不是单日成交量 | ★★★ | 200 | Daily | Yahoo Finance |
| [LTC Spot ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_ltcspotetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [ZEC Spot ETF Cumulative Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_zecspotetfcumulativevolumes_daily_yahoofinance.json) | 从历史起点累积的成交量，不是单日成交量 | ★★★ | 200 | Daily | Yahoo Finance |
| [ZEC Spot ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_zecspotetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |

## ETF / etf-comparison（7 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Spot ETF AUM Market Share by Coin](https://data.tbstat.com/dashboard/markets_structuredproducts_spotetfaummarketsharebycoin_daily_other.json) | ETF 或基金管理资产规模 | ★★★ | 200 | Daily | Other |
| [Spot ETF Market Share by Coin](https://data.tbstat.com/dashboard/markets_structuredproducts_spotetfmarketsharebycoin_daily_yahoofinance.json) | 各组成部分在该指标中的占比 | ★★★ | 200 | Daily | Yahoo Finance |
| [Spot ETF Market Share by Coin (Excluding BTC & ETH)](https://data.tbstat.com/dashboard/markets_structuredproducts_spotetfmarketsharebycoinexcludingbtceth_daily_yahoofinance.json) | 各组成部分在该指标中的占比 | ★★★ | 200 | Daily | Yahoo Finance |
| [Spot ETF Volumes USD (Excluding BTC & ETH) Cumulative](https://data.tbstat.com/dashboard/markets_structuredproducts_spotetfvolumesusdexcludingbtcethcumulative_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [Spot ETF Volumes USD Cumulative](https://data.tbstat.com/dashboard/markets_structuredproducts_spotetfvolumesusdcumulative_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [Spot ETF Volumes by Coin](https://data.tbstat.com/dashboard/markets_structuredproducts_spotetfvolumesbycoin_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [Spot ETF Volumes by Coin (Excluding BTC & ETH)](https://data.tbstat.com/dashboard/markets_structuredproducts_spotetfvolumesbycoinexcludingbtceth_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |

## ETF / ethereum-etfs（21 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Daily premium of ETHE Help](https://data.tbstat.com/dashboard/markets_grayscale_dailypremiumofethehelp_daily_coinglass.json) | 基金价格相对资产净值的每日溢价或折价 | ★★★ | 200 | Daily | coinglass |
| [Daily volume of ETHE](https://data.tbstat.com/dashboard/markets_grayscale_dailyvolumeofethe_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [ETH Futures ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_ethfuturesetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [ETH Spot ETF AUM timeseries](https://data.tbstat.com/dashboard/markets_structuredproducts_ethspotetfaumtimeseries_daily_other.json) | ETF 或基金管理资产规模 | ★★★★ | 200 | Daily | Other |
| [ETH Spot ETF Cumulative Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_ethspotetfcumulativevolumes_daily_yahoofinance.json) | 从历史起点累积的成交量，不是单日成交量 | ★★★ | 200 | Daily | Yahoo Finance |
| [ETH Spot ETF Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_ethspotetfflows_daily_other.json) | ETF 或基金的资金流入与流出 | ★★★★ | 200 | Daily | Other |
| [ETH Spot ETF Flows In ETH](https://data.tbstat.com/dashboard/markets_structuredproducts_ethspotetfflowsineth_daily_other.json) | 以 ETH 数量计价的 ETF 资金流 | ★★★★ | 200 | Daily | Other |
| [ETH Spot ETF Market Share](https://data.tbstat.com/dashboard/markets_structuredproducts_ethspotetfmarketshare_daily_yahoofinance.json) | 各组成部分在该指标中的占比 | ★★★ | 200 | Daily | Yahoo Finance |
| [ETH Spot ETF Total Net Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_ethspotetftotalnetflows_daily_other.json) | 现货 ETF 单日净流入合计，正值为净流入、负值为净流出 | ★★★★★ | 200 | Daily | Other |
| [ETH Spot ETF Total Net Flows In ETH](https://data.tbstat.com/dashboard/markets_structuredproducts_ethspotetftotalnetflowsineth_daily_other.json) | 以 ETH 数量计价的现货 ETF 单日净流入合计 | ★★★★★ | 200 | Daily | Other |
| [ETH Spot ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_ethspotetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [ETH Spot ETF vs Spot Market Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_ethspotetfvsspotmarketvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [ETH Spot vs Futures ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_ethspotvsfuturesetfvolumes_daily_yahoofinance.json) | 现货与期货相关产品成交量对照 | ★★★ | 200 | Daily | Yahoo Finance |
| [ETHA AUM timeseries](https://data.tbstat.com/dashboard/markets_structuredproducts_ethaaumtimeseries_daily_other.json) | ETF 或基金管理资产规模 | ★★★★ | 200 | Daily | Other |
| [ETHA Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_ethaflows_daily_other.json) | ETF 或基金的资金流入与流出 | ★★★★ | 200 | Daily | Other |
| [ETHA Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_ethavolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [FETH AUM timeseries](https://data.tbstat.com/dashboard/markets_structuredproducts_fethaumtimeseries_daily_other.json) | ETF 或基金管理资产规模 | ★★★★ | 200 | Daily | Other |
| [FETH Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_fethflows_daily_other.json) | ETF 或基金的资金流入与流出 | ★★★★ | 200 | Daily | Other |
| [FETH Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_fethvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [Hong Kong ETH Spot ETF Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_hongkongethspotetfflows_daily_other.json) | ETF 或基金的资金流入与流出 | ★★★★ | 200 | Daily | Other |
| [Hong Kong ETH Spot ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_hongkongethspotetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |

## ETF / solana-etfs（9 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [SOL Futures ETF Cumulative Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_solfuturesetfcumulativevolumes_daily_yahoofinance.json) | 从历史起点累积的成交量，不是单日成交量 | ★★★ | 200 | Daily | Yahoo Finance |
| [SOL Futures ETF Market Share](https://data.tbstat.com/dashboard/markets_structuredproducts_solfuturesetfmarketshare_daily_yahoofinance.json) | 各组成部分在该指标中的占比 | ★★★ | 200 | Daily | Yahoo Finance |
| [SOL Futures ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_solfuturesetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [SOL Spot ETF AUM timeseries](https://data.tbstat.com/dashboard/markets_structuredproducts_solspotetfaumtimeseries_daily_other.json) | ETF 或基金管理资产规模 | ★★★ | 200 | Daily | Other |
| [SOL Spot ETF Cumulative Volumes USD](https://data.tbstat.com/dashboard/markets_structuredproducts_solspotetfcumulativevolumesusd_daily_yahoofinance.json) | 从历史起点累积的成交量，不是单日成交量 | ★★★ | 200 | Daily | Yahoo Finance |
| [SOL Spot ETF Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_solspotetfflows_daily_other.json) | ETF 或基金的资金流入与流出 | ★★★ | 200 | Daily | Other |
| [SOL Spot ETF Market Share](https://data.tbstat.com/dashboard/markets_structuredproducts_solspotetfmarketshare_daily_yahoofinance.json) | 各组成部分在该指标中的占比 | ★★★ | 200 | Daily | Yahoo Finance |
| [SOL Spot ETF Total Net Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_solspotetftotalnetflows_daily_other.json) | 现货 ETF 单日净流入合计，正值为净流入、负值为净流出 | ★★★★★ | 200 | Daily | Other |
| [SOL Spot ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_solspotetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |

## ETF / xrp-etfs（6 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [XRP Spot ETF AUM timeseries](https://data.tbstat.com/dashboard/markets_structuredproducts_xrpspotetfaumtimeseries_daily_other.json) | ETF 或基金管理资产规模 | ★★★ | 200 | Daily | Other |
| [XRP Spot ETF Cumulative Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_xrpspotetfcumulativevolumes_daily_yahoofinance.json) | 从历史起点累积的成交量，不是单日成交量 | ★★★ | 200 | Daily | Yahoo Finance |
| [XRP Spot ETF Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_xrpspotetfflows_daily_other.json) | ETF 或基金的资金流入与流出 | ★★★ | 200 | Daily | Other |
| [XRP Spot ETF Market Share](https://data.tbstat.com/dashboard/markets_structuredproducts_xrpspotetfmarketshare_daily_yahoofinance.json) | 各组成部分在该指标中的占比 | ★★★ | 200 | Daily | Yahoo Finance |
| [XRP Spot ETF Total Net Flows](https://data.tbstat.com/dashboard/markets_structuredproducts_xrpspotetftotalnetflows_daily_other.json) | 现货 ETF 单日净流入合计，正值为净流入、负值为净流出 | ★★★★★ | 200 | Daily | Other |
| [XRP Spot ETF Volumes](https://data.tbstat.com/dashboard/markets_structuredproducts_xrpspotetfvolumes_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |

## NFT / marketplaces（6 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Marketplace Fees](https://data.tbstat.com/dashboard/nfts_marketplaces_marketplacefees_monthly_other.json) | 协议、平台或市场收取的手续费 | ★ | 200 | Monthly | Other |
| [Marketplace Revenue](https://data.tbstat.com/dashboard/nfts_marketplaces_marketplacerevenue_monthly_other.json) | 公司、协议或平台收入及其分组分布 | ★ | 200 | Monthly | Other |
| [Monthly Unique Ethereum NFT Traders](https://data.tbstat.com/dashboard/nfts_marketplaces_monthlyuniqueethereumnfttraders_monthly_other.json) | 参与交易的用户或地址数量 | ★ | 200 | Monthly | Other |
| [NFT Marketplace Aggregators Daily Volume](https://data.tbstat.com/dashboard/nfts_marketplaces_nftmarketplaceaggregatorsdailyvolume_daily_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★ | 200 | Daily | Other |
| [NFT Marketplace Monthly Volume](https://data.tbstat.com/dashboard/nfts_marketplaces_nftmarketplacemonthlyvolume_monthly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★ | 200 | Monthly | Other |
| [Share of NFT Marketplace Volume](https://data.tbstat.com/dashboard/nfts_marketplaces_shareofnftmarketplacevolume_weekly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★ | 200 | Weekly | Other |

## NFT / nft-overview（1 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Trade Volume of NFTs by Chain](https://data.tbstat.com/dashboard/nfts_overview_tradevolumeofnftsbychain_weekly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★ | 200 | Weekly | Other |

## 交易市场 / cme-cots（12 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Large open interest holders of CME Bitcoin futures](https://data.tbstat.com/dashboard/markets_futures_largeopeninterestholdersofcmebitcoinfutures_weekly_cftccot.json) | 未平仓合约的规模或分组分布 | ★★★ | 200 | Weekly | CFTC COT |
| [Large open interest holders of CME Ethereum futures](https://data.tbstat.com/dashboard/markets_futures_largeopeninterestholdersofcmeethereumfutures_weekly_cftccot.json) | 未平仓合约的规模或分组分布 | ★★★ | 200 | Weekly | CFTC COT |
| [Large open interest holders of CME Micro Bitcoin futures](https://data.tbstat.com/dashboard/markets_futures_largeopeninterestholdersofcmemicrobitcoinfutures_weekly_cftccot.json) | 未平仓合约的规模或分组分布 | ★★★ | 200 | Weekly | CFTC COT |
| [Net positions of CME Bitcoin futures by trader category](https://data.tbstat.com/dashboard/markets_futures_netpositionsofcmebitcoinfuturesbytradercategory_weekly_cftccot.json) | 按交易者类别划分的多空净持仓 | ★★ | 200 | Weekly | CFTC COT |
| [Net positions of CME Ethereum futures by trader category](https://data.tbstat.com/dashboard/markets_futures_netpositionsofcmeethereumfuturesbytradercategory_weekly_cftccot.json) | 按交易者类别划分的多空净持仓 | ★★ | 200 | Weekly | CFTC COT |
| [Net positions of CME Micro Bitcoin futures by trader category](https://data.tbstat.com/dashboard/markets_futures_netpositionsofcmemicrobitcoinfuturesbytradercategory_weekly_cftccot.json) | 按交易者类别划分的多空净持仓 | ★★ | 200 | Weekly | CFTC COT |
| [Open interest of CME Bitcoin futures by trader category](https://data.tbstat.com/dashboard/markets_futures_openinterestofcmebitcoinfuturesbytradercategory_weekly_cftccot.json) | 未平仓合约的规模或分组分布 | ★★★ | 200 | Weekly | CFTC COT |
| [Open interest of CME Ethereum futures by trader category](https://data.tbstat.com/dashboard/markets_futures_openinterestofcmeethereumfuturesbytradercategory_weekly_cftccot.json) | 未平仓合约的规模或分组分布 | ★★★ | 200 | Weekly | CFTC COT |
| [Open interest of CME Micro Bitcoin futures by trader category](https://data.tbstat.com/dashboard/markets_futures_openinterestofcmemicrobitcoinfuturesbytradercategory_weekly_cftccot.json) | 未平仓合约的规模或分组分布 | ★★★ | 200 | Weekly | CFTC COT |
| [Open short interest of CME Bitcoin futures by trader category](https://data.tbstat.com/dashboard/markets_futures_openshortinterestofcmebitcoinfuturesbytradercategory_weekly_cftccot.json) | 按交易者类别划分的空头未平仓规模 | ★★ | 200 | Weekly | CFTC COT |
| [Open short interest of CME Ethereum futures by trader category](https://data.tbstat.com/dashboard/markets_futures_openshortinterestofcmeethereumfuturesbytradercategory_weekly_cftccot.json) | 按交易者类别划分的空头未平仓规模 | ★★ | 200 | Weekly | CFTC COT |
| [Open short interest of CME Micro Bitcoin futures by trader category](https://data.tbstat.com/dashboard/markets_futures_openshortinterestofcmemicrobitcoinfuturesbytradercategory_weekly_cftccot.json) | 按交易者类别划分的空头未平仓规模 | ★★ | 200 | Weekly | CFTC COT |

## 交易市场 / crypto-indices（16 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [GMCI AI Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmciaiprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI DEFI Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmcidefiprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI DePIN Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmcidepinprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI Ethereum Ecosystem Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmciethereumecosystemprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI Gaming Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmcigamingprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI Indices Comparison](https://data.tbstat.com/dashboard/markets_gmciindices_gmciindicescomparison_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI LONE Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmciloneprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI LTWO Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmciltwoprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI MEME Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmcimemeprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI Mid Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmcimidprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI Small Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmcismallprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI Solana Ecosystem Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmcisolanaecosystemprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI Solana Memes Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmcisolanamemesprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI Solana ex Memes Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmcisolanaexmemesprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI USA Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmciusaprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |
| [GMCI30 Price](https://data.tbstat.com/dashboard/markets_gmciindices_gmciprice_daily_other.json) | GMCI 加密资产主题指数的价格或相对表现 | ★★ | 200 | Daily | Other |

## 交易市场 / futures（9 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [BTC Liquidations](https://data.tbstat.com/dashboard/markets_futures_btcliquidations_daily_coinglass.json) | 被强制平仓的规模或数量，具体方向和周期见指标名 | ★★★★ | 200 | Daily | coinglass |
| [Long liquidations by exchanges](https://data.tbstat.com/dashboard/markets_futures_longliquidationsbyexchanges_daily_coinglass.json) | 多头仓位的日清算金额；The Block 该图以 UTC 16:00 为日界 | ★★★★★ | 200 | Daily | coinglass |
| [Number of liquidations by exchanges](https://data.tbstat.com/dashboard/markets_futures_numberofliquidationsbyexchanges_daily_coinglass.json) | 按交易所统计的强制平仓事件数量 | ★★★★ | 200 | Daily | coinglass |
| [Short liquidations by exchanges](https://data.tbstat.com/dashboard/markets_futures_shortliquidationsbyexchanges_daily_coinglass.json) | 空头仓位的日清算金额；图表负号表示方向，展示金额可取绝对值 | ★★★★★ | 200 | Daily | coinglass |
| [Top Bitcoin Futures OI](https://data.tbstat.com/dashboard/markets_futures_topbitcoinfuturesoi_daily_other.json) | 主要交易所 BTC 期货持仓量，非全市场总量 | ★★★★★ | 200 | Daily | Other |
| [Top Ether Futures OI](https://data.tbstat.com/dashboard/markets_futures_topetherfuturesoi_daily_other.json) | 主要交易所 ETH 期货持仓量，非全市场总量 | ★★★★★ | 200 | Daily | Other |
| [Volume of CME Bitcoin Futures](https://data.tbstat.com/dashboard/markets_futures_volumeofcmebitcoinfutures_monthly_coinglass.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Monthly | coinglass |
| [Volume of CME Ethereum Futures](https://data.tbstat.com/dashboard/markets_futures_volumeofcmeethereumfutures_monthly_coinglass.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Monthly | coinglass |
| [Volume of CME Solana Futures](https://data.tbstat.com/dashboard/markets_futures_volumeofcmesolanafutures_monthly_coinglass.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Monthly | coinglass |

## 交易市场 / options（14 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [BTC DVol Variance Premium](https://data.tbstat.com/dashboard/markets_options_btcdvolvariancepremium_daily_other.json) | 隐含方差与已实现方差之间的差额 | ★★★ | 200 | Daily | Other |
| [BTC DVol Vol of  Vol](https://data.tbstat.com/dashboard/markets_options_btcdvolvolofvol_daily_other.json) | 隐含波动率指数自身的波动程度 | ★★★ | 200 | Daily | Other |
| [BTC DVol vs Spot Price](https://data.tbstat.com/dashboard/markets_options_btcdvolvsspotprice_daily_other.json) | 隐含波动率指数与现货价格对照 | ★★★★ | 200 | Daily | Other |
| [BTC Five Delta Option Skew](https://data.tbstat.com/dashboard/markets_options_btcfivedeltaoptionskew_daily_other.json) | 不同方向期权隐含波动率之差，用于观察风险偏好 | ★★★ | 200 | Daily | Other |
| [BTC Put Call Ratio](https://data.tbstat.com/dashboard/markets_options_btcputcallratio_daily_amberdata.json) | 看跌期权与看涨期权的比率 | ★★★★ | 200 | Daily | Amberdata |
| [BTC Twenty Five Delta Option Skew](https://data.tbstat.com/dashboard/markets_options_btctwentyfivedeltaoptionskew_daily_other.json) | 不同方向期权隐含波动率之差，用于观察风险偏好 | ★★★ | 200 | Daily | Other |
| [ETH DVol Variance Premium](https://data.tbstat.com/dashboard/markets_options_ethdvolvariancepremium_daily_other.json) | 隐含方差与已实现方差之间的差额 | ★★★ | 200 | Daily | Other |
| [ETH DVol Vol of  Vol](https://data.tbstat.com/dashboard/markets_options_ethdvolvolofvol_daily_other.json) | 隐含波动率指数自身的波动程度 | ★★★ | 200 | Daily | Other |
| [ETH DVol vs Spot Price](https://data.tbstat.com/dashboard/markets_options_ethdvolvsspotprice_daily_other.json) | 隐含波动率指数与现货价格对照 | ★★★★ | 200 | Daily | Other |
| [ETH Five DeltaOption Skew](https://data.tbstat.com/dashboard/markets_options_ethfivedeltaoptionskew_daily_other.json) | 不同方向期权隐含波动率之差，用于观察风险偏好 | ★★★ | 200 | Daily | Other |
| [ETH Put Call Ratio](https://data.tbstat.com/dashboard/markets_options_ethputcallratio_daily_amberdata.json) | 看跌期权与看涨期权的比率 | ★★★★ | 200 | Daily | Amberdata |
| [ETH Twenty Five Delta Option Skew](https://data.tbstat.com/dashboard/markets_options_ethtwentyfivedeltaoptionskew_daily_other.json) | 不同方向期权隐含波动率之差，用于观察风险偏好 | ★★★ | 200 | Daily | Other |
| [Volume of CME Bitcoin Options](https://data.tbstat.com/dashboard/markets_options_volumeofcmebitcoinoptions_monthly_coinglass.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Monthly | coinglass |
| [Volume of CME Ethereum Options](https://data.tbstat.com/dashboard/markets_options_volumeofcmeethereumoptions_monthly_coinglass.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Monthly | coinglass |

## 交易市场 / prices（24 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [BTC Price Correlation](https://data.tbstat.com/dashboard/markets_prices_btcpricecorrelation_daily_yahoofinance.json) | 资产价格或收益率之间的相关性 | ★★★★ | 200 | Daily | Yahoo Finance |
| [BVCORR Index](https://data.tbstat.com/dashboard/markets_prices_bvcorrindex_daily_other.json) | 比特币相关波动率或相关性指数，具体定义需核对来源 | ★★ | 200 | Daily | Other |
| [BVIV Index](https://data.tbstat.com/dashboard/markets_prices_bvivindex_daily_other.json) | 比特币隐含波动率指数 | ★★★ | 200 | Daily | Other |
| [Bitcoin Market Cap](https://data.tbstat.com/dashboard/markets_prices_bitcoinmarketcap_daily_coingecko.json) | 资产、板块或公司的市值及其分组分布 | ★★★★ | 200 | Daily | Coingecko |
| [Bitcoin Market Dominance](https://data.tbstat.com/dashboard/markets_prices_bitcoinmarketdominance_daily_coinstats.json) | 该资产或板块在相关市场中的份额 | ★★★★★ | 200 | Daily | CoinStats |
| [Bitcoin vs Defi (one day)](https://data.tbstat.com/dashboard/markets_prices_bitcoinvsdefioneday_daily_coingecko.json) | BTC 与 DeFi 板块在指定时间窗口的对比，具体度量需核对原始字段 | ★★ | 200 | Daily | Coingecko |
| [Bitcoin vs Defi (one hour)](https://data.tbstat.com/dashboard/markets_prices_bitcoinvsdefionehour_daily_coingecko.json) | BTC 与 DeFi 板块在指定时间窗口的对比，具体度量需核对原始字段 | ★★ | 200 | Daily | Coingecko |
| [Bitcoin vs Defi (one month)](https://data.tbstat.com/dashboard/markets_prices_bitcoinvsdefionemonth_daily_coingecko.json) | BTC 与 DeFi 板块在指定时间窗口的对比，具体度量需核对原始字段 | ★★ | 200 | Daily | Coingecko |
| [Bitcoin vs Top 20 Marketcap (one day)](https://data.tbstat.com/dashboard/markets_prices_bitcoinvstopmarketcaponeday_daily_coingecko.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Coingecko |
| [Bitcoin vs Top 20 Marketcap (one hour)](https://data.tbstat.com/dashboard/markets_prices_bitcoinvstopmarketcaponehour_daily_coingecko.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Coingecko |
| [Bitcoin vs Top 20 Marketcap (one month)](https://data.tbstat.com/dashboard/markets_prices_bitcoinvstopmarketcaponemonth_daily_coingecko.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Coingecko |
| [Bitcoin vs Traditional Finance Market Cap Ratios](https://data.tbstat.com/dashboard/markets_prices_bitcoinvstraditionalfinancemarketcapratios_monthly_macrotrends.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Monthly | Macro Trends |
| [Crypto Stocks Marketcap in USD](https://data.tbstat.com/dashboard/markets_prices_cryptostocksmarketcapinusd_daily_macrotrends.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Macro Trends |
| [Crypto Stocks Return](https://data.tbstat.com/dashboard/markets_prices_cryptostocksreturn_daily_yahoofinance.json) | 股票或资产在指定区间的收益表现 | ★★ | 200 | Daily | Yahoo Finance |
| [Crypto Total Marketcap](https://data.tbstat.com/dashboard/markets_prices_cryptototalmarketcap_daily_coingecko.json) | 资产、板块或公司的市值及其分组分布 | ★★★★ | 200 | Daily | Coingecko |
| [DeFi Dominance](https://data.tbstat.com/dashboard/openfinance_assets_defidominance_daily_coingecko.json) | 该资产或板块在相关市场中的份额 | ★★ | 200 | Daily | Coingecko |
| [DeFi Token Marketcaps](https://data.tbstat.com/dashboard/markets_prices_defitokenmarketcaps_daily_coingecko.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Coingecko |
| [EVCORR Index](https://data.tbstat.com/dashboard/markets_prices_evcorrindex_daily_other.json) | 以太坊相关波动率或相关性指数，具体定义需核对来源 | ★★ | 200 | Daily | Other |
| [EVIV Index](https://data.tbstat.com/dashboard/markets_prices_evivindex_daily_other.json) | 以太坊隐含波动率指数 | ★★★ | 200 | Daily | Other |
| [Ether Market Cap](https://data.tbstat.com/dashboard/markets_prices_ethermarketcap_daily_coingecko.json) | 资产、板块或公司的市值及其分组分布 | ★★★★ | 200 | Daily | Coingecko |
| [Ethereum vs Bitcoin and Traditional Finance Market Cap Ratios](https://data.tbstat.com/dashboard/markets_prices_ethereumvsbitcoinandtraditionalfinancemarketcapratios_monthly_macrotrends.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Monthly | Macro Trends |
| [Fear and Greed Index](https://data.tbstat.com/dashboard/markets_prices_fearandgreedindex_daily_other.json) | 反映市场恐慌与贪婪程度的情绪指数 | ★★★★★ | 200 | Daily | Other |
| [Mining Stocks Marketcap](https://data.tbstat.com/dashboard/markets_prices_miningstocksmarketcap_daily_macrotrends.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Macro Trends |
| [Mining Stocks Return](https://data.tbstat.com/dashboard/markets_prices_miningstocksreturn_daily_yahoofinance.json) | 股票或资产在指定区间的收益表现 | ★★ | 200 | Daily | Yahoo Finance |

## 交易市场 / public-companies（17 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Circle Revenue](https://data.tbstat.com/dashboard/markets_publiccompanies_circlerevenue_quarterly_other.json) | 公司、协议或平台收入及其分组分布 | ★★ | 200 | Quarterly | Other |
| [Coinbase Assets Held](https://data.tbstat.com/dashboard/markets_publiccompanies_coinbaseassetsheld_quarterly_other.json) | 平台托管或持有的客户资产规模 | ★★ | 200 | Quarterly | Other |
| [Coinbase Gross Profit](https://data.tbstat.com/dashboard/markets_publiccompanies_coinbasegrossprofit_quarterly_other.json) | 公司毛利润 | ★★ | 200 | Quarterly | Other |
| [Coinbase Non Transaction Revenue](https://data.tbstat.com/dashboard/markets_publiccompanies_coinbasenontransactionrevenue_quarterly_other.json) | 公司、协议或平台收入及其分组分布 | ★★ | 200 | Quarterly | Other |
| [Coinbase Pre-IPO Stock Price](https://data.tbstat.com/dashboard/markets_publiccompanies_coinbasepreipostockprice_daily_other.json) | 相关资产、指数或股票的价格或价格对照 | ★★ | 200 | Daily | Other |
| [Coinbase Revenue](https://data.tbstat.com/dashboard/markets_publiccompanies_coinbaserevenue_quarterly_other.json) | 公司、协议或平台收入及其分组分布 | ★★ | 200 | Quarterly | Other |
| [Coinbase Total Volume](https://data.tbstat.com/dashboard/markets_publiccompanies_coinbasetotalvolume_quarterly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Quarterly | Other |
| [Coinbase Trade Volume Share by Asset](https://data.tbstat.com/dashboard/markets_publiccompanies_coinbasetradevolumesharebyasset_quarterly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Quarterly | Other |
| [Coinbase Transacting Users](https://data.tbstat.com/dashboard/markets_publiccompanies_coinbasetransactingusers_quarterly_other.json) | 发生交易的活跃用户数量 | ★★ | 200 | Quarterly | Other |
| [Coinbase Volume by Customer](https://data.tbstat.com/dashboard/markets_publiccompanies_coinbasevolumebycustomer_quarterly_other.json) | 按客户类型划分的平台成交量 | ★★★ | 200 | Quarterly | Other |
| [Coinbase vs Uniswap Market Cap](https://data.tbstat.com/dashboard/markets_publiccompanies_coinbasevsuniswapmarketcap_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Other |
| [Robinhood Crypto Volume](https://data.tbstat.com/dashboard/markets_publiccompanies_robinhoodcryptovolume_quarterly_other.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Quarterly | Other |
| [Robinhood Revenues](https://data.tbstat.com/dashboard/markets_publiccompanies_robinhoodrevenues_quarterly_other.json) | 公司、协议或平台收入及其分组分布 | ★★ | 200 | Quarterly | Other |
| [Strategy's Preferred Stocks Volumes USD](https://data.tbstat.com/dashboard/markets_publiccompanies_strategyspreferredstocksvolumesusd_daily_yahoofinance.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Daily | Yahoo Finance |
| [Top Crypto Categories by Daily Revenue](https://data.tbstat.com/dashboard/onchainmetrics_revenue_topcryptocategoriesbydailyrevenue_daily_defillama.json) | 公司、协议或平台收入及其分组分布 | ★★ | 200 | Daily | DefiLlama |
| [Top Crypto Categories by Daily Revenue (Market Share)](https://data.tbstat.com/dashboard/onchainmetrics_revenue_topcryptocategoriesbydailyrevenuemarketshare_daily_defillama.json) | 各组成部分在该指标中的占比 | ★★ | 200 | Daily | DefiLlama |
| [Top Protocols by Revenue](https://data.tbstat.com/dashboard/onchainmetrics_revenue_topprotocolsbyrevenue_daily_defillama.json) | 公司、协议或平台收入及其分组分布 | ★★ | 200 | Daily | DefiLlama |

## 交易市场 / spot（1 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [South America Based Exchange Volume](https://data.tbstat.com/dashboard/markets_spot_southamericabasedexchangevolume_monthly_cryptocompare.json) | 成交量及其分组分布，计价单位和时间周期需查看原始字段 | ★★★ | 200 | Monthly | Cryptocompare |

## 企业储备 / bitcoin-treasuries（14 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [BTC Spot ETF Total Daily Flows and BTC Price (USD)](https://data.tbstat.com/dashboard/markets_structuredproducts_btcspotetftotaldailyflowsandbtcpriceusd_daily_other.json) | ETF 单日资金流与币价的对照 | ★★★ | 200 | Daily | Other |
| [Bitcoin Holdings in Public Companies Treasuries vs Market Cap of Public Companies Holding BTC](https://data.tbstat.com/dashboard/markets_cryptotreasuries_bitcoinholdingsinpubliccompaniestreasuriesvsmarketcapofpubliccompaniesholdingbtc_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Bitcoin Treasuries](https://data.tbstat.com/dashboard/markets_publiccompanies_bitcointreasuries_daily_coingecko.json) | 企业金库持有的加密资产规模 | ★★★ | 200 | Daily | Coingecko |
| [Bitcoin Treasuries (excluding Strategy)](https://data.tbstat.com/dashboard/markets_publiccompanies_bitcointreasuriesexcludingstrategy_daily_coingecko.json) | 企业金库持有的加密资产规模 | ★★★ | 200 | Daily | Coingecko |
| [Bitcoin Treasury Holdings (USD) vs Cumulative Market Cap of Public Companies Holding BTC](https://data.tbstat.com/dashboard/markets_cryptotreasuries_bitcointreasuryholdingsusdvscumulativemarketcapofpubliccompaniesholdingbtc_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Cumulative Bitcoin Treasury Holdings (Public Companies) vs Bitcoin Price](https://data.tbstat.com/dashboard/markets_cryptotreasuries_cumulativebitcointreasuryholdingspubliccompaniesvsbitcoinprice_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Cumulative Bitcoin Treasury Holdings By Public Companies](https://data.tbstat.com/dashboard/markets_cryptotreasuries_cumulativebitcointreasuryholdingsbypubliccompanies_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Cumulative Market Cap of Public Companies Holding Bitcoin (Excluding Tesla)](https://data.tbstat.com/dashboard/markets_marketcap_cumulativemarketcapofpubliccompaniesholdingbitcoinexcludingtesla_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★★ | 200 | Daily | Other |
| [Cumulative Market Cap of Public Companies Holding Bitcoin (Line)](https://data.tbstat.com/dashboard/markets_marketcap_cumulativemarketcapofpubliccompaniesholdingbitcoinline_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★★ | 200 | Daily | Other |
| [Market Cap of Public Companies Holding Bitcoin (Excl. Tesla)](https://data.tbstat.com/dashboard/markets_marketcap_marketcapofpubliccompaniesholdingbitcoinexcltesla_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★★ | 200 | Daily | Other |
| [Microstrategy Bitcoins](https://data.tbstat.com/dashboard/markets_publiccompanies_microstrategybitcoins_daily_other.json) | Strategy（原 MicroStrategy）持有的 BTC 数量 | ★★★ | 200 | Daily | Other |
| [Premium/Discount to NAV \u2014 Strategy](https://data.tbstat.com/dashboard/markets_cryptotreasuries_premiumdiscounttonavstrategy_daily_other.json) | 资产或公司的市值相对资产净值的溢价与折价 | ★★★ | 200 | Daily | Other |
| [Premium/Discount to NAV by Company (top 10 BTC treasury holders)](https://data.tbstat.com/dashboard/markets_cryptotreasuries_premiumdiscounttonavbycompanytopbtctreasuryholders_daily_other.json) | 资产或公司的市值相对资产净值的溢价与折价 | ★★★ | 200 | Daily | Other |
| [Strategy (MSTR) Bitcoin Holdings vs Stock Price](https://data.tbstat.com/dashboard/markets_cryptotreasuries_strategymstrbitcoinholdingsvsstockprice_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |

## 企业储备 / crypto-treasuries（13 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Cumulative HYPE Holdings by Public Companies](https://data.tbstat.com/dashboard/markets_cryptotreasuries_cumulativehypeholdingsbypubliccompanies_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★ | 200 | Daily | Other |
| [Cumulative HYPE Holdings by Public Companies (USD)](https://data.tbstat.com/dashboard/markets_cryptotreasuries_cumulativehypeholdingsbypubliccompaniesusd_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★ | 200 | Daily | Other |
| [Cumulative Market Cap of Public Companies Holding Crypto (Comparing Per Asset)](https://data.tbstat.com/dashboard/markets_marketcap_cumulativemarketcapofpubliccompaniesholdingcryptocomparingperasset_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Other |
| [Cumulative Market Cap of Public Companies Holding HYPE in USD](https://data.tbstat.com/dashboard/markets_marketcap_cumulativemarketcapofpubliccompaniesholdinghypeinusd_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Other |
| [HYPE Holdings by Public Companies and HYPE Price (USD)](https://data.tbstat.com/dashboard/markets_cryptotreasuries_hypeholdingsbypubliccompaniesandhypepriceusd_daily_yahoofinance.json) | 企业或机构持有的加密资产数量或价值 | ★★ | 200 | Daily | Yahoo Finance |
| [Market Cap of Public Companies Holding Crypto (Cumulative)](https://data.tbstat.com/dashboard/markets_marketcap_marketcapofpubliccompaniesholdingcryptocumulative_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Other |
| [Market Cap of Public Companies Holding Crypto (USD) (Line)](https://data.tbstat.com/dashboard/markets_marketcap_marketcapofpubliccompaniesholdingcryptousdline_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★ | 200 | Daily | Other |
| [Market Cap of Public Companies Holding Crypto (USD) (Line) - Excluding Strategy](https://data.tbstat.com/dashboard/markets_marketcap_marketcapofpubliccompaniesholdingcryptousdlineexcludingstrategy_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★★ | 200 | Daily | Other |
| [Stacked Crypto Holdings by Public Companies in USD (BTC, ETH, SOL, HYPE)](https://data.tbstat.com/dashboard/markets_cryptotreasuries_stackedcryptoholdingsbypubliccompaniesinusdbtcethsolhype_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Stacked HYPE Holdings by Public Companies](https://data.tbstat.com/dashboard/markets_cryptotreasuries_stackedhypeholdingsbypubliccompanies_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★ | 200 | Daily | Other |
| [Stacked HYPE Holdings by Public Companies in USD](https://data.tbstat.com/dashboard/markets_cryptotreasuries_stackedhypeholdingsbypubliccompaniesinusd_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★ | 200 | Daily | Other |
| [Top Companies by Crypto Holdings USD (Excluding Strategy)](https://data.tbstat.com/dashboard/markets_cryptotreasuries_topcompaniesbycryptoholdingsusdexcludingstrategy_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Top Companies by Crypto Holdings USD (Including Strategy)](https://data.tbstat.com/dashboard/markets_cryptotreasuries_topcompaniesbycryptoholdingsusdincludingstrategy_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |

## 企业储备 / ethereum-treasuries（11 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Cumulative ETH Holdings by Bitmine](https://data.tbstat.com/dashboard/markets_cryptotreasuries_cumulativeethholdingsbybitmine_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Cumulative ETH Holdings by Bitmine (USD)](https://data.tbstat.com/dashboard/markets_cryptotreasuries_cumulativeethholdingsbybitmineusd_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Cumulative ETH Holdings by Public Companies](https://data.tbstat.com/dashboard/markets_cryptotreasuries_cumulativeethholdingsbypubliccompanies_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Cumulative ETH Holdings by Public Companies (USD)](https://data.tbstat.com/dashboard/markets_cryptotreasuries_cumulativeethholdingsbypubliccompaniesusd_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Cumulative Market Cap of Public Companies Holding ETH (USD)](https://data.tbstat.com/dashboard/markets_marketcap_cumulativemarketcapofpubliccompaniesholdingethusd_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★★ | 200 | Daily | Other |
| [Daily Buyings by Bitmine (in ETH)](https://data.tbstat.com/dashboard/markets_cryptotreasuries_dailybuyingsbybitmineineth_daily_other.json) | 指定机构的资产购买量 | ★★★ | 200 | Daily | Other |
| [ETH Holdings in Public Companies](https://data.tbstat.com/dashboard/markets_publiccompanies_ethholdingsinpubliccompanies_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Premium/Discount to NAV by Ethereum Holding Company](https://data.tbstat.com/dashboard/markets_cryptotreasuries_premiumdiscounttonavbyethereumholdingcompany_daily_other.json) | 资产或公司的市值相对资产净值的溢价与折价 | ★★★ | 200 | Daily | Other |
| [Stacked ETH Holdings by Public Companies](https://data.tbstat.com/dashboard/markets_cryptotreasuries_stackedethholdingsbypubliccompanies_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Stacked ETH Holdings by Public Companies in USD](https://data.tbstat.com/dashboard/markets_cryptotreasuries_stackedethholdingsbypubliccompaniesinusd_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★★ | 200 | Daily | Other |
| [Total Market Cap of Public Companies Holding ETH (USD)](https://data.tbstat.com/dashboard/markets_cryptotreasuries_totalmarketcapofpubliccompaniesholdingethusd_daily_other.json) | 资产、板块或公司的市值及其分组分布 | ★★★★ | 200 | Daily | Other |

## 企业储备 / solana-treasuries（7 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Cumulative SOL Holdings by Public Companies](https://data.tbstat.com/dashboard/markets_cryptotreasuries_cumulativesolholdingsbypubliccompanies_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★ | 200 | Daily | Other |
| [Cumulative SOL Holdings by Public Companies (USD)](https://data.tbstat.com/dashboard/markets_cryptotreasuries_cumulativesolholdingsbypubliccompaniesusd_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★ | 200 | Daily | Other |
| [Market Cap (Cumulative) of Public Companies Holding SOL](https://data.tbstat.com/dashboard/markets_cryptotreasuries_marketcapcumulativeofpubliccompaniesholdingsol_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★ | 200 | Daily | Other |
| [Market Cap of Public Companies Holding SOL (Final Stacked)](https://data.tbstat.com/dashboard/markets_cryptotreasuries_marketcapofpubliccompaniesholdingsolfinalstacked_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★ | 200 | Daily | Other |
| [Premium/Discount to NAV by SOL Holding Companies](https://data.tbstat.com/dashboard/markets_cryptotreasuries_premiumdiscounttonavbysolholdingcompanies_daily_other.json) | 资产或公司的市值相对资产净值的溢价与折价 | ★★ | 200 | Daily | Other |
| [Stacked SOL Holdings by Public Companies](https://data.tbstat.com/dashboard/markets_cryptotreasuries_stackedsolholdingsbypubliccompanies_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★ | 200 | Daily | Other |
| [Stacked SOL Holdings by Public Companies in USD](https://data.tbstat.com/dashboard/markets_cryptotreasuries_stackedsolholdingsbypubliccompaniesinusd_daily_other.json) | 企业或机构持有的加密资产数量或价值 | ★★ | 200 | Daily | Other |

## 另类指标 / crypto-funding（10 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Monthly Deals Count by Stage](https://data.tbstat.com/dashboard/alternativemetrics_funding_monthlydealscountbystage_monthly_other.json) | 融资交易笔数及其分组占比 | ★★ | 200 | Monthly | Other |
| [Monthly Share of Deals Count by Category](https://data.tbstat.com/dashboard/alternativemetrics_funding_monthlyshareofdealscountbycategory_monthly_other.json) | 融资交易笔数及其分组占比 | ★★ | 200 | Monthly | Other |
| [Monthly Venture Deals Count by Category](https://data.tbstat.com/dashboard/alternativemetrics_funding_monthlyventuredealscountbycategory_monthly_other.json) | 加密行业风险投资交易笔数 | ★★ | 200 | Monthly | Other |
| [Monthly Venture Funding by Category](https://data.tbstat.com/dashboard/alternativemetrics_funding_monthlyventurefundingbycategory_monthly_other.json) | 加密行业风险投资融资金额，按类别或阶段统计 | ★★ | 200 | Monthly | Other |
| [Monthly Venture Funding by Stage](https://data.tbstat.com/dashboard/alternativemetrics_funding_monthlyventurefundingbystage_monthly_other.json) | 加密行业风险投资融资金额，按类别或阶段统计 | ★★ | 200 | Monthly | Other |
| [Quarterly Deals Count by Stage](https://data.tbstat.com/dashboard/alternativemetrics_funding_quarterlydealscountbystage_quarterly_other.json) | 融资交易笔数及其分组占比 | ★★ | 200 | Quarterly | Other |
| [Quarterly Share of Deals Count by Category](https://data.tbstat.com/dashboard/alternativemetrics_funding_quarterlyshareofdealscountbycategory_quarterly_other.json) | 融资交易笔数及其分组占比 | ★★ | 200 | Quarterly | Other |
| [Quarterly Venture Deals Count by Category](https://data.tbstat.com/dashboard/alternativemetrics_funding_quarterlyventuredealscountbycategory_quarterly_other.json) | 加密行业风险投资交易笔数 | ★★ | 200 | Quarterly | Other |
| [Quarterly Venture Funding by Category](https://data.tbstat.com/dashboard/alternativemetrics_funding_quarterlyventurefundingbycategory_quarterly_other.json) | 加密行业风险投资融资金额，按类别或阶段统计 | ★★ | 200 | Quarterly | Other |
| [Quarterly Venture Funding by Stage](https://data.tbstat.com/dashboard/alternativemetrics_funding_quarterlyventurefundingbystage_quarterly_other.json) | 加密行业风险投资融资金额，按类别或阶段统计 | ★★ | 200 | Quarterly | Other |

## 另类指标 / politics（6 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Crypto PAC Total Raised Cumulative](https://data.tbstat.com/dashboard/alternativemetrics_politics_cryptopactotalraisedcumulative_daily_other.json) | 政治行动委员会募集的资金规模 | ★ | 200 | Daily | Other |
| [Crypto PAC Total Raised by Cycle](https://data.tbstat.com/dashboard/alternativemetrics_politics_cryptopactotalraisedbycycle_daily_other.json) | 政治行动委员会募集的资金规模 | ★ | 200 | Daily | Other |
| [Crypto PAC Total Raised per Committee](https://data.tbstat.com/dashboard/alternativemetrics_politics_cryptopactotalraisedpercommittee_daily_other.json) | 政治行动委员会募集的资金规模 | ★ | 200 | Daily | Other |
| [Crypto PAC Total Spending Cumulative](https://data.tbstat.com/dashboard/alternativemetrics_politics_cryptopactotalspendingcumulative_daily_other.json) | 政治行动委员会支出金额 | ★ | 200 | Daily | Other |
| [Crypto PAC Total Spending by Cycle](https://data.tbstat.com/dashboard/alternativemetrics_politics_cryptopactotalspendingbycycle_daily_other.json) | 政治行动委员会支出金额 | ★ | 200 | Daily | Other |
| [Crypto PAC Total Spending per Committee](https://data.tbstat.com/dashboard/alternativemetrics_politics_cryptopactotalspendingpercommittee_daily_other.json) | 政治行动委员会支出金额 | ★ | 200 | Daily | Other |

## 另类指标 / social（5 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Bitcoin Wiki Page Views](https://data.tbstat.com/dashboard/alternativemetrics_social_bitcoinwikipageviews_daily_other.json) | 维基百科相关页面浏览次数 | ★ | 200 | Daily | Other |
| [New Crypto Subreddit Subscribers](https://data.tbstat.com/dashboard/alternativemetrics_social_newcryptosubredditsubscribers_weekly_other.json) | 相关频道或社区新增订阅用户数 | ★ | 200 | Weekly | Other |
| [New Weekly Youtube Subscribers](https://data.tbstat.com/dashboard/alternativemetrics_social_newweeklyyoutubesubscribers_weekly_other.json) | 相关频道或社区新增订阅用户数 | ★ | 200 | Weekly | Other |
| [New Weekly Youtube Views](https://data.tbstat.com/dashboard/alternativemetrics_social_newweeklyyoutubeviews_weekly_other.json) | 相关 YouTube 频道新增观看次数 | ★ | 200 | Weekly | Other |
| [Tweet Volume](https://data.tbstat.com/dashboard/alternativemetrics_social_tweetvolume_weekly_thetie.json) | 相关主题的推文数量 | ★ | 200 | Weekly | The TIE |

## 另类指标 / web-traffic（15 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Blockchain-related Mentions in SEC Filings](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_blockchainrelatedmentionsinsecfilings_monthly_other.json) | 美国 SEC 申报文件中相关关键词的提及次数 | ★ | 200 | Monthly | Other |
| [Search Volume for Bitcoin](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeforbitcoin_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★★ | 200 | Monthly | Google Trends |
| [Search Volume for Coinbase](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeforcoinbase_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★ | 200 | Monthly | Google Trends |
| [Search Volume for Ethereum](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeforethereum_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★★ | 200 | Monthly | Google Trends |
| [Search Volume for Kalshi](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeforkalshi_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★ | 200 | Monthly | Google Trends |
| [Search Volume for Memecoin](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeformemecoin_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★ | 200 | Monthly | Google Trends |
| [Search Volume for NFT](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumefornft_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★ | 200 | Monthly | Google Trends |
| [Search Volume for Onchain](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeforonchain_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★ | 200 | Monthly | Google Trends |
| [Search Volume for OpenSea](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeforopensea_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★ | 200 | Monthly | Google Trends |
| [Search Volume for Polymarket](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeforpolymarket_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★ | 200 | Monthly | Google Trends |
| [Search Volume for Prediction Markets](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeforpredictionmarkets_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★ | 200 | Monthly | Google Trends |
| [Search Volume for Relative](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeforrelative_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★ | 200 | Monthly | Google Trends |
| [Search Volume for Solana](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeforsolana_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★ | 200 | Monthly | Google Trends |
| [Search Volume for Uniswap](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeforuniswap_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★ | 200 | Monthly | Google Trends |
| [Search Volume for Web3](https://data.tbstat.com/dashboard/alternativemetrics_webtraffic_searchvolumeforweb_monthly_googletrends.json) | 相关关键词的搜索热度指数，不是美元成交量 | ★★ | 200 | Monthly | Google Trends |

## 稳定币 / non-fiat-pegged（1 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Total Gold-backed Stablecoin Supply](https://data.tbstat.com/dashboard/openfinance_stablecoins_totalgoldbackedstablecoinsupply_daily_other.json) | 稳定币供应量及其分组分布 | ★★★ | 200 | Daily | Other |

## 稳定币 / non-usd-pegged（4 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [EUR-pegged stablecoin circulating supply by asset (all chains)](https://data.tbstat.com/dashboard/openfinance_stablecoins_eurpeggedstablecoincirculatingsupplybyassetallchains_daily_defillama.json) | 稳定币流通供应量，按币种或链划分 | ★★★★ | 200 | Daily | defillama |
| [Non-USD pegged stablecoin supply](https://data.tbstat.com/dashboard/openfinance_stablecoins_nonusdpeggedstablecoinsupply_daily_defillama.json) | 稳定币供应量及其分组分布 | ★★★ | 200 | Daily | defillama |
| [Non-USD pegged stablecoin supply by chain](https://data.tbstat.com/dashboard/openfinance_stablecoins_nonusdpeggedstablecoinsupplybychain_daily_defillama.json) | 稳定币供应量及其分组分布 | ★★★ | 200 | Daily | defillama |
| [Share of Non-USD Stablecoin Supply by Peg Currency (all chains)](https://data.tbstat.com/dashboard/openfinance_stablecoins_shareofnonusdstablecoinsupplybypegcurrencyallchains_daily_defillama.json) | 稳定币供应量及其分组分布 | ★★★ | 200 | Daily | defillama |

## 稳定币 / usd-pegged（15 项）

| 指标 / JSON 地址 | 简单说明 | 推荐星级 | HTTP | 更新频率 | 原始来源 |
|---|---|---|---|---|---|
| [Crypto-backed and algorithmic stablecoin circulating supply by asset (all chains)](https://data.tbstat.com/dashboard/openfinance_stablecoins_cryptobackedandalgorithmicstablecoincirculatingsupplybyassetallchains_daily_defillama.json) | 稳定币流通供应量，按币种或链划分 | ★★★★ | 200 | Daily | defillama |
| [Fiat-backed stablecoin circulating supply by asset (all chains)](https://data.tbstat.com/dashboard/openfinance_stablecoins_fiatbackedstablecoincirculatingsupplybyassetallchains_daily_defillama.json) | 稳定币流通供应量，按币种或链划分 | ★★★★ | 200 | Daily | defillama |
| [Share of Stablecoin Supply by Peg Currency (all chains)](https://data.tbstat.com/dashboard/openfinance_stablecoins_shareofstablecoinsupplybypegcurrencyallchains_daily_defillama.json) | 稳定币供应量及其分组分布 | ★★★ | 200 | Daily | defillama |
| [Stablecoin Daily Transfer Volume by Coin](https://data.tbstat.com/dashboard/openfinance_stablecoins_stablecoindailytransfervolumebycoin_daily_artemis.json) | 链上资产转账规模，不等于交易所成交量 | ★★★★ | 200 | Daily | Artemis |
| [Stablecoin Daily Transfer Volume per Chain](https://data.tbstat.com/dashboard/openfinance_stablecoins_stablecoindailytransfervolumeperchain_daily_artemis.json) | 链上资产转账规模，不等于交易所成交量 | ★★★★ | 200 | Daily | Artemis |
| [Stablecoin Monthly Transfer Volume by Coin](https://data.tbstat.com/dashboard/openfinance_stablecoins_stablecoinmonthlytransfervolumebycoin_monthly_artemis.json) | 链上资产转账规模，不等于交易所成交量 | ★★★★ | 200 | Monthly | Artemis |
| [Stablecoin Monthly Transfer Volume per Chain](https://data.tbstat.com/dashboard/openfinance_stablecoins_stablecoinmonthlytransfervolumeperchain_monthly_artemis.json) | 链上资产转账规模，不等于交易所成交量 | ★★★★ | 200 | Monthly | Artemis |
| [Tether Supply by Blockchain](https://data.tbstat.com/dashboard/openfinance_stablecoins_tethersupplybyblockchain_daily_defillama.json) | 稳定币在各条公链的供应量 | ★★★★ | 200 | Daily | defillama |
| [Total Stablecoin Supply](https://data.tbstat.com/dashboard/openfinance_stablecoins_totalstablecoinsupply_daily_defillama.json) | 稳定币供应量及其分组分布 | ★★★★★ | 200 | Daily | defillama |
| [Total Stablecoin Supply Origins](https://data.tbstat.com/dashboard/openfinance_stablecoins_totalstablecoinsupplyorigins_daily_defillama.json) | 稳定币供应量及其分组分布 | ★★★★★ | 200 | Daily | defillama |
| [Total Stablecoin Supply Per Chain](https://data.tbstat.com/dashboard/openfinance_stablecoins_totalstablecoinsupplyperchain_daily_defillama.json) | 稳定币供应量及其分组分布 | ★★★★★ | 200 | Daily | defillama |
| [USD Yield-Bearing Stablecoin Token Market Cap](https://data.tbstat.com/dashboard/openfinance_stablecoins_usdyieldbearingstablecointokenmarketcap_daily_coingecko.json) | 生息型美元稳定币或代币的市值规模 | ★★★ | 200 | Daily | Coingecko |
| [USD-pegged stablecoin circulating supply on Solana](https://data.tbstat.com/dashboard/openfinance_stablecoins_usdpeggedstablecoincirculatingsupplyonsolana_daily_defillama.json) | 稳定币流通供应量，按币种或链划分 | ★★★★ | 200 | Daily | defillama |
| [USD-pegged stablecoin circulating supply on Tron](https://data.tbstat.com/dashboard/openfinance_stablecoins_usdpeggedstablecoincirculatingsupplyontron_daily_defillama.json) | 稳定币流通供应量，按币种或链划分 | ★★★★ | 200 | Daily | defillama |
| [USDC Supply by Blockchain](https://data.tbstat.com/dashboard/openfinance_stablecoins_usdcsupplybyblockchain_daily_defillama.json) | 稳定币在各条公链的供应量 | ★★★★ | 200 | Daily | defillama |

## 未能扫描的目录

- [/data/on-chain-metrics/aptos](https://www.theblock.co/data/on-chain-metrics/aptos)：HTTP Error 403: Forbidden
- [/data/on-chain-metrics/arc](https://www.theblock.co/data/on-chain-metrics/arc)：HTTP Error 403: Forbidden
- [/data/on-chain-metrics/avalanche](https://www.theblock.co/data/on-chain-metrics/avalanche)：HTTP Error 403: Forbidden
- [/data/on-chain-metrics/base](https://www.theblock.co/data/on-chain-metrics/base)：HTTP Error 403: Forbidden
- [/data/on-chain-metrics/bitcoin](https://www.theblock.co/data/on-chain-metrics/bitcoin)：HTTP Error 403: Forbidden
- [/data/on-chain-metrics/comparison-bitcoin-ethereum-solana](https://www.theblock.co/data/on-chain-metrics/comparison-bitcoin-ethereum-solana)：HTTP Error 403: Forbidden
- [/data/on-chain-metrics/crypto-ai](https://www.theblock.co/data/on-chain-metrics/crypto-ai)：HTTP Error 403: Forbidden
- [/data/on-chain-metrics/ethereum](https://www.theblock.co/data/on-chain-metrics/ethereum)：HTTP Error 403: Forbidden
- [/data/on-chain-metrics/hyperliquid](https://www.theblock.co/data/on-chain-metrics/hyperliquid)：HTTP Error 403: Forbidden
- [/data/on-chain-metrics/robinhood-chain](https://www.theblock.co/data/on-chain-metrics/robinhood-chain)：HTTP Error 403: Forbidden
- [/data/on-chain-metrics/solana](https://www.theblock.co/data/on-chain-metrics/solana)：HTTP Error 403: Forbidden
