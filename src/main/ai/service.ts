// 语言模型的入口：设置、ChatGPT 登录、模型列表、翻译、统计分析。便签正文只发给用户自己配置的服务，不写进日志。
import { join } from 'node:path'
import {
  languageOf,
  providerInfo,
  resolveTargetLanguage,
  type AiCredentialSource,
  type AiModelInfo,
  type AiSettings,
  type AiSettingsPatch,
  type AiStatus,
  type KeyDetection,
  type ProviderId,
} from '@shared/ai'
import {
  JsonObjectStream,
  TRANSLATE_INSTRUCTIONS,
  translateUserText,
  type TranslateEvent,
  type TranslateRequest,
  type TranslateResult,
} from '@shared/translate'
import {
  INSIGHT_INSTRUCTIONS,
  buildInsightUserText,
  insightKey,
  parseInsight,
  type InsightNoteInput,
  type InsightRecord,
  type InsightRunResult,
} from '@shared/insights'
import type { PeriodSummary, StatsGranularity } from '@shared/stats'
import { readJsonFile, writeJsonAtomic } from '../storage'
import { AiSettingsStore } from './settings'
import { AiError, LlmEngine } from './engine'
import { SignInExpired, cancelSignIn, listPlanModels, refresh as refreshChatGPT, signIn as signInChatGPT } from './chatgpt'
import { chatgptSession, findOpenAISources, resolveProvider } from './credentials'
import { detectProvider } from './detect'
import { refreshPrices, sortByPrice } from './pricing'

const INSIGHT_CACHE_LIMIT = 80

