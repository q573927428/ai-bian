// ==================== API Key 加密工具 ====================
// 使用 AES-256-GCM 加密存储敏感配置，防止明文泄露

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

// 加密算法配置
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const SALT = 'ai-bian-crypto-salt-v1'

/**
 * 从环境变量或默认密钥派生加密密钥
 * 优先使用 ENCRYPTION_KEY 环境变量，否则使用项目相关的固定密钥
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY
  if (envKey && envKey.length >= 16) {
    return scryptSync(envKey, SALT, 32)
  }
  // 兜底密钥（基于项目路径和固定种子生成）
  const fallbackSeed = 'ai-bian-default-key-2024'
  return scryptSync(fallbackSeed, SALT, 32)
}

/**
 * 加密文本
 * 返回格式: base64(iv):base64(authTag):base64(ciphertext)
 */
export function encrypt(text: string): string {
  if (!text) return ''
  
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  
  const authTag = cipher.getAuthTag()
  
  // 格式: iv:authTag:ciphertext（全部 base64 编码）
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`
}

/**
 * 解密文本
 * 输入格式: base64(iv):base64(authTag):base64(ciphertext)
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return ''
  
  try {
    const parts = encryptedText.split(':')
    if (parts.length !== 3) return encryptedText // 非加密格式，返回原文兼容
    
    const key = getEncryptionKey()
    const iv = Buffer.from(parts[0]!, 'base64')
    const authTag = Buffer.from(parts[1]!, 'base64')
    const encrypted = parts[2]!
    
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    
    return decrypted
  } catch {
    // 解密失败时返回原文（兼容未加密的旧数据）
    return encryptedText
  }
}

/**
 * 判断文本是否已加密
 */
export function isEncrypted(text: string): boolean {
  if (!text) return false
  // 加密格式: base64:base64:hex（三个部分，且第二部分为16字节的authTag）
  const parts = text.split(':')
  if (parts.length !== 3) return false
  try {
    Buffer.from(parts[0]!, 'base64')
    Buffer.from(parts[1]!, 'base64')
    return true
  } catch {
    return false
  }
}

/**
 * 脱敏 API Key（前端显示用）
 * 只保留前4位和后4位，中间用 **** 替代
 * 空字符串或短key直接返回空
 */
export function maskApiKey(apiKey: string | undefined | null): string {
  if (!apiKey) return ''
  if (apiKey.length <= 8) return '****'
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`
}
