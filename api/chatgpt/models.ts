import { RESOURCE, sessionFromRequest } from '../_chatgpt.js'

type Request = { headers: Record<string, string | string[] | undefined> }
type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (value: unknown) => void } }

export default async function handler(req: Request, res: Response) {
  try {
    const result = await sessionFromRequest(req)
    if (!result) return res.status(401).json({ error: 'ChatGPT login required' })
    const upstream = await fetch(`${RESOURCE}/models`, { headers: { authorization: `Bearer ${result.session.accessToken}`, accept: 'application/json' } })
    const body = await upstream.json().catch(() => ({}))
    if (result.setCookie) res.setHeader('Set-Cookie', result.setCookie)
    return res.status(upstream.status).json(body)
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'ChatGPT model request failed' })
  }
}
