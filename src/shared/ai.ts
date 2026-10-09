// 语言模型服务：与 LavaTranslate 相同的服务商目录和配置方式。
// 全部走 OpenAI 兼容接口（Claude 用 Anthropic 提供的兼容接口）；api 表示优先用哪种接口（auto：先试 Responses，没有再用 Chat Completions）。
// chatgpt 不用 Key：用 ChatGPT 账号登录，消耗 Plus / Pro 会员额度。

export type ProviderId = 'chatgpt' | 'gemini' | 'openai' | 'deepseek' | 'claude' | 'qwen' | 'zhipu' | 'kimi' | 'doubao' | 'openrouter' | 'custom'

export interface ProviderInfo {
  id: ProviderId
  name: string
  /** 卡片上的一句话 */
  blurb: string
  /** Key 的格式（用来自动识别是哪家）；格式一样的几家（sk- 开头）靠请求模型列表来区分 */
  keyPattern?: RegExp
  api: 'responses' | 'chat' | 'auto'
  /** 默认接口地址；custom 为空，需要用户填写 */
  baseUrl: string
  /** 获取 API Key 的网页 */
  keyUrl: string
  keyUrlLabel: string
  /** 获取 Key 的步骤（简短） */
  steps: string[]
  /** 计费、额度、网络等提示 */
  tip?: string
  /** Key 的常见前缀，用于输入时提示是否填错 */
  keyHint?: string
  /** 推荐模型（列表里标「推荐」，顺序即优先级） */
  suggest: string[]
  /**
   * Chat Completions 请求里关掉"思考"的参数（各家写法不同）；翻译和统计不需要深度思考，关掉后快好几倍。
   * 不填则用 reasoning_effort 逐档尝试
   */
  chatExtra?: Record<string, unknown>
  tags: Array<'免费额度' | '国内直连' | '需要代理' | '聚合'>
  /** 卡片上的品牌色 */
  color: string
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    blurb: '用 Plus / Pro 会员额度',
    api: 'responses',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: '',
    keyUrlLabel: '',
    steps: [],
    tip: '用 ChatGPT 账号登录后，翻译和统计消耗你 Plus / Pro 会员的额度，不需要 API Key。这是 OpenAI 为开源软件提供的官方方式。',
    suggest: ['gpt-6-luna', 'gpt-5-mini'],
    tags: [],
    color: '#10a37f',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    blurb: 'Google · Flash 系列又快又便宜',
    api: 'chat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyUrlLabel: '打开 Google AI Studio',
    steps: ['用 Google 账号登录 AI Studio', '点击「Create API key」', '复制以 AIza 开头的 Key，粘贴到上面的 API Key 框'],
    tip: '有免费额度，不用绑卡；免费额度内的数据可能被 Google 用于改进产品。国内网络需要代理。',
    keyHint: 'AIza',
    keyPattern: /^AIza[0-9A-Za-z_-]{30,}$/,
    suggest: ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite'],
    tags: ['免费额度', '需要代理'],
    color: '#4f8df7',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    blurb: 'GPT · nano / mini 小模型',
    api: 'responses',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyUrlLabel: '打开 OpenAI Platform',
    steps: ['登录 OpenAI Platform 并在 Billing 里充值', '在 API keys 页面点「Create new secret key」', '复制以 sk- 开头的 Key'],
    tip: 'ChatGPT 会员不包含 API 额度，需要单独充值。国内网络需要代理。',
    keyHint: 'sk-',
    keyPattern: /^sk-(proj|svcacct|admin)-/,
    suggest: ['gpt-6-luna', 'gpt-5-nano', 'gpt-5-mini'],
    tags: ['需要代理'],
    color: '#10a37f',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    blurb: '深度求索 · 便宜，国内直连',
    api: 'chat',
    baseUrl: 'https://api.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyUrlLabel: '打开 DeepSeek 开放平台',
    steps: ['用手机号登录 DeepSeek 开放平台并充值', '在 API keys 页面点「创建 API key」', '复制以 sk- 开头的 Key'],
    tip: 'deepseek-flash 首字约 1 秒；工作日北京时间 9–12 点、14–18 点以外半价。',
    keyHint: 'sk-',
    suggest: ['deepseek-flash'],
    chatExtra: { thinking: { type: 'disabled' } },
    tags: ['国内直连'],
    color: '#4d6bfe',
  },
  {
    id: 'qwen',
    name: '通义千问',
    blurb: '阿里云百炼',
    api: 'chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    keyUrlLabel: '打开阿里云百炼',
    steps: ['用阿里云账号登录百炼控制台并开通服务', '在「API Key」页面创建 Key', '复制以 sk- 开头的 Key'],
    tip: '新用户有免费额度。',
    keyHint: 'sk-',
    suggest: ['qwen3.8-flash', 'qwen-plus'],
    chatExtra: { enable_thinking: false },
    tags: ['免费额度', '国内直连'],
    color: '#615ced',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    blurb: '智谱开放平台 · Flash 免费模型',
    api: 'chat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    keyUrlLabel: '打开智谱开放平台',
    steps: ['登录智谱开放平台（bigmodel.cn）', '在「API Keys」页面添加新的 Key', '复制 Key，粘贴到上面的 API Key 框'],
    tip: 'Flash 模型免费，但同一时间只处理一个请求，高峰期可能排队。',
    keyPattern: /^[0-9a-f]{32}\.[0-9A-Za-z]{16}$/,
    suggest: ['glm-5.3-flash', 'glm-4.6v-flash'],
    chatExtra: { thinking: { type: 'disabled' } },
    tags: ['免费额度', '国内直连'],
    color: '#3859ff',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    blurb: '月之暗面 · 国内直连',
    api: 'chat',
    baseUrl: 'https://api.moonshot.cn/v1',
    keyUrl: 'https://platform.kimi.com/console/api-keys',
    keyUrlLabel: '打开 Kimi 开放平台',
    steps: ['登录 Kimi 开放平台并充值', '在「API Key 管理」页面新建 Key', '复制以 sk- 开头的 Key'],
    keyHint: 'sk-',
    suggest: [],
    tags: ['国内直连'],
    color: '#16191e',
  },
  {
    id: 'doubao',
    name: '豆包',
    blurb: '火山方舟 · Seed 模型',
    api: 'chat',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    keyUrlLabel: '打开火山方舟控制台',
    steps: ['登录火山引擎，进入方舟控制台并开通模型', '在「API Key 管理」页面创建 Key', '复制 Key；模型名在「开通管理」里查看'],
    tip: '新用户有免费额度。模型列表拿不到时，可以在搜索框里直接输入模型名后回车。',
    suggest: ['doubao-seed-2.0-mini'],
    keyPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    chatExtra: { thinking: { type: 'disabled' } },
    tags: ['免费额度', '国内直连'],
    color: '#2f6bff',
  },
  {
    id: 'claude',
    name: 'Claude',
    blurb: 'Anthropic · Haiku 快且准',
    api: 'chat',
    baseUrl: 'https://api.anthropic.com/v1',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyUrlLabel: '打开 Claude Console',
    steps: ['登录 Claude Console 并在 Billing 里充值', '在 API Keys 页面点「Create Key」', '复制以 sk-ant- 开头的 Key'],
    tip: 'Claude Pro / Max 会员不包含 API 额度，按 Anthropic 的规定也不能用于第三方软件，需要单独充值的 API Key。国内网络需要代理。',
    keyHint: 'sk-ant-',
    keyPattern: /^sk-ant-/,
    suggest: ['claude-haiku-5-5', 'claude-haiku-4-5'],
    chatExtra: { thinking: { type: 'disabled' } },
    tags: ['需要代理'],
    color: '#d97757',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    blurb: '一个 Key 用遍各家模型',
    api: 'chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyUrlLabel: '打开 OpenRouter',
    steps: ['登录 OpenRouter 并充值（Credits）', '在 Keys 页面点「Create Key」', '复制以 sk-or- 开头的 Key'],
    tip: '模型名带厂商前缀，例如 google/gemini-flash-lite-latest。',
    keyHint: 'sk-or-',
    keyPattern: /^sk-or-/,
    suggest: [],
    tags: ['聚合'],
    color: '#6467f2',
  },
  {
    id: 'custom',
    name: '自定义',
    blurb: '中转或其他兼容服务',
    api: 'auto',
    baseUrl: '',
    keyUrl: '',
    keyUrlLabel: '',
    steps: ['填写服务商提供的接口地址（通常以 /v1 结尾）', '填写对应的 API Key', '获取模型列表并选一个'],
    tip: '支持任何兼容 OpenAI 接口的服务：中转站、本地模型（Ollama、LM Studio）等。',
    suggest: [],
    tags: [],
    color: '#8b8b98',
  },
]

