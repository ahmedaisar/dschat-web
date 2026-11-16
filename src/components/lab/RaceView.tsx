import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import {
  RACE_COMBOS,
  runRace,
  type RaceModel,
  type RaceResult,
  type RaceStatus,
} from '../../services/lab/race.js'
import { importComboToChat } from '../../services/lab/importToChat.js'
import { applySTMs, getEnabledModules } from '../../services/unrestricted/stm.js'
import { copyText } from '../../utils/clipboard.js'
import { showToast } from '../base/toastState.js'
import { Button } from '../base/Button.js'
import { Select, type SelectOption } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import styles from './RaceView.module.css'

/** 并发上限选项：Select 的 value 只能是字符串 */
const CONCURRENCY_OPTIONS: SelectOption<string>[] = ['1', '2', '3', '4', '5', '6'].map((value) => ({
  value,
  label: value,
}))

/** 耗时统一按秒展示，保留一位小数 */
const formatDuration = (durationMs: number): string => `${(durationMs / 1000).toFixed(1)}s`

const STATUS_LABEL: Record<RaceStatus, TranslationKey> = {
  pending: 'labRaceStatusPending',
  streaming: 'labRaceStatusStreaming',
  done: 'labRaceStatusDone',
  error: 'labRaceStatusError',
  aborted: 'labRaceStatusAborted',
}

/** 状态徽标配色：完成、出错、中止各一种，其余（排队、流式）用中性样式 */
const statusClassName = (status: RaceStatus): string => {
  switch (status) {
    case 'done':
      return clsx(styles.badge, styles.statusDone)
    case 'error':
      return clsx(styles.badge, styles.statusError)
    case 'aborted':
      return clsx(styles.badge, styles.statusAborted)
    default:
      return styles.badge
  }
}

