import { expiredCookie, json } from '../../_chatgpt.js'

type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (value: unknown) => void } }

export default function handler(_req: unknown, res: Response) {
  res.setHeader('Set-Cookie', expiredCookie('chatgpt_session'))
  return json(res, 200, { connected: false })
}
