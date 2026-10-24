// ==================== 首页导航与受保护面板类型 ====================

/** 顶部导航可打开的行情与交易面板。 */
export type HomeNavigationTarget = 'indicators' | 'hot' | 'macro' | 'trends' | 'logs' | 'orders'

/** 必须先完成页面解锁才能打开的管理入口。 */
export type HomeProtectedPanel = 'config' | 'strategies' | 'orders'
