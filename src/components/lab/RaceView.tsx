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
  const fileRef = useRef<HTMLInputElement>(null)

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

  /** 把当前赛跑结果导出成 JSON，之后可以导入回放 */
  const exportResults = () => {
    if (results.length === 0) {
      return
    }
    const payload = {
      version: 1,
      type: 'race',
      exportedAt: new Date().toISOString(),
      query: startedQuery,
      results,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `jailbreak-race-${Date.now()}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  /** 导入一份之前导出的赛跑结果（只展示，不重新请求） */
  const importResults = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>
      const raw = Array.isArray(parsed.results) ? parsed.results : null
      if (!raw) {
        throw new Error('missing results')
      }
      const imported: RaceResult[] = raw.map((item, index) => {
        const record = (item ?? {}) as Record<string, unknown>
        const status = record.status
        return {
          id: typeof record.id === 'string' ? record.id : `imported-${index}`,
          codename: typeof record.codename === 'string' ? record.codename : `#${index + 1}`,
          color: typeof record.color === 'string' ? record.color : '#6d5cff',
          model:
            record.model === 'deepseek-v4-pro' || record.model === 'deepseek-flash'
              ? record.model
              : 'deepseek-flash',
          status:
            status === 'done' ||
            status === 'error' ||
            status === 'aborted' ||
            status === 'streaming'
              ? status
              : 'done',
          text: typeof record.text === 'string' ? record.text : '',
          score: typeof record.score === 'number' ? record.score : 0,
          durationMs: typeof record.durationMs === 'number' ? record.durationMs : 0,
          error: typeof record.error === 'string' ? record.error : undefined,
          system: typeof record.system === 'string' ? record.system : undefined,
        }
      })
      setResults(imported)
      setStartedQuery(typeof parsed.query === 'string' ? parsed.query : '')
      setError(null)
      showToast({ key: 'labRaceImportedResults' })
    } catch {
      showToast({ key: 'labRaceImportFailed' })
    }
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
          <div className={styles.headRow}>
            <div className={styles.heading}>
              <div className={styles.title}>{t('labRaceTitle')}</div>
              <div className={styles.subtitle}>{t('labRaceSubtitle')}</div>
            </div>
            <div className={styles.toolbar}>
              <Button
                variant="outlined"
                size="s"
                disabled={results.length === 0}
                onClick={exportResults}
              >
                {t('labExport')}
              </Button>
              <Button variant="outlined" size="s" onClick={() => fileRef.current?.click()}>
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