export interface AiServiceOptions {
  userData: string
  log: (event: string, data?: Record<string, unknown>) => void
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export class AiService {
  readonly settings: AiSettingsStore
  private engine: LlmEngine | null = null
  private engineKey = ''
  private readonly options: AiServiceOptions
  private readonly insightFile: string
  private insights: Record<string, InsightRecord> | null = null
  /**
   * 正在进行的刷新，同时发起的请求共用这一次：refresh token 每刷新一次就换新、旧的作废，
   * 两个请求各拿旧 token 刷新会被当成重复使用，OpenAI 可能因此吊销整个登录
   */
  private refreshing: Promise<string | null> | null = null

  constructor(options: AiServiceOptions) {
    this.options = options
    this.settings = new AiSettingsStore(options.userData)
    this.insightFile = join(options.userData, 'ai-insights.json')
  }

  load(): void {
    this.settings.load()
    this.settings.onChange(() => {
      this.engine = null
      this.engineKey = ''
    })
  }

  publicSettings(): AiSettings {
    return this.settings.public()
  }

  update(patch: AiSettingsPatch): AiSettings {
    this.settings.update(patch)
    return this.settings.public()
  }

  status(): AiStatus {
    const settings = this.settings.get()
    const info = providerInfo(settings.provider)
    const resolved = resolveProvider(settings)
    if (!resolved) {
      let detail = '还没有填写 API Key'
      if (info.id === 'chatgpt') detail = settings.providers.chatgpt?.expired ? 'ChatGPT 登录已过期，请重新登录' : '还没有登录 ChatGPT'
      else if (info.id === 'custom' && settings.providers.custom?.key) detail = '还没有填写接口地址'
      return { provider: info.id, ok: false, detail }
    }
    if (!resolved.model) return { provider: info.id, ok: false, detail: `${info.name} · 请选择模型` }
    let where = info.name
    if (info.id === 'custom' || settings.providers[info.id]?.baseUrl) where = hostOf(resolved.baseURL)
    if (info.id === 'chatgpt') where = `ChatGPT 会员 · ${settings.providers.chatgpt?.label || '已登录'}`
    return { provider: info.id, ok: true, detail: `${resolved.model} · ${where}` }
  }

  private currentEngine(): LlmEngine | null {
    const settings = this.settings.get()
    const resolved = resolveProvider(settings)
    if (!resolved || !resolved.model) return null
    const key = `${resolved.info.id}|${resolved.baseURL}|${resolved.model}|${resolved.apiKey.slice(-12)}`
    if (!this.engine || this.engineKey !== key) {
      this.engine = new LlmEngine({ baseURL: resolved.baseURL, apiKey: resolved.apiKey }, resolved.model, {
        api: resolved.info.api,
        chatExtra: resolved.info.chatExtra,
        timeout: 120_000,
      })
      this.engineKey = key
    }
    return this.engine
  }

  // ---- ChatGPT 登录 ----

  /**
   * 令牌快过期时先刷新再用；force 表示令牌被拒，不管有效期都刷新一次。
   * 返回 null 表示可以继续，否则是显示给用户的原因
   */
  private ensureFreshToken(id: ProviderId = this.settings.get().provider, force = false): Promise<string | null> {
    if (id !== 'chatgpt') return Promise.resolve(null)
    this.refreshing ??= this.refreshChatGPTToken(force).finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async refreshChatGPTToken(force: boolean): Promise<string | null> {
    const settings = this.settings.get()
    const session = chatgptSession(settings)
    if (!session) return null
    if (settings.providers.chatgpt?.expired) return 'ChatGPT 登录已过期，请在 AI 配置里重新登录'
    if (!force && session.expiresAt - Date.now() > 120_000) return null
    // 刷新期间重新登录或退出了：结果属于旧登录，不能覆盖
    const stillCurrent = () => chatgptSession(this.settings.get())?.refreshToken === session.refreshToken
    try {
      const next = await refreshChatGPT(session)
      if (stillCurrent()) this.settings.update({ providers: { chatgpt: { key: JSON.stringify(next) } } })
      return null
    } catch (error) {
      this.options.log('ai.chatgpt-refresh-failed', { message: error instanceof Error ? error.message : String(error) })
      if (!stillCurrent()) return null
      if (error instanceof SignInExpired) {
        // 登录信息留着（重新登录时沿用 client_id、预填账号），只是标记失效
        this.settings.update({ providers: { chatgpt: { expired: true } } })
        return 'ChatGPT 登录已过期，请在 AI 配置里重新登录'
      }
      // 网络等临时问题：登录还在，令牌没过期就继续用
      if (!force && session.expiresAt > Date.now()) return null
      return `ChatGPT 登录暂时无法刷新（${error instanceof Error ? error.message : String(error)}），请检查网络后再试`
    }
  }

  /** 用 ChatGPT 登录时令牌被拒（401）：强制刷新一次。刷新得了说明登录还在，提示重试；刷新不了就是登录已失效 */
  private async chatgptAuthProblem(error: unknown): Promise<string | null> {
    if (!(error instanceof AiError) || error.code !== 'auth' || this.settings.get().provider !== 'chatgpt') return null
    return (await this.ensureFreshToken('chatgpt', true)) ?? 'ChatGPT 登录已重新验证，请再试一次'
  }

  async signIn(): Promise<{ ok: boolean; message?: string }> {
    try {
      const settings = this.settings.get()
      const session = await signInChatGPT(settings.installId, chatgptSession(settings))
      this.settings.update({
        provider: 'chatgpt',
        providers: { chatgpt: { key: JSON.stringify(session), label: session.email ?? '', baseUrl: '', expired: false } },
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  cancelSignIn(): void {
    cancelSignIn()
  }

  signOut(): AiSettings {
    this.settings.update({ providers: { chatgpt: { key: '', label: '', expired: false } } })
    return this.settings.public()
  }

  // ---- 配置辅助 ----

  detectKey(key: string): Promise<KeyDetection> {
    return detectProvider(key)
  }

  sources(): AiCredentialSource[] {
    return findOpenAISources().map((source) => ({ id: source.id, label: source.label, baseURL: source.baseURL, hasKey: Boolean(source.apiKey), model: source.model }))
  }

  importSource(id: string): AiSettings {
    const source = findOpenAISources().find((item) => item.id === id)
    if (source) this.settings.update({ provider: 'custom', providers: { custom: { baseUrl: source.baseURL, key: source.apiKey, model: source.model ?? '' } } })
    return this.settings.public()
  }

  /** 拉取服务端模型列表，按一千次翻译的估算费用从低到高排序（价格来自 models.dev） */
  async listModels(id?: ProviderId): Promise<{ ok: boolean; models: AiModelInfo[]; message?: string }> {
    const problem = await this.ensureFreshToken(id)
    if (problem) return { ok: false, models: [], message: problem }
    const settings = this.settings.get()
    const resolved = resolveProvider(settings, id ?? settings.provider)
    if (!resolved) return { ok: false, models: [], message: id === 'chatgpt' ? '请先登录 ChatGPT' : '请先填写 API Key' }
    try {
      // 价格库在后台刷新，不拖慢列表；这次先用缓存或安装包内置的价格
      void refreshPrices()
      if (resolved.info.id === 'chatgpt') {
        // 会员额度内使用，不按 token 计费：不显示价格
        const ids = await listPlanModels(resolved.apiKey)
        return { ok: true, models: ids.map((model) => ({ id: model, input: null, output: null, perThousand: null })) }
      }
      const ids = await new LlmEngine({ baseURL: resolved.baseURL, apiKey: resolved.apiKey }, 'x').listModels()
      return { ok: true, models: sortByPrice(ids) }
    } catch (error) {
      return { ok: false, models: [], message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 用一句 "Good morning!" 走一遍完整的翻译流程 */
  async test(): Promise<{ ok: boolean; message: string }> {
    const started = Date.now()
    let got = ''
    const result = await this.translate(
      { segments: [{ index: 1, text: 'Good morning!' }], target: 'auto' },
      new AbortController().signal,
      (event) => {
        if (event.type === 'segment') got = event.text
      },
    )
    if (!result.ok) return { ok: false, message: result.message ?? '测试失败' }
    return { ok: true, message: `「Good morning!」→「${got}」 · ${((Date.now() - started) / 1000).toFixed(1)}s` }
  }

  // ---- 翻译 ----

  async translate(request: TranslateRequest, signal: AbortSignal, emit: (event: TranslateEvent) => void): Promise<TranslateResult> {
    const problem = await this.ensureFreshToken()
    if (problem) return { ok: false, message: problem, needsSetup: true }
    const engine = this.currentEngine()
    if (!engine) return { ok: false, message: this.status().detail, needsSetup: true }
    const settings = this.settings.get()
    const sample = request.segments.map((segment) => segment.text).join('\n')
    const code = resolveTargetLanguage(request.target === 'auto' ? settings.translateTarget : request.target, sample)
    const language = languageOf(code)
    emit({ type: 'start', target: code, targetName: language.name, model: engine.model })
    const wanted = new Set(request.segments.map((segment) => segment.index))
    const seen = new Set<number>()
    const parser = new JsonObjectStream((value) => {
      const index = Number(value.i)
      if (!wanted.has(index) || seen.has(index) || typeof value.t !== 'string') return
      seen.add(index)
      emit({ type: 'segment', index, text: value.t })
    })
    try {
      await engine.stream(TRANSLATE_INSTRUCTIONS, translateUserText(request.segments, language), signal, (delta) => parser.push(delta))
    } catch (error) {
      if (error instanceof AiError && error.code === 'cancelled') return { ok: false, message: '已取消' }
      this.options.log('ai.translate-failed', { code: error instanceof AiError ? error.code : 'unknown' })
      const message = (await this.chatgptAuthProblem(error)) ?? (error instanceof Error ? error.message : String(error))
      return { ok: false, message, needsSetup: error instanceof AiError && error.code === 'auth' }
    }
    if (seen.size === 0) return { ok: false, message: '模型没有返回可用的译文，请重试或换个模型' }
    return { ok: true }
  }

  // ---- 统计分析 ----

  private async loadInsights(): Promise<Record<string, InsightRecord>> {
    if (this.insights) return this.insights
    const file = await readJsonFile(this.insightFile)
    const value = file.status === 'ok' && file.value && typeof file.value === 'object' ? (file.value as { records?: unknown }).records : null
    this.insights = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, InsightRecord> : {}
    return this.insights
  }

  async getInsight(granularity: StatsGranularity, start: number): Promise<InsightRecord | null> {
    const records = await this.loadInsights()
    return records[insightKey(granularity, start)] ?? null
  }

  async analyze(params: {
    granularity: StatsGranularity
    start: number
    summary: PeriodSummary
    notes: InsightNoteInput[]
    now: number
  }, signal: AbortSignal): Promise<InsightRunResult> {
    const problem = await this.ensureFreshToken()
    if (problem) return { ok: false, message: problem, needsSetup: true }
    const engine = this.currentEngine()
    if (!engine) return { ok: false, message: this.status().detail, needsSetup: true }
    if (params.notes.length === 0) return { ok: false, message: '这段时间没有便签，没什么可分析的。' }
    const { text, aliases } = buildInsightUserText(params)
    let output = ''
    try {
      await engine.stream(INSIGHT_INSTRUCTIONS, text, signal, (delta) => {
        output += delta
      })
    } catch (error) {
      if (error instanceof AiError && error.code === 'cancelled') return { ok: false, message: '已取消' }
      this.options.log('ai.insight-failed', { code: error instanceof AiError ? error.code : 'unknown' })
      const message = (await this.chatgptAuthProblem(error)) ?? (error instanceof Error ? error.message : String(error))
      return { ok: false, message, needsSetup: error instanceof AiError && error.code === 'auth' }
    }
    const insight = parseInsight(output, aliases)
    if (!insight) return { ok: false, message: '模型没有返回可用的分析结果，请重试或换个模型' }
    const record: InsightRecord = {
      key: insightKey(params.granularity, params.start),
      granularity: params.granularity,
      start: params.start,
      createdAt: Date.now(),
      model: engine.model,
      noteCount: params.notes.length,
      insight,
    }
    const records = await this.loadInsights()
    records[record.key] = record
    const kept = Object.values(records).sort((a, b) => b.createdAt - a.createdAt).slice(0, INSIGHT_CACHE_LIMIT)
    this.insights = Object.fromEntries(kept.map((item) => [item.key, item]))
    await writeJsonAtomic(this.insightFile, { version: 1, records: this.insights }).catch((error) => {
      this.options.log('ai.insight-save-failed', { message: (error as Error).message })
    })
    return { ok: true, record }
  }
}
