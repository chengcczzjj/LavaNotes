import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Check, Copy, Languages, Loader2, Replace, Settings2, X } from 'lucide-react'
import { LANGUAGES } from '@shared/ai'
import type { TranslateEvent } from '@shared/translate'

export interface TranslateSource {
  mode: 'doc' | 'selection'
  segments: Array<{ index: number; text: string }>
}

interface TranslatePanelProps {
  source: TranslateSource
  /** Combine translated segments into plain text (keeps blank lines of a selection). */
  plainText(translations: ReadonlyMap<number, string>): string
  /** Put the translation into the note; returns an error message when it no longer fits. */
  onApply(action: 'replace' | 'insert', translations: ReadonlyMap<number, string>): string | null
  onClose(): void
}

type Status = 'running' | 'done' | 'error'

let nextRequestId = 1

export function TranslatePanel({ source, plainText, onApply, onClose }: TranslatePanelProps) {
  const [target, setTarget] = useState('auto')
  const [status, setStatus] = useState<Status>('running')
  const [results, setResults] = useState<Map<number, string>>(() => new Map())
  const [message, setMessage] = useState<string | null>(null)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [meta, setMeta] = useState<{ targetName: string; model: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const requestRef = useRef(0)

  // A new source remounts the panel (keyed by the caller); a new target restarts here.
  const changeTarget = (value: string) => {
    setTarget(value)
    setStatus('running')
    setResults(new Map())
    setMessage(null)
    setNeedsSetup(false)
  }

  useEffect(() => {
    const requestId = nextRequestId++
    requestRef.current = requestId
    const off = window.lavaNote.onTranslateEvent((id, event: TranslateEvent) => {
      if (id !== requestId) return
      if (event.type === 'start') setMeta({ targetName: event.targetName, model: event.model })
      else setResults((current) => new Map(current).set(event.index, event.text))
    })
    void window.lavaNote.translate(requestId, { segments: source.segments, target }).then((result) => {
      if (requestRef.current !== requestId) return
      if (result.ok) {
        setStatus('done')
      } else {
        setStatus('error')
        setMessage(result.message ?? '翻译失败')
        setNeedsSetup(result.needsSetup === true)
      }
    })
    return () => {
      off()
      window.lavaNote.cancelTranslate(requestId)
    }
  }, [source, target])

  const complete = status === 'done' && results.size > 0
  const rows = useMemo(() => source.segments.map((segment) => ({
    index: segment.index,
    text: results.get(segment.index),
    source: segment.text,
  })), [results, source])

  const apply = (action: 'replace' | 'insert') => {
    const problem = onApply(action, results)
    if (problem) setMessage(problem)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainText(results))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setMessage('复制失败，可以手动选中译文复制。')
    }
  }

  return (
    <div className="note-translate" role="dialog" aria-label="翻译" onMouseDown={(event) => event.stopPropagation()}>
      <header className="note-translate__head">
        <Languages size={14} />
        <span>{source.mode === 'selection' ? '翻译选中' : '翻译全文'}</span>
        <select
          value={target}
          title="译成哪种语言（自动：中文译成英语，其他译成中文）"
          onChange={(event) => changeTarget(event.target.value)}
        >
          <option value="auto">{meta && target === 'auto' ? `自动 · ${meta.targetName}` : '自动'}</option>
          {LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
        </select>
        <span className="note-translate__spacer" />
        {status === 'running' && <Loader2 size={13} className="note-spin" aria-label="翻译中" />}
        <button type="button" className="note-translate__close" title="关闭" aria-label="关闭翻译" onClick={onClose}><X size={14} /></button>
      </header>

      <div className="note-translate__body" aria-live="polite">
        {rows.map((row) => (
          <p key={row.index} data-pending={row.text === undefined}>{row.text ?? row.source}</p>
        ))}
      </div>

      {message && (
        <div className="note-translate__message" role="status">
          <span>{message}</span>
          {needsSetup && (
            <button type="button" onClick={() => window.lavaNote.openManager('ai')}><Settings2 size={12} />AI 配置</button>
          )}
        </div>
      )}

      <footer className="note-translate__actions">
        <button type="button" disabled={!complete} title={source.mode === 'selection' ? '用译文替换选中的文字' : '用译文替换全文（保留列表、勾选和表格）'} onClick={() => apply('replace')}>
          <Replace size={13} />替换
        </button>
        <button type="button" disabled={!complete} title="把译文插在原文下方" onClick={() => apply('insert')}>
          <ArrowDownToLine size={13} />插在下方
        </button>
        <button type="button" disabled={results.size === 0} title="复制译文" onClick={() => void copy()}>
          {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : '复制'}
        </button>
        {meta && <small title="当前模型">{meta.model}</small>}
      </footer>
    </div>
  )
}
