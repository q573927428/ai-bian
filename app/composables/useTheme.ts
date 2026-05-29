// 主题切换 composable
import { ref, watch } from 'vue'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'app-theme'

// 全局单例状态
const theme = ref<Theme>('light')

export function useTheme() {
  // 初始化主题
  function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const initial = saved || (prefersDark ? 'dark' : 'light')
    setTheme(initial)
  }

  // 设置主题
  function setTheme(newTheme: Theme) {
    theme.value = newTheme
    localStorage.setItem(STORAGE_KEY, newTheme)
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  // 切换主题
  function toggleTheme() {
    setTheme(theme.value === 'light' ? 'dark' : 'light')
  }

  // 监听系统主题变化
  function listenSystemTheme() {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', (e) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setTheme(e.matches ? 'dark' : 'light')
      }
    })
  }

  return {
    theme,
    initTheme,
    setTheme,
    toggleTheme,
    listenSystemTheme,
  }
}