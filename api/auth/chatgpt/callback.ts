import { exchangeCode, cookie, expiredCookie, json, originFor, parseCookies, seal, verifyState, type ChatGPTSession } from '../../_chatgpt.js'

type Request = { headers: Record<string, string | string[] | undefined>; query?: Record<string, string | string[] | undefined> }
type Response = { setHeader: (name: string, value: string | string[]) => void; redirect: (status: number, url: string) => void; status: (code: number) => { json: (value: unknown) => void } }

export default async function handler(req: Request, res: Response) {
  try {
    const query = req.query ?? {}
    const state = typeof query.state === 'string' ? query.state : ''
    const code = typeof query.code === 'string' ? query.code : ''
    const cookies = parseCookies(typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined)
    const pending = cookies.chatgpt_oauth
    const transaction = pending ? verifyState(pending, state) : null
    if (!transaction || !code) {
      return json(res, 400, { error: 'Invalid or expired ChatGPT sign-in state' })
    }
    const returnedClientId = typeof query.client_id === 'string' ? query.client_id : transaction.clientId
    const clientId = transaction.clientId === 'dynamic_agent_client' ? returnedClientId : transaction.clientId
    if (!clientId || clientId === 'dynamic_agent_client' || (transaction.clientId !== 'dynamic_agent_client' && returnedClientId !== transaction.clientId)) {
      return json(res, 400, { error: 'ChatGPT did not return a valid issued client id' })
    }
    const body = await exchangeCode(new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: transaction.verifier,
      redirect_uri: transaction.redirectUri,
      resource: 'https://api.openai.com/v1',
    }))
    const scope = typeof body.scope === 'string' ? body.scope : ''
    if (!scope.split(/\s+/).includes('chatgpt.tokens.use.direct')) {
      return json(res, 403, { error: 'ChatGPT plan usage permission was not granted' })
    }
    if (typeof body.id_token !== 'string' || typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
      return json(res, 502, { error: 'OpenAI returned an incomplete ChatGPT session' })
    }
    const session: ChatGPTSession = {
      accessToken: body.access_token,
      ...(typeof body.refresh_token === 'string' ? { refreshToken: body.refresh_token } : {}),
      expiresAt: Date.now() + body.expires_in * 1000,
      clientId,
      scope,
    }
    res.setHeader('Set-Cookie', [
      cookie('chatgpt_session', seal(session), 60 * 60 * 24 * 30),
      expiredCookie('chatgpt_oauth'),
    ])
    res.redirect(302, transaction.returnTo || '/c/new?chatgpt=connected')
  } catch (error) {
    json(res, 502, { error: error instanceof Error ? error.message : 'ChatGPT sign-in failed' })
  }
}
