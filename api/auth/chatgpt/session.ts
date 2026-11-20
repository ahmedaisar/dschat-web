import { json, sessionFromRequest } from '../../_chatgpt.js'

type Request = { headers: Record<string, string | string[] | undefined> }
type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (value: unknown) => void } }

export default async function handler(req: Request, res: Response) {
  try {
    const result = await sessionFromRequest(req)
    if (!result) return json(res, 200, { connected: false })
    if (result.setCookie) res.setHeader('Set-Cookie', result.setCookie)
    return json(res, 200, { connected: true, expiresAt: result.session.expiresAt, scope: result.session.scope })
  } catch {
    return json(res, 200, { connected: false })
  }
}
