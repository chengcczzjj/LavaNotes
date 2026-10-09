// 模型调用：所有服务（含 Claude、ChatGPT 会员）都走 OpenAI 兼容接口（Responses 或 Chat Completions），与 LavaTranslate 相同。
// 网络用 Electron net（Chromium 网络栈、系统代理）。
import { net } from 'electron'
import OpenAI from 'openai'
import type { AiErrorCode } from '@shared/ai'

export interface EngineCredentials {
  baseURL: string
  apiKey: string
}

export interface EngineOptions {
  api?: 'responses' | 'chat' | 'auto'
  chatExtra?: Record<string, unknown>
  timeout?: number
}

export interface Usage {
  input: number
  output: number
}

export class AiError extends Error {
  readonly code: AiErrorCode

  constructor(message: string, code: AiErrorCode) {
    super(message)
    this.code = code
  }
}

/** 推理强度依次尝试；模型不支持该档时退到下一档，最后不带 reasoning。翻译和统计不需要深度思考 */
const EFFORTS: Array<string | null> = ['none', 'minimal', 'low', null]

/** 服务商没有 Responses 接口（多数国产模型的官方 API 只有 Chat Completions） */
function missingEndpoint(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) return false
  if (/model/i.test(error.message) && !/responses/i.test(error.message)) return false // 「模型不存在」也是 404，不能当成没有接口
  if (error.status === 404 || error.status === 405 || error.status === 501) return true
  return error.status === 400 && /(responses|endpoint|not supported|unsupported).*(api|path|url|endpoint|route)|invalid url|unknown url/i.test(error.message)
}

/** Key 无效：多数服务返回 401，Gemini 返回 400 */
function badKey(error: unknown): boolean {
  return error instanceof OpenAI.BadRequestError && /api[ _-]?key|API_KEY_INVALID/i.test(error.message)
}

const netFetch: typeof fetch = (input, init) => net.fetch(input as string, init as RequestInit)

export class LlmEngine {
  readonly model: string
  private readonly client: OpenAI
  private readonly creds: EngineCredentials
  /** 已知该模型可用的推理强度，避免每次都从头试 */
  private effortIndex = 0
  /** 先用 Responses（与 Codex 相同），服务商没有这个接口时改用 Chat Completions 并记住 */
  private api: 'responses' | 'chat'
  /** Chat Completions 里关掉思考的参数（各家写法不同）；服务商不认时去掉并记住 */
  private extra: Record<string, unknown> | null

  constructor(creds: EngineCredentials, model: string, options: EngineOptions = {}) {
    this.creds = creds
    this.model = model
    this.api = options.api === 'chat' ? 'chat' : 'responses'
    this.extra = options.chatExtra ?? null
    this.client = new OpenAI({
      apiKey: creds.apiKey,
      baseURL: creds.baseURL,
      maxRetries: 1,
      timeout: options.timeout ?? 60_000,
      fetch: netFetch,
    })
  }

  /** 模型不支持当前推理强度时自动换下一档 */
  private async withEffort<T>(call: (effort: string | null) => Promise<T>): Promise<T> {
    for (;;) {
      const effort = EFFORTS[Math.min(this.effortIndex, EFFORTS.length - 1)]
      try {
        return await call(effort)
      } catch (error) {
        if (error instanceof OpenAI.BadRequestError && effort && !badKey(error)) {
          // 明确是这一档不支持：试下一档；其他 400（可能根本不认 reasoning 参数）：直接不带它重试
          this.effortIndex = /reason|effort/i.test(error.message) ? this.effortIndex + 1 : EFFORTS.length - 1
          continue
        }
        throw error
      }
    }
  }

  /** 流式请求，逐段回调文本，返回用量 */
  async stream(instructions: string, input: string, signal: AbortSignal, onText: (delta: string) => void): Promise<Usage | undefined> {
    try {
      if (this.api === 'responses') {
        try {
          const stream = await this.withEffort((effort) => this.client.responses.create(
            {
              model: this.model,
              instructions,
              input: [{ role: 'user', content: [{ type: 'input_text', text: input }] }],
              stream: true,
              store: false,
              ...(effort ? { reasoning: { effort: effort as OpenAI.ReasoningEffort } } : {}),
            },
            { signal },
          ))
          return await this.drain(stream, onText)
        } catch (error) {
          if (!missingEndpoint(error)) throw error
          this.api = 'chat'
        }
      }
      return await this.chat(instructions, input, signal, onText)
    } catch (error) {
      throw this.toAiError(error, signal)
    }
  }

