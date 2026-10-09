// 模型服务设置：与 LavaTranslate 一样按服务商分别保存 Key、接口地址、模型；Key 加密落盘，界面只拿到打码形式
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  DEFAULT_AI_SETTINGS,
  normalizeAiSettings,
  type AiProviderConfig,
  type AiSettings,
  type AiSettingsPatch,
  type ProviderId,
} from '@shared/ai'
import { encryptSecret, isMasked, maskSecret } from './secrets'

type Listener = (next: AiSettings, previous: AiSettings) => void

const EMPTY: AiProviderConfig = { key: '', baseUrl: '', model: '' }

export class AiSettingsStore {
  private data: AiSettings = { ...DEFAULT_AI_SETTINGS }
  private readonly file: string
  private readonly listeners = new Set<Listener>()

  constructor(dir: string) {
    this.file = join(dir, 'ai-settings.json')
  }

  load(): AiSettings {
    mkdirSync(join(this.file, '..'), { recursive: true })
    let changed = false
    if (existsSync(this.file)) {
      try {
        this.data = normalizeAiSettings(JSON.parse(readFileSync(this.file, 'utf8')))
      } catch {
        // 文件损坏：另存一份再用默认设置，里面的 Key 和登录还有机会找回，不被下一次保存悄悄覆盖
        try {
          copyFileSync(this.file, `${this.file}.broken-${Date.now()}`)
        } catch {
          // 忽略
        }
        this.data = { ...DEFAULT_AI_SETTINGS }
      }
      // 明文保存的 Key（手工写入）改为加密
      for (const [id, config] of Object.entries(this.data.providers)) {
        if (config?.key && config.key !== encryptSecret(config.key)) {
          this.data.providers[id as ProviderId] = { ...config, key: encryptSecret(config.key) }
          changed = true
        }
      }
    }
    if (!this.data.installId) {
      this.data = { ...this.data, installId: randomUUID() }
      changed = true
    }
    if (changed) this.write()
    return this.data
  }

  /** 先写临时文件再改名替换：写到一半被结束（安装更新、关机）时，原文件仍然完整 */
  private write(): void {
    const json = JSON.stringify(this.data, null, 2)
    const temp = `${this.file}.tmp`
    writeFileSync(temp, json, { flush: true })
    try {
      renameSync(temp, this.file)
    } catch {
      // 杀毒软件等临时占用文件时改名会失败：退回直接覆盖
      writeFileSync(this.file, json)
      rmSync(temp, { force: true })
    }
  }

  /** 给界面用：Key 打码 */
  public(): AiSettings {
    const providers: AiSettings['providers'] = {}
    for (const [id, config] of Object.entries(this.data.providers)) {
      if (config) providers[id as ProviderId] = { ...config, key: maskSecret(config.key) }
    }
    return { ...this.data, providers }
  }

  get(): AiSettings {
    return this.data
  }

  /** 当前服务（或指定服务）的配置，Key 仍是加密形式 */
  providerConfig(id: ProviderId = this.data.provider): AiProviderConfig {
    return { ...EMPTY, ...this.data.providers[id] }
  }

  /** providers 按服务商逐项合并；界面回传的打码 Key 表示未修改 */
  update(patch: AiSettingsPatch): AiSettings {
    const previous = this.data
    const providers = { ...previous.providers }
    for (const [id, change] of Object.entries(patch.providers ?? {})) {
      if (!change) continue
      const current = providers[id as ProviderId]
      const next: AiProviderConfig = { ...EMPTY, ...current, ...change }
      if (change.key !== undefined) next.key = isMasked(change.key) ? (current?.key ?? '') : encryptSecret(change.key.trim())
      if (change.baseUrl !== undefined) next.baseUrl = change.baseUrl.trim()
      providers[id as ProviderId] = next
    }
    const merged = normalizeAiSettings({
      ...previous,
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.translateTarget !== undefined ? { translateTarget: patch.translateTarget } : {}),
      providers,
    })
    this.data = merged
    this.write()
    for (const listener of this.listeners) listener(this.data, previous)
    return this.data
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
