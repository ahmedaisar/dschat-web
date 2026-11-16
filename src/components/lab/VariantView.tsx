import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { copyText } from '../../utils/clipboard.js'
import { showToast } from '../base/toastState.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import {
  setVariantRaceBudget,
  setVariantRaceConfirmDismissed,
  useSettings,
} from '../../services/settings.js'
import {
  estimateVariantRun,
  runVariantRace,
  type VariantModel,
  type VariantRun,
  type VariantStatus,
} from '../../services/lab/variantRace.js'
import { detectTriggers } from '../../services/unrestricted/parseltongue.js'
import { DEPTH_DIRECTIVE, GODMODE_SYSTEM_PROMPT } from '../../services/unrestricted/prompts.js'
import { formatMoney } from '../../services/chat/sessionStats.js'
import type { VariantTier } from '../../services/unrestricted/techniques.js'
import styles from './VariantView.module.css'

/** 变体赛跑固定使用 GODMODE + 深度指令，和自动越狱同一套系统提示词 */
const VARIANT_SYSTEM = `${GODMODE_SYSTEM_PROMPT}${DEPTH_DIRECTIVE}`

const formatDuration = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

/** 状态只显示需要解释的几种，完成态用分数表达 */
const statusLabelKey = (status: VariantStatus) =>
  status === 'skipped'
    ? ('variantSkipped' as const)
    : status === 'refused'
      ? ('variantRefused' as const)
      : status === 'error'
        ? ('variantError' as const)
        : status === 'aborted'
          ? ('variantAborted' as const)
          : null

