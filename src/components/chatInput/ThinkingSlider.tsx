import clsx from 'clsx'
import { useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { IconThinkOutline14 } from '../base/icons.js'
import {
  EFFORT_LEVELS,
  setReasoningEffort,
  thinkingBudget,
  useSettings,
} from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ThinkingSlider.module.css'

const LEVEL_KEYS = [
  'thinkingLevel0',
  'thinkingLevel1',
  'thinkingLevel2',
  'thinkingLevel3',
  'thinkingLevel4',
] as const

/**
 * 深度思考入口：点击展开强度轨道，0 档关闭，1-4 档由弱到强。
 * 轨道用蓝紫渐变，拖到最右会提示额度消耗更快。
 */
export const ThinkingSlider = () => {
  const t = useTranslate()
  const effort = useSettings((state) => state.reasoningEffort)
  const [open, setOpen] = useState(false)
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, { side: 'top', align: 'start', offset: 10, measureKey: effort })
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { captureEscape: true })

  const maxed = effort >= EFFORT_LEVELS
  const percent = effort / EFFORT_LEVELS
  const style = { '--p': percent } as CSSProperties

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(styles.trigger, effort > 0 && styles.selected, open && styles.open)}
        aria-label={t('thinkingSwitch')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconThinkOutline14 />
        <span className={styles.label}>{t('thinkingSwitch')}</span>
        {/* 档位用文字而不是数字，省得猜 1-4 各是什么强度 */}
        {effort > 0 ? <span className={styles.level}>{t(LEVEL_KEYS[effort])}</span> : null}
      </button>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.panel}
              style={position ?? undefined}
              data-max={maxed || undefined}
              role="dialog"
              aria-label={t('thinkingPanelTitle')}
            >
              <div className={styles.head}>
                <span className={styles.title}>{t('thinkingPanelTitle')}</span>
                <span className={styles.levelName}>{t(LEVEL_KEYS[effort])}</span>
              </div>

              <div className={styles.trackArea} style={style}>
                <div className={styles.track}>
                  <span className={styles.fill} />
                  <span className={styles.glow} />
                  {Array.from({ length: EFFORT_LEVELS + 1 }).map((_, index) => (
                    <span
                      key={index}
                      className={clsx(styles.tick, index <= effort && styles.tickOn)}
                      style={{ '--i': index / EFFORT_LEVELS } as CSSProperties}
                    />
                  ))}
                  <span className={styles.thumb} />
                </div>
                <input
                  className={styles.range}
                  type="range"
                  min={0}
                  max={EFFORT_LEVELS}
                  step={1}
                  value={effort}
                  aria-label={t('thinkingPanelTitle')}
                  onChange={(event) => setReasoningEffort(Number(event.target.value))}
                />
              </div>

              <div className={styles.legend}>
                {LEVEL_KEYS.map((key, index) => (
                  <button
                    key={key}
                    type="button"
                    className={clsx(styles.legendItem, index === effort && styles.legendActive)}
                    onClick={() => setReasoningEffort(index)}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>

              <div className={styles.footer}>
                <span className={styles.hint} data-warn={maxed || undefined}>
                  {maxed ? t('thinkingMaxWarning') : t('thinkingPanelHint')}
                </span>
                {effort > 0 ? (
                  <span className={styles.budget}>
                    {t('thinkingBudgetNote', { tokens: thinkingBudget(effort).toLocaleString() })}
                  </span>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
