import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A local stand-in for an OpenAI-compatible service, for the smoke test only.
 * It has no Responses endpoint (so the engine falls back to Chat Completions,
 * like most providers), streams Server-Sent Events, translates each segment
 * as "[EN] <source>" and answers the statistics prompt with a fixed reading.
 */
export interface MockModelServer {
  baseUrl: string
  requests: string[]
  close(): Promise<void>
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => resolve(body))
  })
}

function stream(response: ServerResponse, text: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const chunks = text.match(/[\s\S]{1,17}/g) ?? []
  for (const piece of chunks) {
    response.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'mock-model', choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`)
  }
  response.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
  response.end('data: [DONE]\n\n')
}

function answer(system: string, user: string): string {
  if (system.startsWith('You translate')) {
    const lines: string[] = []
    for (const line of user.split('\n')) {
      if (!line.startsWith('{')) continue
      const segment = JSON.parse(line) as { i: number; s: string }
      lines.push(JSON.stringify({ i: segment.i, t: `[EN] ${segment.s}` }))
    }
    return lines.join('\n')
  }
  const codes = [...new Set(user.match(/\bN\d+\b/g) ?? [])]
  return `\`\`\`json\n${JSON.stringify({
    headline: '冒烟测试的一周',
    summary: '写了几张测试便签，撕下和废弃了几张。',
    topics: [{ name: '测试', notes: codes.slice(0, 3), desc: '冒烟测试写下的便签' }, { name: '其他', notes: codes.slice(3) }],
    rhythm: '都在同一个下午写下。',
    insights: ['勾选清单当场就勾掉了。'],
    suggestions: ['把剩下的便签处理掉。'],
    stale: codes.slice(0, 1).map((code) => ({ note: code, reason: '还没动过' })),
  })}\n\`\`\``
}

export async function startMockModelServer(): Promise<MockModelServer> {
  const requests: string[] = []
  const server = createServer(async (request, response) => {
    const url = request.url ?? ''
    requests.push(`${request.method} ${url}`)
    if (request.method === 'GET' && url.endsWith('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }))
      return
    }
    if (request.method === 'POST' && url.endsWith('/chat/completions')) {
      const body = JSON.parse(await readBody(request)) as { messages: Array<{ role: string; content: string }> }
      const system = body.messages.find((message) => message.role === 'system')?.content ?? ''
      const user = body.messages.find((message) => message.role === 'user')?.content ?? ''
      stream(response, answer(system, user))
      return
    }
    await readBody(request)
    response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: `unknown url ${url}` } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
