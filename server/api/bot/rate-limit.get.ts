import { binanceApiGateway } from '../../utils/binance-api-gateway'

export default defineEventHandler(async () => {
  return {
    success: true,
    data: binanceApiGateway.getStatus()
  }
})
