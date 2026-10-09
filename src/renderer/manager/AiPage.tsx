import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Info,
  KeyRound,
  Loader2,
  LogIn,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react'
import {
  KEY_PROVIDERS,
  LANGUAGES,
  PROVIDERS,
  providerForUrl,
  providerInfo,
  type AiCredentialSource,
  type AiModelInfo,
  type AiSettings,
  type AiSettingsPatch,
  type AiStatus,
  type ProviderId,
} from '@shared/ai'

/*
 * Language model settings, the same scheme as LavaTranslate: every provider
 * keeps its own key, address and model; the key is encrypted on disk and only
 * shown masked here. Translation and the statistics both use the current one.
 */

const api = window.lavaManager

type Update = (patch: AiSettingsPatch) => Promise<void>

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function ProviderMark({ id, size = 'md' }: { id: ProviderId; size?: 'sm' | 'md' | 'lg' }) {
  const info = providerInfo(id)
  return (
    <span className="prov-mark" data-size={size} style={{ background: info.color }}>
      {id === 'custom' ? <SlidersHorizontal size={size === 'sm' ? 10 : 13} /> : id === 'chatgpt' ? <Sparkles size={size === 'sm' ? 10 : 15} /> : info.name.slice(0, 1)}
    </span>
  )
}

/** First provider other than `except` that already has a key (after clearing or signing out). */
function firstConfigured(settings: AiSettings, except: ProviderId): ProviderId {
  return (PROVIDERS.find((provider) => provider.id !== except && settings.providers[provider.id]?.key)?.id ?? 'gemini') as ProviderId
}

function ChatGPTCard({ settings, update }: { settings: AiSettings; update: Update }) {
  const config = settings.providers.chatgpt
  const expired = Boolean(config?.key) && Boolean(config?.expired)
  const signedIn = Boolean(config?.key) && !expired
  const current = settings.provider === 'chatgpt'
  const who = config?.label || 'ChatGPT 账号'
  const [state, setState] = useState<{ busy: boolean; message?: string }>({ busy: false })

  const signIn = async () => {
    setState({ busy: true })
    const result = await api.chatgptSignIn()
    setState({ busy: false, message: result.ok ? undefined : result.message })
  }

  return (
    <div className="ai-card login" data-current={current}>
      <ProviderMark id="chatgpt" size="lg" />
      <div className="ai-card__text">
        <div className="ai-card__title">ChatGPT 会员{current && <span className="tag rec">当前</span>}</div>
        <div className="ai-card__desc">
          {signedIn
            ? `已登录 ${who} · 使用 Plus / Pro 会员额度`
            : state.busy
              ? '请在浏览器中完成登录和授权'
              : expired
                ? `${who} 的登录已过期`
                : '有 Plus / Pro 会员？登录后用会员额度翻译和统计，无需 API Key'}
        </div>
        {state.message && <div className="ai-note err">{state.message}</div>}
      </div>
      {signedIn ? (
        <div className="row-gap">
          {!current && <button type="button" onClick={() => void update({ provider: 'chatgpt' })}>使用</button>}
          <button
            type="button"
            className="link danger"
            onClick={async () => {
              const next = await api.chatgptSignOut()
              if (current) await update({ provider: firstConfigured(next, 'chatgpt') })
              else await update({})
            }}
          >
            退出登录
          </button>
        </div>
      ) : state.busy ? (
        <button type="button" onClick={() => void api.chatgptCancel()}><Loader2 size={14} className="spin" />取消</button>
      ) : (
        <button type="button" className="primary" onClick={() => void signIn()}><LogIn size={14} />{expired ? '重新登录' : '用 ChatGPT 登录'}</button>
      )}
    </div>
  )
}

type KeyResult = { kind: 'ok'; text: string } | { kind: 'ask' } | { kind: 'err'; text: string } | null