/** 多路赛跑：选组合与参数后在右侧并发跑，按综合分标出胜出者。 */
export const RaceView = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey) ?? ''
  const parseltongue = useSettings((state) => state.parseltongue)
  const parseltongueTechnique = useSettings((state) => state.parseltongueTechnique)
  const parseltongueIntensity = useSettings((state) => state.parseltongueIntensity)
  const unrestricted = useSettings((state) => state.unrestricted)
  const stmModules = useSettings((state) => state.stmModules)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>(() => RACE_COMBOS.map((combo) => combo.id))
  const [model, setModel] = useState<RaceModel | 'mixed'>('mixed')
  const [concurrency, setConcurrency] = useState('3')
  const [depth, setDepth] = useState(false)
  const [results, setResults] = useState<RaceResult[]>([])
  const [startedQuery, setStartedQuery] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  // 视图卸载（切换标签、关闭实验台）时结束在跑的请求
  useEffect(
    () => () => {
      controllerRef.current?.abort()
    },
    []
  )

  const toggleCombo = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    )
  }

  const stop = () => {
    controllerRef.current?.abort()
  }

  // 输出整形与聊天里的渲染一致：只影响展示与复制，不影响打分
  const shape = (text: string): string =>
    stmModules.length === 0 ? text : applySTMs(text, getEnabledModules(stmModules))

  const copy = async (text: string) => {
    const ok = await copyText(shape(text))
    showToast(ok ? { key: 'copied' } : { key: 'copyFailed' })
  }

  // importComboToChat 内部会关闭实验台、新建会话并提示 labRaceImported，这里不再重复弹条
  const openInChat = (result: RaceResult) => {
    if (!result.system) {
      return
    }
    importComboToChat(result.system, startedQuery)
  }

  const start = async () => {
    if (!apiKey.trim()) {
      showToast({ key: 'labRaceNeedApiKey' })
      return
    }
    const trimmed = query.trim()
    if (!trimmed) {
      showToast({ key: 'labRaceNeedQuery' })
      return
    }
    if (selected.length === 0) {
      showToast({ key: 'labRaceNeedCombos' })
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setStartedQuery(trimmed)
    setResults([])
    setError(null)
    setRunning(true)
    try {
      const final = await runRace(
        {
          apiKey,
          query: trimmed,
          comboIds: selected,
          model,
          concurrency: Number(concurrency),
          depth,
          parseltongue: {
            enabled: parseltongue,
            technique: parseltongueTechnique,
            intensity: parseltongueIntensity,
          },
          unrestricted,
        },
        { onUpdate: setResults, signal: controller.signal }
      )
      setResults(final)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      showToast({ key: 'labRaceFailed' })
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
      setRunning(false)
    }
  }

  // 胜出者取已完成候选里的最高分；全部为 0 分（例如都失败）时不标
  const finished = results.filter((result) => result.status === 'done')
  const bestScore = finished.reduce((best, result) => Math.max(best, result.score), 0)
  const winnerId =
    bestScore > 0 ? (finished.find((result) => result.score === bestScore)?.id ?? null) : null

  return (
    <div className={styles.race}>
      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.heading}>
            <div className={styles.title}>{t('labRaceTitle')}</div>
            <div className={styles.subtitle}>{t('labRaceSubtitle')}</div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>{t('labRaceQuery')}</span>
            <textarea
              className={styles.textarea}
              rows={4}
              value={query}
              disabled={running}
              placeholder={t('labRaceQueryPlaceholder')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>{t('labRaceCombos')}</span>
            <div className={styles.comboList}>
              {RACE_COMBOS.map((combo) => (
                <label className={styles.combo} key={combo.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(combo.id)}
                    disabled={running}
                    onChange={() => toggleCombo(combo.id)}
                  />
                  <span className={styles.dot} style={{ backgroundColor: combo.color }} />
                  <span className={styles.comboText}>
                    <span className={styles.comboName}>{combo.codename}</span>
                    <span className={styles.comboDesc}>{combo.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>{t('labRaceModel')}</span>
            <Select<RaceModel | 'mixed'>
              ariaLabel={t('labRaceModel')}
              value={model}
              disabled={running}
              options={[
                { value: 'mixed', label: t('labRaceModelMixed') },
                { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
                { value: 'deepseek-flash', label: 'deepseek-flash' },
              ]}
              onChange={setModel}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>{t('labRaceConcurrency')}</span>
            <Select<string>
              ariaLabel={t('labRaceConcurrency')}
              value={concurrency}
              disabled={running}
              options={CONCURRENCY_OPTIONS}
              onChange={setConcurrency}
            />
          </div>

          <div className={styles.switchRow}>
            <Switch
              checked={depth}
              onChange={setDepth}
              label={t('labRaceDepth')}
              disabled={running}
            />
            <span className={styles.label}>{t('labRaceDepth')}</span>
          </div>
          <div className={styles.hint}>{t('labRaceDepthDescription')}</div>

          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.actions}>
            {running ? (
              <Button variant="dangerOutlined" size="m" block onClick={stop}>
                {t('labRaceStop')}
              </Button>
            ) : (
              <Button size="m" block onClick={() => void start()}>
                {t('labRaceRun')}
              </Button>
            )}
          </div>
        </section>

        <section className={styles.results}>
          {running ? <div className={styles.hint}>{t('labRaceRunning')}</div> : null}
          {results.length === 0 ? (
            <div className={styles.empty}>{t('labRaceEmpty')}</div>
          ) : (
            results.map((result) => (
              <article
                key={result.id}
                className={clsx(styles.card, result.id === winnerId && styles.cardWinner)}
              >
                <div className={styles.cardHead}>
                  <span className={styles.cardBar} style={{ backgroundColor: result.color }} />
                  <span className={styles.cardTitle}>{result.codename}</span>
                  <span className={styles.badge}>{result.model}</span>
                  {result.id === winnerId ? (
                    <span className={clsx(styles.badge, styles.badgeWinner)}>
                      {t('labRaceWinner')}
                    </span>
                  ) : null}
                  <span className={clsx(styles.badge, styles.badgeScore)}>
                    {`${t('labRaceScore')} ${result.score}`}
                  </span>
                  <span className={statusClassName(result.status)}>
                    {t(STATUS_LABEL[result.status])}
                  </span>
                </div>

                <div className={styles.cardMeta}>
                  <span>{`${t('labRaceDuration')} ${
                    result.durationMs > 0 ? formatDuration(result.durationMs) : '—'
                  }`}</span>
                </div>

                {result.error ? <div className={styles.cardError}>{result.error}</div> : null}
                <pre className={styles.pre}>
                  {result.status === 'done' ? shape(result.text) : result.text}
                </pre>

                <div className={styles.cardActions}>
                  <Button
                    variant="outlined"
                    size="s"
                    disabled={!result.text}
                    onClick={() => void copy(result.text)}
                  >
                    {t('labRaceCopy')}
                  </Button>
                  <Button
                    variant="outlined"
                    size="s"
                    disabled={!result.system}
                    onClick={() => openInChat(result)}
                  >
                    {t('labRaceImport')}
                  </Button>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  )
}
