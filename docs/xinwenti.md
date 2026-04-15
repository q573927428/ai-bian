server\modules\kline-simple-sync\index.ts
获取数据同步用的是https://api.binance.com/api/v3/klines  现货的，我们是要用合约的，而且url += `&startTime=${startTime * 1000}` 这个应该不用乘以1000