/** Paste an API key: the provider is recognised automatically, and asked for only when it cannot be. */
function KeyCard({ settings, update }: { settings: AiSettings; update: Update }) {
  const info = providerInfo(settings.provider)
  const keyBased = info.id !== 'chatgpt'
  const config = keyBased ? settings.providers[info.id] : undefined
  const [key, setKey] = useState('')
  const [base, setBase] = useState(info.id === 'custom' ? (config?.baseUrl ?? '') : '')
  const [showBase, setShowBase] = useState(info.id === 'custom')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<KeyResult>(null)
  const [choice, setChoice] = useState<ProviderId>('openai')
  const [sources, setSources] = useState<AiCredentialSource[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const importRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    void api.credentialSources().then((next) => {
      if (alive) setSources(next)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!importOpen) return
    const away = (event: MouseEvent) => {
      if (importRef.current && !importRef.current.contains(event.target as Node)) setImportOpen(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [importOpen])

  const save = async (id: ProviderId, by: string) => {
    const baseUrl = id === 'custom' ? base.trim() : ''
    await update({ provider: id, providers: { [id]: { key: key.trim(), baseUrl } } })
    setKey('')
    setResult({ kind: 'ok', text: `已保存为 ${providerInfo(id).name}（${by}）` })
  }

  const submit = async () => {
    const typed = key.trim()
    if (!typed) return
    setBusy(true)
    setResult(null)
    try {
      // 填了接口地址：按地址判断（已知服务商的官方地址就归到那家，否则算自定义）
      if (showBase && base.trim()) {
        const id = providerForUrl(base.trim())
        await save(id, id === 'custom' ? '自定义接口地址' : '按接口地址识别')
        return
      }
      const detected = await api.detectKey(typed)
      if (detected.provider) await save(detected.provider, detected.by === 'format' ? '按 Key 格式识别' : '试连后识别')
      else setResult({ kind: 'ask' })
    } finally {
      setBusy(false)
    }
  }

  const importFrom = async (id: string) => {
    setImportOpen(false)
    await api.importCredentials(id)
    setResult({ kind: 'ok', text: '已导入，接下来选一个模型' })
  }

  return (
    <div className="ai-card stack">
      <div className="ai-card__text">
        <div className="ai-card__title">API Key</div>
        <div className="ai-card__desc">粘贴任意一家的 Key，会自动识别是哪家服务；每家的 Key 分别保存，加密存放在本机。</div>
      </div>
      <div className="ai-fields">
        {keyBased && config?.key && (
          <div className="key-current">
            <ProviderMark id={info.id} size="sm" />
            当前：{info.name}
            <span className="key-saved"><Check size={12} strokeWidth={3} />{config.key}</span>
            {info.id === 'custom' && config.baseUrl && <span className="muted">· {hostOf(config.baseUrl)}</span>}
            <button
              type="button"
              className="link danger"
              onClick={async () => {
                await update({ provider: firstConfigured(settings, info.id), providers: { [info.id]: { key: '', model: '' } } })
                setResult(null)
              }}
            >
              清除
            </button>
          </div>
        )}
        <input
          className="input mono"
          type="password"
          placeholder={config?.key ? '填写另一家的 Key，可以同时保存多家' : '粘贴 API Key，例如 sk-… / AIza…'}
          value={key}
          spellCheck={false}
          onChange={(event) => {
            setKey(event.target.value)
            setResult(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
        {showBase ? (
          <label className="field">
            <span className="field-label">接口地址<span className="muted">中转站、本地模型等，通常以 /v1 结尾</span></span>
            <input
              className="input"
              placeholder="https://…/v1"
              value={base}
              spellCheck={false}
              onChange={(event) => setBase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit()
              }}
            />
          </label>
        ) : (
          <button type="button" className="link left" onClick={() => setShowBase(true)}>使用自定义接口地址（中转、Ollama、LM Studio…）</button>
        )}
        {result?.kind === 'ok' && <div className="detect-ok"><Check size={13} strokeWidth={3} />{result.text}</div>}
        {result?.kind === 'err' && <div className="ai-note err">{result.text}</div>}
        {result?.kind === 'ask' && (
          <div className="detect-ask">
            <span>没能自动识别，这是哪家的 Key？</span>
            <select className="input sel" value={choice} onChange={(event) => setChoice(event.target.value as ProviderId)}>
              {KEY_PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              <option value="custom">自定义（需要接口地址）</option>
            </select>
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (choice === 'custom' && !base.trim()) {
                  setShowBase(true)
                  return
                }
                void save(choice, '手动选择')
              }}
            >
              保存
            </button>
          </div>
        )}
        <div className="ai-actions">
          <button type="button" className="primary" disabled={!key.trim() || busy} onClick={() => void submit()}>
            {busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}
            {busy ? '正在识别…' : '保存 Key'}
          </button>
          {sources.length > 0 && (
            <div className="import" ref={importRef}>
              <button type="button" onClick={() => setImportOpen((open) => !open)}>
                <Download size={14} />从本机导入<ChevronDown size={13} className={importOpen ? 'chev up' : 'chev'} />
              </button>
              {importOpen && (
                <div className="import-pop">
                  <div className="pop-label">本机找到的 OpenAI 兼容配置</div>
                  {sources.map((source) => (
                    <button key={source.id} type="button" className="import-item" disabled={!source.hasKey} onClick={() => void importFrom(source.id)}>
                      <span>{source.label}</span>
                      <span className="muted">{source.hasKey ? hostOf(source.baseURL) : '没有 Key'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Saved services: one click switches. */
function SavedServices({ settings, update }: { settings: AiSettings; update: Update }) {
  const saved = PROVIDERS.filter((provider) => settings.providers[provider.id]?.key)
  if (saved.length < 2) return null
  return (
    <div className="saved">
      <span className="saved-label">已保存的服务</span>
      {saved.map((provider) => (
        <button key={provider.id} type="button" className="saved-chip" data-current={provider.id === settings.provider} onClick={() => void update({ provider: provider.id })}>
          <ProviderMark id={provider.id} size="sm" />
          {provider.name}
          {settings.providers[provider.id]?.model && <span className="muted">· {settings.providers[provider.id]!.model}</span>}
        </button>
      ))}
    </div>
  )
}

/** Small and fast models get a tag: translation and summaries do not need a large model. */
const FAST_HINT = /(mini|nano|flash|haiku|lite|air|turbo|spark|instant|luna)/i
/** Models that cannot write text (embeddings, speech, images…), hidden by default. */
const NON_CHAT = /(embed|tts|whisper|dall-?e|imagen|image-gen|-image|audio|realtime|moderation|transcri|rerank|sora|veo|speech|search-preview|aqa|live)/i

function money(value: number): string {
  if (value < 0.01) return '<$0.01'
  return `$${value < 1 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)}`
}

function perMillion(value: number | null): string {
  if (value === null) return '—'
  return `$${value >= 10 ? Math.round(value) : Number(value.toFixed(value >= 1 ? 2 : 3))}`
}

function ModelList({ settings, update }: { settings: AiSettings; update: Update }) {
  const info = providerInfo(settings.provider)
  const config = settings.providers[info.id]
  const ready = Boolean(config?.key) && (info.id !== 'custom' || Boolean(config?.baseUrl))
  const plan = info.id === 'chatgpt'
  const [models, setModels] = useState<{ state: 'idle' | 'load' | 'ok' | 'fail'; list: AiModelInfo[]; message?: string }>({ state: 'idle', list: [] })
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)

  const load = useCallback(async () => {
    setModels((current) => ({ ...current, state: 'load' }))
    const result = await api.listModels(info.id)
    setModels({ state: result.ok ? 'ok' : 'fail', list: result.models, message: result.message })
  }, [info.id])

  // A new or changed key loads the list again.
  useEffect(() => {
    if (!ready) return
    let alive = true
    void api.listModels(info.id).then((result) => {
      if (alive) setModels({ state: result.ok ? 'ok' : 'fail', list: result.models, message: result.message })
    })
    return () => {
      alive = false
    }
  }, [ready, info.id, config?.key, config?.baseUrl])

  const choose = (model: string) => update({ providers: { [info.id]: { model } } })
  const chat = models.list.filter((model) => !NON_CHAT.test(model.id))
  const needle = query.trim().toLowerCase()
  const shown = (all ? models.list : chat).filter((model) => model.id.toLowerCase().includes(needle))
  const hidden = models.list.length - chat.length
  // Only the catalogue's own suggestions are recommended; relays and custom services are not guessed.
  const pick = info.suggest.find((id) => models.list.some((model) => model.id === id))
  const manual = needle && !models.list.some((model) => model.id.toLowerCase() === needle) ? query.trim() : ''
  const loading = ready && (models.state === 'load' || models.state === 'idle')

  return (
    <>
      <h3 className="ai-h3">
        模型
        <span className="muted">· {info.name} · 当前：{config?.model || '未选择'}</span>
        {ready && (
          <label className="ai-search">
            <Search size={13} />
            <input
              placeholder="搜索或输入模型名"
              value={query}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && manual) void choose(manual)
              }}
            />
          </label>
        )}
        {ready && (
          <button type="button" className="link" disabled={models.state === 'load'} onClick={() => void load()}>
            <RefreshCw size={12} className={models.state === 'load' ? 'spin' : ''} />刷新
          </button>
        )}
      </h3>

      {!ready ? (
        <div className="empty-models"><KeyRound size={20} /><span>{plan ? '登录 ChatGPT 后会列出可用的模型' : '填好 API Key 后会列出这家服务的模型'}</span></div>
      ) : loading && models.list.length === 0 ? (
        <div className="empty-models"><Loader2 size={18} className="spin" /><span>正在获取模型列表…</span></div>
      ) : (
        <>
          {models.state === 'fail' && <div className="ai-note err">获取模型列表失败：{models.message}</div>}
          {(models.list.length > 0 || manual) && (
            <div className="price-list">
              <div className="price-head">
                <span />
                <span>模型</span>
                <span className="r">{plan ? '' : '输入 / 输出（每百万 token）'}</span>
                <span className="r">{plan ? '计费' : '约 / 千次翻译'}</span>
              </div>
              <div className="price-body">
                {manual && (
                  <button type="button" className="price-row" onClick={() => void choose(manual)}>
                    <span className="radio" />
                    <span className="pm-name"><span className="pm-id">使用「{manual}」</span></span>
                    <span className="pm-io r muted">手动输入</span>
                    <span className="pm-call r">—</span>
                  </button>
                )}
                {shown.map((model) => (
                  <button key={model.id} type="button" className="price-row" data-current={model.id === config?.model} onClick={() => void choose(model.id)}>
                    <span className="radio">{model.id === config?.model && <span className="radio-dot" />}</span>
                    <span className="pm-name">
                      <span className="pm-id">{model.id}</span>
                      {model.id === pick && <span className="tag rec">推荐</span>}
                      {FAST_HINT.test(model.id) && <span className="tag fast">快</span>}
                    </span>
                    <span className="pm-io r">{plan ? '' : model.input === null ? <span className="muted">价格未知</span> : `${perMillion(model.input)} / ${perMillion(model.output)}`}</span>
                    <span className="pm-call r">{plan ? <span className="muted">会员额度</span> : model.perThousand === null ? '—' : money(model.perThousand)}</span>
                  </button>
                ))}
                {shown.length === 0 && !manual && <div className="empty-row">{query ? '没有匹配的模型，回车可直接使用输入的名字' : '服务没有返回模型'}</div>}
              </div>
            </div>
          )}
          <div className="ai-note">
            {plan ? '在会员额度内使用，不按 token 计费；额度用完后要等一阵或改用 API Key。' : '价格来自 models.dev，仅供参考，以服务商账单为准。翻译和统计不需要大模型，选带「快」的小模型就够用。'}
            {hidden > 0 && (
              <button type="button" className="link inline" onClick={() => setAll((value) => !value)}>
                {all ? `隐藏 ${hidden} 个非文本模型` : `显示另外 ${hidden} 个模型（向量、语音、绘图等）`}
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}

const TAG_CLASS = { 免费额度: 'free', 国内直连: 'cn', 需要代理: 'proxy', 聚合: 'agg' } as const

/** How to get a key from each provider. */
function KeyGuides() {
  const [open, setOpen] = useState<ProviderId | null>(null)
  return (
    <>
      <h3 className="ai-h3">还没有 Key？各家获取方式</h3>
      <div className="guide-list">
        {KEY_PROVIDERS.map((provider) => (
          <div key={provider.id} className="guide-row" data-open={open === provider.id}>
            <button type="button" className="guide-row__head" onClick={() => setOpen(open === provider.id ? null : provider.id)}>
              <ProviderMark id={provider.id} />
              <span className="gr-name">{provider.name}</span>
              <span className="gr-blurb">{provider.blurb}</span>
              <span className="guide-tags">{provider.tags.map((tag) => <span key={tag} className={`tag ${TAG_CLASS[tag]}`}>{tag}</span>)}</span>
              <ChevronDown size={15} className="chev" />
            </button>
            {open === provider.id && (
              <div className="guide-body">
                <ol className="guide-steps">
                  {provider.steps.map((step, index) => <li key={step}><span className="step-n">{index + 1}</span>{step}</li>)}
                </ol>
                {provider.tip && <div className="guide-tip">{provider.tip}</div>}
                <button type="button" className="primary" onClick={() => void api.openUrl(provider.keyUrl)}><ExternalLink size={14} />{provider.keyUrlLabel}</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

export function AiPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [test, setTest] = useState<{ state: 'idle' | 'run' | 'ok' | 'fail'; message?: string }>({ state: 'idle' })

  useEffect(() => {
    let alive = true
    const load = () => {
      void api.aiSettings().then((next) => {
        if (alive) setSettings(next)
      })
      void api.aiStatus().then((next) => {
        if (alive) setStatus(next)
      })
    }
    load()
    const off = api.onAiChanged(load)
    return () => {
      alive = false
      off()
    }
  }, [])

  const update: Update = useCallback(async (patch) => {
    setSettings(await api.updateAi(patch))
    setStatus(await api.aiStatus())
  }, [])

  const runTest = async () => {
    setTest({ state: 'run' })
    const result = await api.testAi()
    setTest({ state: result.ok ? 'ok' : 'fail', message: result.message })
    setStatus(await api.aiStatus())
  }

  if (!settings) return <section className="panel"><p className="empty">正在读取设置…</p></section>

  return (
    <section className="panel ai-page">
      <div className="ai-intro">
        <h2>AI 配置</h2>
        <p className="hint">便签的「翻译」和统计页的「AI 解读」用这里选的模型。配置方式与 LavaTranslate 相同；便签内容只在你点翻译或生成解读时发给这个服务。</p>
      </div>

      <div className="status-bar" data-ok={Boolean(status?.ok)}>
        <span className="dot" data-ok={Boolean(status?.ok)} />
        <span className="status-text">{status?.detail ?? '正在检查…'}</span>
        <button type="button" className="primary" disabled={test.state === 'run' || !status?.ok} onClick={() => void runTest()}>
          {test.state === 'run' ? <Loader2 size={14} className="spin" /> : <Zap size={14} />}测试一下
        </button>
      </div>
      {(test.state === 'ok' || test.state === 'fail') && (
        <div className="test-result" data-state={test.state}>
          {test.state === 'ok' ? <Check size={14} /> : <Info size={14} />}
          {test.message}
        </div>
      )}

      <div className="setting">
        <div><strong>翻译成</strong><span>自动：中文的便签译成英语，其他语言译成简体中文。翻译面板里也可以临时换。</span></div>
        <select className="input sel" value={settings.translateTarget} onChange={(event) => void update({ translateTarget: event.target.value })}>
          <option value="auto">自动</option>
          {LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
        </select>
      </div>

      <ChatGPTCard settings={settings} update={update} />
      <KeyCard key={settings.provider} settings={settings} update={update} />
      <SavedServices settings={settings} update={update} />
      <ModelList key={settings.provider} settings={settings} update={update} />
      <KeyGuides />
    </section>
  )
}