export const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id)

export function providerInfo(id: string): ProviderInfo {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[PROVIDERS.length - 1]
}

/** 填 API Key 的服务（不含 ChatGPT 登录和自定义） */
export const KEY_PROVIDERS = PROVIDERS.filter((provider) => provider.id !== 'chatgpt' && provider.id !== 'custom')

/** 只看格式就能确定的服务商；sk- 开头的几家要请求一下才知道 */
export function providerByKeyFormat(key: string): ProviderId | null {
  return KEY_PROVIDERS.find((provider) => provider.keyPattern?.test(key.trim()))?.id ?? null
}

/** sk- 开头、格式相同的几家：依次请求模型列表，能通过的就是 */
export const AMBIGUOUS_KEY_PROVIDERS: ProviderId[] = ['deepseek', 'openai', 'qwen', 'kimi']

/** 由接口地址猜服务商：已知服务商的官方地址归到那家，否则算自定义 */
export function providerForUrl(url: string): ProviderId {
  let host = ''
  try {
    host = new URL(url).host
  } catch {
    return 'custom'
  }
  const hit = PROVIDERS.find((provider) => provider.baseUrl && new URL(provider.baseUrl).host === host)
  return hit?.id ?? 'custom'
}

export interface Language {
  code: string
  name: string
  native: string
}

