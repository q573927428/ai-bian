import type { NitroApp } from 'nitropack'
import { startDailyAnalysisScheduler, stopDailyAnalysisScheduler } from '../utils/trade-history-analyzer'

export default defineNitroPlugin((nitroApp: NitroApp) => {
  startDailyAnalysisScheduler()
  nitroApp.hooks.hook('close', () => {
    stopDailyAnalysisScheduler()
  })
})
