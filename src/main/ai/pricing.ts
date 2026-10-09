// 模型价格：来自 models.dev（各家模型的公开价格库），联网获取后缓存 3 天；离线时用安装包内置的快照（与 LavaTranslate 同一份）
import { app, net } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiModelInfo } from '@shared/ai'
import { resourcePath } from '../app-paths'

/** [输入 $/百万 token, 输出 $/百万 token, 是否支持图片输入] */
type PriceEntry = [number, number, number]

const TTL = 3 * 24 * 3600 * 1000
const OFFICIAL = ['openai', 'anthropic', 'deepseek', 'zai', 'zhipuai', 'alibaba', 'moonshotai', 'google', 'xai', 'mistral', 'minimax']
/** 一次便签翻译大约的用量（提示词 + 一张便签的原文和译文） */
const TRANSLATE_INPUT_TOKENS = 700
const TRANSLATE_OUTPUT_TOKENS = 500

let table: Record<string, PriceEntry> | null = null
let refreshing: Promise<void> | null = null

function cacheFile(): string {
  return join(app.getPath('userData'), 'model-prices.json')
}

function load(): Record<string, PriceEntry> {
  if (table) return table
  for (const file of [cacheFile(), resourcePath('model-prices.json')]) {
    try {
      if (existsSync(file)) {
        table = JSON.parse(readFileSync(file, 'utf8')) as Record<string, PriceEntry>
        break
      }
    } catch {
      // 换下一个
    }
  }
  return (table ??= {})
}

interface ModelsDevModel {
  cost?: { input?: number; output?: number }
  modalities?: { input?: string[] }
}

/** 由 models.dev 原始数据生成精简表：官方渠道价格优先，否则取各渠道中位数 */
function compact(json: Record<string, { models?: Record<string, ModelsDevModel> }>): Record<string, PriceEntry> {
  const acc = new Map<string, { official: Array<[number, [number, number]]>; all: Array<[number, number]>; vision: boolean }>()
  for (const [provider, entry] of Object.entries(json)) {
    for (const [id, model] of Object.entries(entry.models ?? {})) {
      const cost = model.cost
      if (!cost || !((cost.input ?? 0) > 0 || (cost.output ?? 0) > 0)) continue
      const key = id.split('/').pop()!.toLowerCase()
      const item = acc.get(key) ?? { official: [], all: [], vision: false }
      const price: [number, number] = [cost.input ?? 0, cost.output ?? 0]
      if (OFFICIAL.includes(provider)) item.official.push([OFFICIAL.indexOf(provider), price])
      item.all.push(price)
      if (model.modalities?.input?.includes('image')) item.vision = true
      acc.set(key, item)
    }
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]
  const out: Record<string, PriceEntry> = {}
  for (const [key, item] of acc) {
    const pick = item.official.length
      ? item.official.sort((a, b) => a[0] - b[0])[0][1]
      : [median(item.all.map((price) => price[0])), median(item.all.map((price) => price[1]))]
    out[key] = [+pick[0].toFixed(4), +pick[1].toFixed(4), item.vision ? 1 : 0]
  }
  return out
}

/** 缓存过期则后台刷新 */
export function refreshPrices(): Promise<void> {
  load()
  const file = cacheFile()
  const fresh = existsSync(file) && Date.now() - statSync(file).mtimeMs < TTL
  if (fresh || refreshing) return refreshing ?? Promise.resolve()
  refreshing = (async () => {
    try {
      const response = await net.fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(20_000) })
      if (!response.ok) return
      const out = compact((await response.json()) as Record<string, { models?: Record<string, ModelsDevModel> }>)
      if (Object.keys(out).length > 100) {
        table = out
        writeFileSync(file, JSON.stringify(out))
      }
    } catch {
      // 离线：继续用旧表
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

function priceOf(id: string): AiModelInfo {
  const prices = load()
  const base = id.split('/').pop()!.toLowerCase()
  // 兼容带日期后缀、":free" 之类的变体名
  const entry = prices[base] ?? prices[base.replace(/[-_]\d{4}-?\d{2}-?\d{2}$/, '')] ?? prices[base.replace(/:.*$/, '')]
  if (!entry) return { id, input: null, output: null, perThousand: null }
  return {
    id,
    input: entry[0],
    output: entry[1],
    perThousand: (TRANSLATE_INPUT_TOKENS * entry[0] + TRANSLATE_OUTPUT_TOKENS * entry[1]) / 1000,
  }
}

/** 价格从低到高；没有价格信息的排在最后 */
export function sortByPrice(ids: string[]): AiModelInfo[] {
  return ids.map(priceOf).sort((a, b) => (a.perThousand ?? Infinity) - (b.perThousand ?? Infinity) || a.id.localeCompare(b.id))
}