export const LANGUAGES: Language[] = [
  { code: 'zh-Hans', name: '简体中文', native: '简体中文' },
  { code: 'zh-Hant', name: '繁體中文', native: '繁體中文' },
  { code: 'en', name: '英语', native: 'English' },
  { code: 'ja', name: '日语', native: '日本語' },
  { code: 'ko', name: '韩语', native: '한국어' },
  { code: 'fr', name: '法语', native: 'Français' },
  { code: 'de', name: '德语', native: 'Deutsch' },
  { code: 'es', name: '西班牙语', native: 'Español' },
  { code: 'ru', name: '俄语', native: 'Русский' },
  { code: 'pt', name: '葡萄牙语', native: 'Português' },
  { code: 'it', name: '意大利语', native: 'Italiano' },
  { code: 'vi', name: '越南语', native: 'Tiếng Việt' },
  { code: 'th', name: '泰语', native: 'ไทย' },
  { code: 'ar', name: '阿拉伯语', native: 'العربية' },
]

export function languageOf(code: string): Language {
  return LANGUAGES.find((language) => language.code === code) ?? LANGUAGES[0]
}

/**
 * 「自动」：中文写的译成英语，其他语言译成简体中文。
 * 只看汉字和拉丁字母的比例（一个汉字约等于一个英文单词的信息量）；有假名说明是日语，译成中文。
 */
export function resolveTargetLanguage(target: string, text: string): string {
  if (target !== 'auto' && LANGUAGES.some((language) => language.code === target)) return target
  if (/[\u3040-\u30ff]/.test(text)) return 'zh-Hans'
  const han = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  return han > 0 && han * 5 >= latin ? 'en' : 'zh-Hans'
}

/** 某个服务的配置：Key 落盘加密，界面上为打码形式（•••• 末四位）；接口地址留空表示用默认 */
export interface AiProviderConfig {
  key: string
  baseUrl: string
  model: string
  /** 界面显示用（ChatGPT 登录的账号邮箱） */
  label?: string
  /** ChatGPT 登录已失效：保留登录信息以便沿用 client_id，但不再使用，等用户重新登录 */
  expired?: boolean
}

export interface AiSettings {
  /** 当前使用的服务 */
  provider: ProviderId
  /** 各服务分别保存 Key、接口地址、模型，切换时互不影响 */
  providers: Partial<Record<ProviderId, AiProviderConfig>>
  /** 翻译成哪种语言：'auto' 或 LANGUAGES 里的代码 */
  translateTarget: string
  /** 本机安装的标识（ChatGPT 登录要求每台设备一个固定的 ext_agent_host_id） */
  installId: string
}

/** 更新设置用：providers 可以只改某个服务的部分字段 */
export type AiSettingsPatch = Partial<Omit<AiSettings, 'providers' | 'installId'>> & {
  providers?: Partial<Record<ProviderId, Partial<AiProviderConfig>>>
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'gemini',
  providers: {},
  translateTarget: 'auto',
  installId: '',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const text = (value: unknown, limit = 20_000): string => (typeof value === 'string' ? value.slice(0, limit) : '')

export function normalizeAiSettings(value: unknown): AiSettings {
  const source = isRecord(value) ? value : {}
  const providers: AiSettings['providers'] = {}
  if (isRecord(source.providers)) {
    for (const id of PROVIDER_IDS) {
      const raw = source.providers[id]
      if (!isRecord(raw)) continue
      providers[id] = {
        // An encrypted ChatGPT sign-in (tokens) is a few kilobytes.
        key: text(raw.key, 64_000),
        baseUrl: text(raw.baseUrl, 500).trim(),
        model: text(raw.model, 200).trim(),
        ...(typeof raw.label === 'string' && raw.label ? { label: text(raw.label, 200) } : {}),
        ...(raw.expired === true ? { expired: true } : {}),
      }
    }
  }
  const target = text(source.translateTarget, 20)
  return {
    provider: PROVIDER_IDS.includes(source.provider as ProviderId) ? source.provider as ProviderId : DEFAULT_AI_SETTINGS.provider,
    providers,
    translateTarget: target === 'auto' || LANGUAGES.some((language) => language.code === target) ? target : 'auto',
    installId: /^[A-Za-z0-9-]{8,64}$/.test(text(source.installId, 64)) ? text(source.installId, 64) : '',
  }
}

/** 界面上用的服务状态 */
export interface AiStatus {
  provider: ProviderId
  ok: boolean
  detail: string
}

/** 模型列表里的一项（价格来自 models.dev，单位：美元 / 百万 token） */
export interface AiModelInfo {
  id: string
  input: number | null
  output: number | null
  /** 估算一千次翻译的费用（美元） */
  perThousand: number | null
}

/** 在本机找到的 OpenAI 兼容凭据（Codex 配置 / CC Switch） */
export interface AiCredentialSource {
  id: string
  label: string
  baseURL: string
  hasKey: boolean
  model?: string
}

export type KeyDetection = { provider: ProviderId; by: 'format' | 'probe' } | { provider: null; tried: ProviderId[] }

export type AiErrorCode = 'auth' | 'config' | 'network' | 'rate-limit' | 'empty' | 'cancelled' | 'unknown'
