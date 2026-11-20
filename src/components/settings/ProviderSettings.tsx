import { useEffect, useState } from 'react'
import { showToast } from '../base/toastState.js'
import { Button } from '../base/Button.js'
import { Switch } from '../base/Switch.js'
import { useTranslate } from '../../i18n/index.js'
import {
  normalizeCustomProvider,
  setCustomProvider,
  setProvider,
  useSettings,
} from '../../services/settings.js'
import {
  fetchOpenAICompatibleModels,
  verifyOpenAICompatible,
} from '../../services/api/openaiCompatible.js'
import { ApiError } from '../../services/api/client.js'
import { getChatGPTSession, logoutChatGPT, startChatGPTLogin } from '../../services/api/chatgpt.js'
import {
  classifyApiError,
  isAgenticHarnessError,
} from '../../services/api/errors.js'
import styles from './ProviderSettings.module.css'

const EMPTY = { name: '', baseURL: '', apiKey: '', model: '' }
const OPENAI_PRESET = {
  name: 'OpenAI',
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
}
const MODEL_LIST_ID = 'custom-provider-model-list'

/**
 * 自定义 OpenAI 兼容提供商（BYOK）的设置单元：
 * 配置（名称 / Base URL / Key / 模型）保存到本机；启用后请求走该端点，
 * 内置 DeepSeek 配置不受影响，可随时切回。
 */
