// 策略管理 Pinia Store

import { defineStore } from 'pinia'
import type { Strategy, StrategyStatus, CreateStrategyInput, UpdateStrategyInput } from '../../types/strategy'

export interface StrategiesState {
  strategies: Strategy[]
  strategyStatuses: Record<string, StrategyStatus>
  loading: boolean
  error: string | null
  selectedStrategy: Strategy | null
  showEditor: boolean
  editingStrategy: Strategy | null
}

export const useStrategiesStore = defineStore('strategies', {
  state: (): StrategiesState => ({
    strategies: [],
    strategyStatuses: {},
    loading: false,
    error: null,
    selectedStrategy: null,
    showEditor: false,
    editingStrategy: null
  }),

  getters: {
    // 获取激活的策略
    activeStrategies: (state) => state.strategies.filter(s => s.isActive),

    // 获取运行中的策略
    runningStrategies: (state) => {
      return state.strategies.filter(s => {
        const status = state.strategyStatuses[s.id]
        return status && status.isRunning
      })
    },

    // 获取策略总数
    totalStrategies: (state) => state.strategies.length,

    // 获取选中策略
    getSelectedStrategy: (state) => state.selectedStrategy
  },

  actions: {
    // 加载策略列表
    async loadStrategies() {
      this.loading = true
      this.error = null

      try {
        const res = await $fetch<any>('/api/strategies')
        this.strategies = res.data || []
        
        // 更新状态
        if (res.statuses) {
          for (const status of res.statuses) {
            this.strategyStatuses[status.id] = status
          }
        }
      } catch (error: any) {
        this.error = error.message
        throw error
      } finally {
        this.loading = false
      }
    },

    // 创建策略
    async createStrategy(input: CreateStrategyInput) {
      this.loading = true
      this.error = null

      try {
        const res = await $fetch<any>('/api/strategies', {
          method: 'POST',
          body: input
        })

        // 添加到列表
        if (res.data) {
          this.strategies.push(res.data)
        }

        return res.data
      } catch (error: any) {
        this.error = error.message
        throw error
      } finally {
        this.loading = false
      }
    },

    // 更新策略
    async updateStrategy(strategyId: string, updates: UpdateStrategyInput, changes: string) {
      this.loading = true
      this.error = null

      try {
        const res = await $fetch<any>(`/api/strategies/${strategyId}`, {
          method: 'PUT',
          body: { updates, changes }
        })

        // 更新列表中的策略
        if (res.data) {
          const index = this.strategies.findIndex(s => s.id === strategyId)
          if (index !== -1) {
            this.strategies[index] = res.data
          }
        }

        return res.data
      } catch (error: any) {
        this.error = error.message
        throw error
      } finally {
        this.loading = false
      }
    },

    // 删除策略
    async deleteStrategy(strategyId: string) {
      this.loading = true
      this.error = null

      try {
        await $fetch(`/api/strategies/${strategyId}`, {
          method: 'DELETE'
        })

        // 从列表中移除
        this.strategies = this.strategies.filter(s => s.id !== strategyId)
        delete this.strategyStatuses[strategyId]
      } catch (error: any) {
        this.error = error.message
        throw error
      } finally {
        this.loading = false
      }
    },

    // 切换策略状态
    async toggleStrategy(strategyId: string, active: boolean) {
      this.loading = true
      this.error = null

      try {
        const res = await $fetch<any>(`/api/strategies/${strategyId}/toggle`, {
          method: 'POST',
          body: { active }
        })

        // 更新列表中的策略状态
        if (res.data) {
          const index = this.strategies.findIndex(s => s.id === strategyId)
          if (index !== -1) {
            this.strategies[index] = res.data
          }
        }

        return res.data
      } catch (error: any) {
        this.error = error.message
        throw error
      } finally {
        this.loading = false
      }
    },

    // 获取策略详情
    async getStrategy(strategyId: string) {
      this.loading = true
      this.error = null

      try {
        const res = await $fetch<any>(`/api/strategies/${strategyId}`)
        this.selectedStrategy = res.data
        return res.data
      } catch (error: any) {
        this.error = error.message
        throw error
      } finally {
        this.loading = false
      }
    },

    // 获取版本历史
    async getVersionHistory(strategyId: string) {
      this.loading = true
      this.error = null

      try {
        const res = await $fetch<any>(`/api/strategies/${strategyId}/versions`)
        return res.data
      } catch (error: any) {
        this.error = error.message
        throw error
      } finally {
        this.loading = false
      }
    },

    // 回滚策略版本
    async rollbackStrategy(strategyId: string, targetVersion: number) {
      this.loading = true
      this.error = null

      try {
        const res = await $fetch<any>(`/api/strategies/${strategyId}/rollback`, {
          method: 'POST',
          body: { targetVersion }
        })

        // 更新列表中的策略
        if (res.data) {
          const index = this.strategies.findIndex(s => s.id === strategyId)
          if (index !== -1) {
            this.strategies[index] = res.data
          }
        }

        return res.data
      } catch (error: any) {
        this.error = error.message
        throw error
      } finally {
        this.loading = false
      }
    },

    // 测试策略信号
    async testStrategySignal(strategyId: string, symbol: string) {
      this.loading = true
      this.error = null

      try {
        const res = await $fetch<any>(`/api/strategies/${strategyId}/test`, {
          method: 'POST',
          body: { symbol }
        })

        return res.data
      } catch (error: any) {
        this.error = error.message
        throw error
      } finally {
        this.loading = false
      }
    },

    // 显示编辑器
    showStrategyEditor(strategy?: Strategy | null) {
      this.editingStrategy = strategy || null
      this.showEditor = true
    },

    // 隐藏编辑器
    hideStrategyEditor() {
      this.showEditor = false
      this.editingStrategy = null
    },

    // 选择策略
    selectStrategy(strategy: Strategy | null) {
      this.selectedStrategy = strategy
    },

    // 刷新策略状态
    async refreshStrategyStatuses() {
      try {
        const res = await $fetch<any>('/api/strategies')
        if (res.statuses) {
          for (const status of res.statuses) {
            this.strategyStatuses[status.id] = status
          }
        }
      } catch (error: any) {
        console.error('刷新策略状态失败:', error)
      }
    },

    // 清除错误
    clearError() {
      this.error = null
    }
  }
})
