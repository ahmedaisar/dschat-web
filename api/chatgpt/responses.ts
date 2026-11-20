import { RESPONSES_ENDPOINT, sessionFromRequest } from '../_chatgpt.js'

type Request = { headers: Record<string, string | string[] | undefined>; method?: string; body?: unknown }
type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (value: unknown) => void; send: (value: unknown) => void }; send: (value: unknown) => void; write: (value: string) => void; writeHead: (status: number, headers?: Record<string, string>) => void; end: () => void }

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' })
  try {
    const result = await sessionFromRequest(req)
    if (!result) return res.status(401).json({ error: 'ChatGPT login required' })
    const upstream = await fetch(RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${result.session.accessToken}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(req.body),
    })
    if (result.setCookie) res.setHeader('Set-Cookie', result.setCookie)
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text()
      res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
      return res.status(upstream.status).send(text)
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' })
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      // Vercel's Node response accepts string chunks; preserve SSE framing.
      res.write(decoder.decode(chunk.value, { stream: true }))
    }
    res.end()
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'ChatGPT request failed' })
  }
}
