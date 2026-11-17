import clsx from 'clsx'
import { useEffect, useMemo, useReducer, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { TranslationKey } from '../../i18n/index.js'
import { readLiveMetrics, subscribeLiveTick, useLiveStats } from '../../services/chat/liveStats.js'
import {
  aggregateSession,
  estimateCost,
  estimateTokens,
  formatMoney,
  formatTokens,
} from '../../services/chat/sessionStats.js'
import { setSessionCompression, useChatStore } from '../../services/chat/store.js'
import { compressSession } from '../../services/chat/compression.js'
import { contextWindowFor, useContextUsage } from '../../services/chat/contextUsage.js'
import {
  effectiveContextTokens,
  pressurePercent,
  reserveGeometry,
} from '../../services/chat/contextPressure.js'
import { useSettings } from '../../services/settings.js'
import { syncDailyUsageDate, useDailyUsage } from '../../services/chat/dailyUsage.js'
import { modelLabel } from '../../services/api/models.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { Modal } from '../base/Modal.js'
import { Switch } from '../base/Switch.js'
import { closeStats, useStatsDialog } from './statsDialogState.js'
import styles from './StatsDialog.module.css'

/**
 * 会话统计弹窗：本次生成的实时指标、整个会话的累计用量，
 * 以及按官方单价估算的费用。金额与 token 的格式化统一走 sessionStats。
 */

/** 首 token：1 秒以内按毫秒展示，超过按两位小数秒 */
const formatFirstToken = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`

/** 秒级时长：10 秒以内保留一位小数，更长只取整秒 */
const formatSeconds = (ms: number): string => {
  const seconds = ms / 1000
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}

/** 百分比：保留一位小数 */
const formatPercent = (rate: number): string => `${(rate * 100).toFixed(1)}%`

/** 空会话或还没有回复没有任何金额可算 */
const NO_VALUE = '—'

type MetricItem = { key: TranslationKey; value: string }

export const StatsDialog = () => {
  const open = useStatsDialog((state) => state.open)
  return open ? <StatsContent /> : null
}

const StatsContent = () => {
  const t = useTranslate()
  const activeId = useChatStore((state) => state.activeId)
  const session = useChatStore((state) =>
    activeId ? (state.sessionCache[activeId] ?? null) : null
  )
  const totals = useMemo(() => aggregateSession(session), [session])
  const [holiday, setHoliday] = useState(false)
  const [discount, setDiscount] = useState(true)
  const [compressing, setCompressing] = useState(false)
  const locale = useSettings((state) => state.locale)
  const apiKey = useSettings((state) => state.apiKey) ?? ''
  const maxTokens = useSettings((state) => state.maxTokens)
  const model = useSettings((state) => state.model)
  const usage = useContextUsage((state) => (activeId ? state.byId[activeId] : undefined))
  // 与输入框圆环同一套压力口径：压缩后按摘要节省量折算
  const contextTokens = effectiveContextTokens(
    usage?.tokens ?? 0,
    usage?.at ?? 0,
    session?.compression
  )
  const contextWindow = contextWindowFor(model)
  const reserve = reserveGeometry(contextWindow, maxTokens ?? 8192)
  const cost = useMemo(
    () => estimateCost(session, { holiday, voiceDiscount: discount }),
    [session, holiday, discount]
  )
  const daily = useDailyUsage()
  useEffect(() => {
    syncDailyUsageDate()
  }, [])
  const run = useLiveStats((state) => state.run)
  const active = run?.active ?? false
  // 生成中每秒重渲染一次，让用时、速度、估算是新值
  const [, tick] = useReducer((value: number) => value + 1, 0)
  useEffect(() => subscribeLiveTick(active, tick), [active])

  // 只展示属于当前会话的那一次生成；新对话没有会话时也允许展示
  const liveRun = run && (!session || run.sessionId === session.id) ? run : null
  const liveMetrics = liveRun ? readLiveMetrics(liveRun) : null
  const hasUsage =
    session?.messages.some(
      (message) => message.role === 'assistant' && message.usage !== undefined
    ) ?? false

  const liveItems: MetricItem[] = liveMetrics
    ? [
        { key: 'statsOutput', value: formatTokens(liveMetrics.outputTokens) },
        { key: 'statsInput', value: formatTokens(liveMetrics.inputTokens) },
        {
          key: 'statsFirstToken',
          value:
            liveMetrics.firstTokenMs === null
              ? NO_VALUE
              : formatFirstToken(liveMetrics.firstTokenMs),
        },
        {
          key: 'statsCacheHit',
          value: liveMetrics.cacheRate === null ? NO_VALUE : formatPercent(liveMetrics.cacheRate),
        },
        { key: 'statsSpeed', value: `${liveMetrics.tps.toFixed(1)} ${t('statsUnitSpeed')}` },
        { key: 'statsElapsed', value: formatSeconds(liveMetrics.elapsed) },
      ]
    : []

  const sessionItems: MetricItem[] = [
    { key: 'statsRounds', value: String(totals.rounds) },
    { key: 'dailyUsageTokens', value: formatTokens(daily.totalTokens) },
    { key: 'dailyUsageCost', value: formatMoney(daily.cost) },
    { key: 'statsSteps', value: String(totals.steps) },
    { key: 'statsSpeed', value: `${totals.outputSpeed.toFixed(1)} ${t('statsUnitSpeed')}` },
    {
      key: 'statsFirstToken',
      value: totals.firstTokenAvg === null ? NO_VALUE : formatFirstToken(totals.firstTokenAvg),
    },
    { key: 'statsModelTime', value: formatSeconds(totals.modelTime) },
    {
      key: 'statsCacheHit',
      value: totals.cacheRate === null ? NO_VALUE : formatPercent(totals.cacheRate),
    },
    {
      key: 'statsInputUncached',
      value: `${formatTokens(totals.inputUncached)} ${t('statsUnitTokens')}`,
    },
    {
      key: 'statsCacheRead',
      value: `${formatTokens(totals.cacheRead)} ${t('statsUnitTokens')}`,
    },
    {
      key: 'statsCacheWrite',
      value: `${formatTokens(totals.cacheWrite)} ${t('statsUnitTokens')}`,
    },
    {
      key: 'statsOutput',
      value: `${formatTokens(totals.outputTokens)} ${t('statsUnitTokens')}`,
    },
  ]

  return (
    <Modal
      title={t('statsTitle')}
      closable
      onClose={closeStats}
      className={styles.dialog}
      mainClassName={styles.main}
    >
      {liveItems.length > 0 ? (
        <section className={styles.section}>
          <div className={styles.sectionTitle}>{t('statsLive')}</div>
          <div className={styles.liveRow}>
            {liveItems.map((item) => (
              <div key={item.key} className={styles.liveItem}>
                <span className={styles.liveLabel}>{t(item.key)}</span>
                <span className={styles.liveValue}>{item.value}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionTitle}>{t('statsSession')}</div>
        {session && hasUsage ? (
          <div className={styles.grid}>
            {sessionItems.map((item) => (
              <div key={item.key} className={styles.metric}>
                <span className={styles.metricLabel}>{t(item.key)}</span>
                <span className={styles.metricValue}>{item.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>{t('statsEmpty')}</div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>{t('compressTitle')}</div>
        <div className={styles.compressInfo}>
          {t('compressPressureInfo', {
            used: formatTokens(contextTokens),
            threshold: formatTokens(reserve?.threshold ?? 0),
            percent: Math.round(pressurePercent(contextTokens, contextWindow)),
          })}
        </div>
        {session?.compression ? (
          <div className={styles.compressInfo}>
            {t('compressSummaryInfo', {
              rounds: session.compression.rounds,
              tokens: formatTokens(estimateTokens(session.compression.summary)),
              saved: formatTokens(session.compression.savedTokens ?? 0),
            })}
          </div>
        ) : null}
        <div className={styles.compressActions}>
          <Button
            size="s"
            variant="outlined"
            disabled={!session || compressing}
            onClick={() => {
              if (!session) {
                return
              }
              if (!apiKey) {
                showToast({ key: 'compressNeedApiKey' })
                return
              }
              setCompressing(true)
              void compressSession(session, apiKey, locale)
                .then((outcome) => {
                  if (outcome.ok) {
                    setSessionCompression(session.id, outcome.compression)
                    showToast({ key: 'compressDone' })
                  } else {
                    showToast({
                      key:
                        outcome.reason === 'tooShort'
                          ? 'compressTooShort'
                          : outcome.reason === 'noKey'
                            ? 'compressNeedApiKey'
                            : 'compressFailed',
                    })
                  }
                })
                .finally(() => setCompressing(false))
            }}
          >
            {compressing ? t('compressRunning') : t('compressButton')}
          </Button>
          {session?.compression ? (
            <Button
              size="s"
              variant="outlined"
              onClick={() => {
                setSessionCompression(session.id, null)
                showToast({ key: 'compressCleared' })
              }}
            >
              {t('compressClear')}
            </Button>
          ) : null}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.billingHead}>
          <div className={styles.sectionTitle}>{t('billingTitle')}</div>
          <span
            className={clsx(styles.badge, cost.peakNow ? styles.badgePeak : styles.badgeOffPeak)}
          >
            {cost.peakNow ? t('billingPeak') : t('billingOffPeak')}
          </span>
        </div>
        <div className={styles.switchRow}>
          <span className={styles.switchLabel}>{t('billingHoliday')}</span>
          <Switch checked={holiday} onChange={setHoliday} label={t('billingHoliday')} />
        </div>
        <div className={styles.switchRow}>
          <span className={styles.switchLabel}>{t('billingDiscount')}</span>
          <Switch checked={discount} onChange={setDiscount} label={t('billingDiscount')} />
        </div>
        {cost.lines.length > 0 ? (
          <div className={styles.lines}>
            {cost.lines.map((line) => (
              <div key={line.key} className={styles.line}>
                <span className={styles.lineLabel}>
                  {line.key === 'billingParse'
                    ? `${t(line.key, line.params)} · ${t('billingPages', { count: cost.usage.pages })}`
                    : t(line.key, line.params)}
                </span>
                <span className={styles.lineAmount}>{formatMoney(line.amount)}</span>
              </div>
            ))}
            <div className={styles.total}>
              <span className={styles.totalLabel}>{t('billingTotal')}</span>
              <span className={styles.totalAmount}>{formatMoney(cost.total)}</span>
            </div>
          </div>
        ) : (
          <div className={styles.empty}>{t('billingEmpty')}</div>
        )}
        {cost.byModel.length > 0 ? (
          <div className={styles.modelLines}>
            <div className={styles.modelTitle}>{t('billingModels')}</div>
            {cost.byModel.map((item) => (
              <div key={item.model} className={styles.line}>
                <span className={styles.lineLabel}>
                  {modelLabel(item.model)} · {t('billingReplies', { count: item.replies })}
                </span>
                <span className={styles.lineAmount}>{formatMoney(item.cost)}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className={styles.note}>{t('billingNote')}</div>
      </section>
    </Modal>
  )
}
