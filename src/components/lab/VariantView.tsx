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
  type VariantResult,
  type VariantRun,
  type VariantStatus,
} from '../../services/lab/variantRace.js'
import { detectTriggers } from '../../services/unrestricted/parseltongue.js'
import { depthDirective, jailbreakSystemPrompt } from '../../services/unrestricted/prompts.js'
import { formatMoney } from '../../services/chat/sessionStats.js'
import { createSeededChat } from '../../services/chat/store.js'
import { closeLab } from '../../services/lab/labStore.js'
import { readVariantFile } from '../../services/lab/ioValidation.js'
import type { VariantTier } from '../../services/unrestricted/techniques.js'
import styles from './VariantView.module.css'

/** 变体赛跑固定使用 GODMODE + 深度指令，和自动越狱同一套系统提示词 */
const variantSystem = (translate: boolean): string =>
  `${jailbreakSystemPrompt(translate)}${depthDirective(translate)}`

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
  const translateJailbreak = useSettings((state) => state.translateJailbreakZh)
  const dismissed = useSettings((state) => state.variantRaceConfirmDismissed)

  const [query, setQuery] = useState('')
  const [tier, setTier] = useState<VariantTier>('standard')
  const [model, setModel] = useState<VariantModel>('deepseek-flash')
  const [running, setRunning] = useState(false)
  const [run, setRun] = useState<VariantRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dismissChecked, setDismissChecked] = useState(false)
  // 记录本次赛跑实际使用的系统提示词；导入/接着聊时复用它，而不是当前设置
  const [runSystem, setRunSystem] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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
      system: variantSystem(translateJailbreak),
      budget,
      maxOutputTokens: maxTokens ?? 2048,
    }),
    [apiKey, query, tier, model, budget, maxTokens, translateJailbreak]
  )
  const estimate = useMemo(() => estimateVariantRun(options), [options])
  const triggerCount = query.trim() === '' ? 0 : detectTriggers(query).length

  const execute = async () => {
    const controller = new AbortController()
    controllerRef.current = controller
    setRunSystem(options.system)
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

  /** 导出当前赛跑结果（含实际使用的系统提示词，便于之后原样接着聊） */
  const exportResults = () => {
    if (!run || run.results.length === 0) {
      return
    }
    const payload = {
      version: 1,
      type: 'variant-race',
      exportedAt: new Date().toISOString(),
      query: query.trim(),
      tier,
      model,
      budget,
      system: runSystem || variantSystem(translateJailbreak),
      results: run.results,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `variant-race-${Date.now()}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  /** 导入之前导出的赛跑结果（只回放，不重新请求，也不改动设置） */
  const importResults = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const data = readVariantFile(parsed)
      if (!data) {
        throw new Error('invalid variant file')
      }
      const raw = data.results
      const results: VariantResult[] = raw.map((item, index) => {
        const record = (item ?? {}) as Record<string, unknown>
        const status = record.status
        return {
          id: typeof record.id === 'string' ? record.id : `imported-${index}`,
          technique: typeof record.technique === 'string' ? record.technique : 'unknown',
          label: typeof record.label === 'string' ? record.label : `#${index + 1}`,
          text: typeof record.text === 'string' ? record.text : '',
          status:
            status === 'done' ||
            status === 'refused' ||
            status === 'error' ||
            status === 'skipped' ||
            status === 'aborted'
              ? status
              : 'skipped',
          score: typeof record.score === 'number' ? record.score : 0,
          durationMs: typeof record.durationMs === 'number' ? record.durationMs : 0,
          cost: typeof record.cost === 'number' ? record.cost : 0,
          error: typeof record.error === 'string' ? record.error : undefined,
          output: typeof record.output === 'string' ? record.output : undefined,
        }
      })
      const done = results.filter((result) => result.status === 'done' && result.score > 0)
      const leader = done.length
        ? done.reduce((best, result) => (result.score > best.score ? result : best))
        : null
      setRun({
        results,
        leader,
        spent: results.reduce((sum, result) => sum + result.cost, 0),
        variants: results.length,
        skipped: results.filter((result) => result.status === 'skipped').length,
      })
      setQuery(data.query)
      if (data.tier) {
        setTier(data.tier)
      }
      if (data.model) {
        setModel(data.model)
      }
      setRunSystem(data.system !== '' ? data.system : variantSystem(translateJailbreak))
      setError(null)
      showToast({ key: 'variantImported' })
    } catch {
      showToast({ key: 'variantImportFailed' })
    }
  }

  /** 把某条完成的结果带进新会话继续聊：会话级系统提示词 + 实际发送的改写文本 */
  const continueInChat = (result: VariantResult) => {
    if (!result.output) {
      return
    }
    const trimmed = query.trim().slice(0, 24)
    const id = createSeededChat({
      title: t('variantChatTitle', { query: trimmed || t('variantTitle') }),
      systemPrompt: runSystem || variantSystem(translateJailbreak),
      userText: result.text,
      assistantText: result.output,
      model: runModel,
    })
    if (id) {
      closeLab()
      showToast({ key: 'variantContinued' })
    } else {
      showToast({ key: 'variantImportFailed' })
    }
  }

  // 接着聊时用本次赛跑的模型（导入结果时已按文件恢复）
  const runModel = model
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
            <div className={styles.toolbar}>
              <Button
                variant="outlined"
                size="s"
                disabled={running || results.length === 0}
                onClick={exportResults}
              >
                {t('labExport')}
              </Button>
              <Button
                variant="outlined"
                size="s"
                disabled={running}
                onClick={() => fileRef.current?.click()}
              >
                {t('labImport')}
              </Button>
              <input
                ref={fileRef}
                className={styles.hiddenInput}
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) {
                    void importResults(file)
                  }
                }}
              />
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
                    {result.status === 'done' && result.output ? (
                      <Button size="s" disabled={running} onClick={() => continueInChat(result)}>
                        {t('variantContinue')}
                      </Button>
                    ) : null}
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