  private async drain(stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>, onText: (delta: string) => void): Promise<Usage | undefined> {
    let usage: Usage | undefined
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') onText(event.delta)
      else if (event.type === 'response.completed') {
        const used = event.response.usage
        if (used) usage = { input: used.input_tokens, output: used.output_tokens }
      } else if (event.type === 'response.failed') {
        // ChatGPT 会员额度：用完 / 暂不可用
        const code = String(event.response.error?.code ?? '')
        if (code === 'subscription_sharing_usage_limit_exceeded') throw new AiError('ChatGPT 会员额度已用完，过一阵再试，或改用 API Key', 'rate-limit')
        if (code === 'subscription_sharing_usage_unavailable') throw new AiError('ChatGPT 会员额度暂时不可用，稍后再试', 'rate-limit')
        throw new AiError(event.response.error?.message ?? '模型返回失败', 'unknown')
      } else if (event.type === 'response.incomplete') {
        throw new AiError('模型没有完整返回，请重试', 'unknown')
      } else if (event.type === 'error') {
        throw new AiError(event.message ?? '模型返回错误', 'unknown')
      }
    }
    return usage
  }

  private async chat(instructions: string, input: string, signal: AbortSignal, onText: (delta: string) => void): Promise<Usage | undefined> {
    const create = (usage: boolean, more: Record<string, unknown>) => this.client.chat.completions.create(
      {
        model: this.model,
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: input },
        ],
        stream: true,
        ...(usage ? { stream_options: { include_usage: true } } : {}),
        ...more,
      } as OpenAI.ChatCompletionCreateParamsStreaming,
      { signal },
    )
    // 有服务商专用的"关闭思考"参数就用它，否则用 reasoning_effort 逐档尝试
    const open = (usage: boolean) => (this.extra
      ? create(usage, this.extra)
      : this.withEffort((effort) => create(usage, effort ? { reasoning_effort: effort } : {})))
    let stream
    for (let usage = true; ;) {
      try {
        stream = await open(usage)
        break
      } catch (error) {
        if (!(error instanceof OpenAI.BadRequestError)) throw error
        // 少数服务不认 stream_options
        if (usage && /stream_options|include_usage/i.test(error.message)) usage = false
        else if (this.extra && !badKey(error)) this.extra = null
        else throw error
      }
    }
    let usage: Usage | undefined
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) onText(delta)
      if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens }
    }
    return usage
  }

  private toAiError(error: unknown, signal: AbortSignal): AiError {
    if (signal.aborted) return new AiError('已取消', 'cancelled')
    if (error instanceof AiError) return error
    if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError || badKey(error)) {
      return new AiError('API Key 无效或已停用', 'auth')
    }
    if (error instanceof OpenAI.RateLimitError) return new AiError('请求过于频繁或额度不足', 'rate-limit')
    if (error instanceof OpenAI.APIConnectionError) return new AiError('无法连接到模型服务，请检查网络或代理', 'network')
    if (error instanceof OpenAI.APIError) {
      if (/no available .*accounts? support/i.test(error.message)) return new AiError(`服务商当前没有可用的 ${this.model}，请在设置里换个模型`, 'unknown')
      return new AiError(`API 错误 ${error.status ?? ''}：${error.message}`, 'unknown')
    }
    return new AiError(error instanceof Error ? error.message : String(error), 'unknown')
  }

  async listModels(): Promise<string[]> {
    const url = new URL(this.creds.baseURL)
    // Gemini 的 OpenAI 兼容接口不一定提供模型列表，改用原生接口，只保留能生成内容的模型
    if (url.host === 'generativelanguage.googleapis.com') {
      const response = await net.fetch(`${url.origin}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': this.creds.apiKey } })
      const json = (await response.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }>; error?: { message: string } }
      if (!response.ok) throw new Error(json.error?.message ?? `HTTP ${response.status}`)
      return (json.models ?? []).filter((model) => model.supportedGenerationMethods?.includes('generateContent')).map((model) => model.name.replace(/^models\//, ''))
    }
    // Claude 的兼容接口只覆盖对话，模型列表用 Anthropic 原生接口（x-api-key）
    if (url.host === 'api.anthropic.com') {
      const response = await net.fetch(`${url.origin}/v1/models?limit=1000`, { headers: { 'x-api-key': this.creds.apiKey, 'anthropic-version': '2023-06-01' } })
      const json = (await response.json()) as { data?: Array<{ id: string }>; error?: { message: string } }
      if (!response.ok) throw new Error(json.error?.message ?? `HTTP ${response.status}`)
      return (json.data ?? []).map((model) => model.id)
    }
    const ids: string[] = []
    for await (const model of this.client.models.list()) ids.push(model.id.replace(/^models\//, ''))
    return ids
  }
}
