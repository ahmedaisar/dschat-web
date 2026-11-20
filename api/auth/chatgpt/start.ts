import { randomBytes, createHash } from 'node:crypto'
import { AUTHORIZATION_ENDPOINT, RESOURCE, SCOPES, cookie, json, originFor, seal } from '../../_chatgpt.js'

type Request = { headers: Record<string, string | string[] | undefined>; query?: Record<string, string | string[] | undefined> }
type Response = { setHeader: (name: string, value: string) => void; redirect: (status: number, url: string) => void; status: (code: number) => { json: (value: unknown) => void } }

export default function handler(req: Request, res: Response) {
  try {
    // OpenAI's documented open-source flow accepts dynamic_agent_client for
    // first registration and returns the issued client id in the callback.
    const clientId = process.env.OPENAI_SIWC_CLIENT_ID || 'dynamic_agent_client'
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const returnTo = typeof req.query?.return_to === 'string' && req.query.return_to.startsWith('/') ? req.query.return_to : '/c/new'
    const redirectUri = `${originFor(req)}/api/auth/chatgpt/callback`
    const url = new URL(AUTHORIZATION_ENDPOINT)
    url.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      resource: RESOURCE,
      state,
      nonce: randomBytes(32).toString('base64url'),
      code_challenge_method: 'S256',
      code_challenge: challenge,
    }).toString()
    res.setHeader('Set-Cookie', cookie('chatgpt_oauth', seal({ state, verifier, returnTo, clientId, redirectUri }), 600))
    res.redirect(302, url.toString())
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unable to start ChatGPT login' })
  }
}
