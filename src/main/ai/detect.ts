// 识别 API Key 属于哪家服务
import { net } from 'electron'
import { AMBIGUOUS_KEY_PROVIDERS, providerByKeyFormat, providerInfo, type KeyDetection, type ProviderId } from '@shared/ai'

/**
 * 先看格式（AIza → Gemini、sk-ant- → Claude…）；
 * sk- 开头的几家格式一样，就依次请求它们的模型列表，能通过的就是
 */
export async function detectProvider(key: string): Promise<KeyDetection> {
  const trimmed = key.trim()
  const byFormat = providerByKeyFormat(trimmed)
  if (byFormat) return { provider: byFormat, by: 'format' }
  // 哪家先通过就用哪家，不等其他几家（网络不通的那家要等到超时）
  const hit = await new Promise<ProviderId | null>((resolve) => {
    let left = AMBIGUOUS_KEY_PROVIDERS.length
    for (const id of AMBIGUOUS_KEY_PROVIDERS) {
      net.fetch(`${providerInfo(id).baseUrl}/models`, { headers: { authorization: `Bearer ${trimmed}` }, signal: AbortSignal.timeout(8000) })
        .then((response) => response.ok)
        .catch(() => false)
        .then((ok) => {
          if (ok) resolve(id)
          else if (--left === 0) resolve(null)
        })
    }
  })
  return hit ? { provider: hit, by: 'probe' } : { provider: null, tried: AMBIGUOUS_KEY_PROVIDERS }
}