/** 变体赛跑：按档位生成改写变体，并发请求后按综合分选出最佳回复。 */
export const VariantView = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey) ?? ''
  const budget = useSettings((state) => state.variantRaceBudget)
  const maxTokens = useSettings((state) => state.maxTokens)
  const dismissed = useSettings((state) => state.variantRaceConfirmDismissed)

  const [query, setQuery] = useState('')
  const [tier, setTier] = useState<VariantTier>('standard')
  const [model, setModel] = useState<VariantModel>('deepseek-flash')
  const [running, setRunning] = useState(false)
  const [run, setRun] = useState<VariantRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dismissChecked, setDismissChecked] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      controllerRef.current?.abort()
    },
    []
  )

  const options = useMemo(
    () => ({
      apiKey,
      query: query.trim(),
      tier,
      model,
      system: VARIANT_SYSTEM,
      budget,
      maxOutputTokens: maxTokens ?? 2048,
    }),
    [apiKey, query, tier, model, budget, maxTokens]
  )
  const estimate = useMemo(() => estimateVariantRun(options), [options])
  const triggerCount = query.trim() === '' ? 0 : detectTriggers(query).length

  const execute = async () => {
    const controller = new AbortController()
    controllerRef.current = controller
    setRunning(true)
    setError(null)
    setRun(null)
    try {
      const final = await runVariantRace(options, {
        onUpdate: setRun,
        signal: controller.signal,
      })
      setRun(final)
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
      setRunning(false)
    }
  }

  const start = () => {
    if (!apiKey.trim()) {
      showToast({ key: 'variantNeedApiKey' })
      return
    }
    if (query.trim() === '') {
      showToast({ key: 'variantNeedQuery' })
      return
    }
    if (estimate.affordable === 0) {
      showToast({ key: 'variantBudgetTooLow', params: { cost: formatMoney(estimate.perRequest) } })
      return
    }
    if (dismissed) {
      void execute()
      return
    }
    setConfirmOpen(true)
  }

  const confirmStart = () => {
    if (dismissChecked) {
      setVariantRaceConfirmDismissed(true)
    }
    setConfirmOpen(false)
    void execute()
  }

  const stop = () => {
    controllerRef.current?.abort()
  }

  const copy = async (text: string) => {
    const ok = await copyText(text)
    showToast(ok ? { key: 'copied' } : { key: 'copyFailed' })
  }

  const results = run?.results ?? []
  const leader = run?.leader ?? null

  return (
    <div className={styles.variant}>
      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.headRow}>
            <div className={styles.heading}>
              <div className={styles.title}>{t('variantTitle')}</div>
              <div className={styles.subtitle}>{t('variantSubtitle')}</div>
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>{t('variantQuery')}</span>
            <textarea
              className={styles.textarea}
              rows={4}
              value={query}
              disabled={running}
              placeholder={t('variantQueryPlaceholder')}
              onChange={(event) => setQuery(event.target.value)}
            />
            {triggerCount > 0 ? null : (
              <span className={styles.hint}>{t('variantNoTriggers')}</span>
            )}
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <span className={styles.label}>{t('variantTier')}</span>
              <Select<VariantTier>
                ariaLabel={t('variantTier')}
                value={tier}
                disabled={running}
                options={[
                  { value: 'light', label: t('variantTierLight') },
                  { value: 'standard', label: t('variantTierStandard') },
                  { value: 'heavy', label: t('variantTierHeavy') },
                ]}
                onChange={setTier}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>{t('variantModel')}</span>
              <Select<VariantModel>
                ariaLabel={t('variantModel')}
                value={model}
                disabled={running}
                options={[
                  { value: 'deepseek-flash', label: 'deepseek-flash' },
                  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
                ]}
                onChange={setModel}
              />
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>{t('variantBudget')}</span>
            <input
              className={styles.input}
              type="number"
              min={0.01}
              step={0.01}
              value={budget}
              disabled={running}
              onChange={(event) => setVariantRaceBudget(Number(event.target.value) || 0.01)}
            />
            <span className={styles.hint}>{t('variantBudgetDescription')}</span>
          </div>

          <div className={styles.estimate}>
            <span>
              {t('variantEstimate', {
                variants: estimate.variants,
                perRequest: formatMoney(estimate.perRequest),
                worst: formatMoney(estimate.worstCase),
              })}
            </span>
            <span>{t('variantAffordable', { count: estimate.affordable })}</span>
          </div>

          {run ? (
            <div className={styles.progress}>
              {t('variantSpent', {
                cost: formatMoney(run.spent),
                budget: formatMoney(budget),
              })}
            </div>
          ) : null}

          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.actions}>
            {running ? (
              <Button variant="dangerOutlined" size="m" block onClick={stop}>
                {t('variantStop')}
              </Button>
            ) : (
              <Button size="m" block onClick={start}>
                {t('variantRun')}
              </Button>
            )}
          </div>
        </section>

        <section className={styles.results}>
          {results.length === 0 ? (
            <div className={styles.empty}>{running ? t('variantRunning') : t('variantEmpty')}</div>
          ) : (
            results.map((result) => {
              const label = statusLabelKey(result.status)
              const isWinner = leader?.id === result.id
              return (
                <article
                  key={result.id}
                  className={clsx(styles.card, isWinner && styles.cardWinner)}
                >
                  <div className={styles.cardHead}>
                    <span className={styles.cardTitle}>{result.label}</span>
                    <span className={styles.badge}>{result.technique}</span>
                    {isWinner ? (
                      <span className={clsx(styles.badge, styles.badgeWinner)}>
                        {t('variantWinner')}
                      </span>
                    ) : null}
                    {result.status === 'done' || result.score > 0 ? (
                      <span className={clsx(styles.badge, styles.badgeScore)}>
                        {`${t('variantScore')} ${result.score}`}
                      </span>
                    ) : null}
                    {label ? <span className={styles.badge}>{t(label)}</span> : null}
                    {result.status === 'skipped' ? null : (
                      <span className={styles.cardMeta}>
                        {formatDuration(result.durationMs)} · {formatMoney(result.cost)}
                      </span>
                    )}
                  </div>
                  {result.error ? <div className={styles.cardError}>{result.error}</div> : null}
                  <pre className={styles.pre}>{result.output ?? result.text}</pre>
                  <div className={styles.cardActions}>
                    <Button
                      variant="outlined"
                      size="s"
                      disabled={!result.output}
                      onClick={() => void copy(result.output ?? '')}
                    >
                      {t('variantCopy')}
                    </Button>
                  </div>
                </article>
              )
            })
          )}
        </section>
      </div>

      {confirmOpen ? (
        <Modal
          title={t('variantConfirmTitle')}
          closable
          onClose={() => setConfirmOpen(false)}
          className={styles.confirm}
          footer={
            <div className={styles.confirmActions}>
              <Button variant="outlined" size="m" onClick={() => setConfirmOpen(false)}>
                {t('variantConfirmCancel')}
              </Button>
              <Button size="m" onClick={confirmStart}>
                {t('variantConfirmStart')}
              </Button>
            </div>
          }
        >
          <div className={styles.confirmBody}>
            {t('variantConfirmBody', {
              variants: estimate.affordable,
              perRequest: formatMoney(estimate.perRequest),
              worst: formatMoney(estimate.affordable * estimate.perRequest),
              budget: formatMoney(budget),
            })}
          </div>
          <div className={styles.confirmDismiss}>
            <Switch
              checked={dismissChecked}
              onChange={setDismissChecked}
              label={t('variantConfirmDismiss')}
            />
            <span>{t('variantConfirmDismiss')}</span>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
