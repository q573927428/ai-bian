import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'

const execAsync = promisify(exec)

export default defineEventHandler(async (event) => {
  try {
    // 检查脚本文件是否存在
    const scriptPath = join(process.cwd(), 'test', 'generate-tv-script.js')
    if (!existsSync(scriptPath)) {
      return {
        success: false,
        message: '脚本文件不存在',
        error: `找不到文件: ${scriptPath}`
      }
    }

    // 检查输入数据文件是否存在
    const dataPath = join(process.cwd(), 'data', 'strategy-analysis.json')
    if (!existsSync(dataPath)) {
      return {
        success: false,
        message: '交易数据文件不存在',
        error: `找不到文件: ${dataPath}`
      }
    }

    // 执行脚本
    console.log(`正在执行脚本: ${scriptPath}`)
    const { stdout, stderr } = await execAsync(`node "${scriptPath}"`)

    if (stderr) {
      console.error('脚本执行错误:', stderr)
      return {
        success: false,
        message: '脚本执行失败',
        error: stderr,
        stdout: stdout
      }
    }

    // 检查输出文件是否生成
    const outputPath = join(process.cwd(), 'test', 'trade-history.pine')
    if (!existsSync(outputPath)) {
      return {
        success: false,
        message: '脚本执行完成但输出文件未生成',
        error: `找不到输出文件: ${outputPath}`,
        stdout: stdout
      }
    }

    console.log('脚本执行成功:', stdout)
    return {
      success: true,
      message: 'Pine脚本生成成功',
      stdout: stdout,
      outputPath: outputPath
    }

  } catch (error: any) {
    console.error('API执行错误:', error)
    return {
      success: false,
      message: '生成Pine脚本时发生错误',
      error: error.message || String(error)
    }
  }
})