export const ProviderSettings = () => {
  const t = useTranslate()
  const provider = useSettings((state) => state.provider)
  const saved = useSettings((state) => state.customProvider)
  const enabled = provider === 'custom'
  const [draft, setDraft] = useState(() => saved ?? EMPTY)
  const [models, setModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [chatGPTConnected, setChatGPTConnected] = useState(false)
  const [chatGPTBusy, setChatGPTBusy] = useState(false)

  const update = (patch: Partial<typeof EMPTY>) => {
    setDraft((previous) => {
      const next = { ...previous, ...patch }
      // 配置完整时顺手落盘（切回页面时能看到已保存的值）；不完整时只保留草稿
      const normalized = normalizeCustomProvider(next)
      if (normalized) {
        setCustomProvider(normalized)
      }
      return next
    })
  }

  const normalized = normalizeCustomProvider(draft)
  const complete = normalized !== null

  useEffect(() => {
    void getChatGPTSession().then((session) => setChatGPTConnected(session.connected))
  }, [])

  const useOpenAIPreset = () => update(OPENAI_PRESET)

  const toggle = (value: boolean) => {
    if (value) {
      if (complete) {
        setCustomProvider(normalized)
        setProvider('custom')
      }
    } else {
      setProvider('deepseek')
    }
  }

  const failureMessage = (cause: unknown): string => {
    if (isAgenticHarnessError(cause)) {
      return t('agenticHarnessOnlyModel')
    }
    const classified = classifyApiError(cause)
    if (classified === 'unauthorized') {
      return t('apiKeyInvalid')
    }
    if (classified === 'rateLimited') {
      return t('replyRateLimitedCustom')
    }
    if (classified === 'insufficientBalance') {
      return t('replyInsufficientBalance')
    }
    if (cause instanceof ApiError) {
      return cause.message
    }
    return cause instanceof Error ? cause.message : String(cause)
  }

  const test = async () => {
    if (!normalized || testing) {
      return
    }
    setTesting(true)
    try {
      await verifyOpenAICompatible(normalized)
      showToast({ key: 'customProviderTestOk' })
    } catch (error) {
      showToast({ key: 'customProviderTestFailed', params: { message: failureMessage(error) } })
    } finally {
      setTesting(false)
    }
  }

  const fetchModels = async () => {
    if (!normalized || fetching) {
      return
    }
    setFetching(true)
    try {
      const ids = await fetchOpenAICompatibleModels(normalized)
      if (ids.length === 0) {
        showToast({ key: 'customProviderFetchModelsFailed' })
        return
      }
      setModels(ids)
      showToast({ key: 'customProviderFetchModelsOk', params: { count: ids.length } })
    } catch {
      showToast({ key: 'customProviderFetchModelsFailed' })
    } finally {
      setFetching(false)
    }
  }

  const remove = () => {
    setCustomProvider(null)
    setDraft(EMPTY)
    setModels([])
    showToast({ key: 'customProviderRemoved' })
  }

  const connectChatGPT = () => {
    startChatGPTLogin()
  }

  const disconnectChatGPT = async () => {
    setChatGPTBusy(true)
    try {
      await logoutChatGPT()
      setChatGPTConnected(false)
      if (provider === 'chatgpt') {
        setProvider('deepseek')
      }
    } finally {
      setChatGPTBusy(false)
    }
  }

  return (
    <div className={styles.block}>
      <div className={styles.text}>
        <div className={styles.title}>{t('customProviderTitle')}</div>
        <div className={styles.description}>{t('customProviderDescription')}</div>
      </div>
      <div className={styles.toggle}>
        <Switch
          checked={enabled}
          disabled={!enabled && !complete}
          onChange={toggle}
          label={t('customProviderEnable')}
        />
      </div>
      <div className={styles.form}>
        <div className={styles.preset}>
          <Button variant="outlined" size="s" onClick={useOpenAIPreset}>
            {t('openaiUsePreset')}
          </Button>
          <span>{t('openaiPresetDescription')}</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('customProviderName')}</span>
          <input
            className={styles.input}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('customProviderNamePlaceholder')}
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('customProviderBaseUrl')}</span>
          <input
            className={styles.input}
            type="text"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            inputMode="url"
            placeholder={t('customProviderBaseUrlPlaceholder')}
            value={draft.baseURL}
            onChange={(event) => update({ baseURL: event.target.value })}
          />
          <span className={styles.fieldHint}>{t('customProviderBaseUrlDescription')}</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('customProviderApiKey')}</span>
          <input
            className={styles.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('customProviderApiKeyPlaceholder')}
            value={draft.apiKey}
            onChange={(event) => update({ apiKey: event.target.value })}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('customProviderModel')}</span>
          <input
            className={styles.input}
            type="text"
            autoComplete="off"
            spellCheck={false}
            list={MODEL_LIST_ID}
            placeholder={t('customProviderModelPlaceholder')}
            value={draft.model}
            onChange={(event) => update({ model: event.target.value })}
          />
          <datalist id={MODEL_LIST_ID}>
            {models.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </div>
        <div className={styles.row}>
          <Button variant="outlined" size="s" disabled={!complete || fetching} onClick={() => void fetchModels()}>
            {fetching ? t('customProviderFetchModels') : t('customProviderFetchModels')}
          </Button>
          <Button variant="outlined" size="s" disabled={!complete || testing} onClick={() => void test()}>
            {testing ? t('customProviderTesting') : t('customProviderTest')}
          </Button>
          {saved ? (
            <Button variant="dangerOutlined" size="s" onClick={remove}>
              {t('customProviderRemove')}
            </Button>
          ) : null}
        </div>
        <div className={styles.note}>{t('customProviderNotes')}</div>
        <div className={styles.subscriptionNotice}>
          <strong>{t('chatgptSubscriptionTitle')}</strong>
          <span>{t('chatgptSubscriptionDescription')}</span>
          <div className={styles.row}>
            {chatGPTConnected ? (
              <>
                <Button
                  size="s"
                  disabled={provider === 'chatgpt'}
                  onClick={() => setProvider('chatgpt')}
                >
                  {t('chatgptUsePlan')}
                </Button>
                <Button
                  variant="outlined"
                  size="s"
                  disabled={chatGPTBusy}
                  onClick={() => void disconnectChatGPT()}
                >
                  {t('chatgptSignOut')}
                </Button>
              </>
            ) : (
              <Button size="s" onClick={connectChatGPT}>
                {t('chatgptSignIn')}
              </Button>
            )}
          </div>
          <a href="https://developers.openai.com/siwc" target="_blank" rel="noreferrer">
            {t('chatgptSubscriptionLearnMore')}
          </a>
        </div>
      </div>
    </div>
  )
}
