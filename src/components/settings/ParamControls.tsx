import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import styles from './ParamControls.module.css'

/** 按步长取整，避免 0.1 步长累积浮点误差（如 0.30000000000000004） */
const roundToStep = (value: number, step: number) => {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)))
  return Number(value.toFixed(decimals))
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * 数值参数控件：滑块 + 数字输入框。
 * 输入过程中只更新草稿，失焦或回车时提交，提交后把草稿规范成取整后的值；
 * optional 时允许留空，表示使用服务端默认值（不传该字段）。
 */
export const ParamControl = ({
  label,
  value,
  min,
  max,
  step,
  optional = false,
  onChange,
}: {
  label: string
  value: number | null
  min: number
  max: number
  step: number
  /** 允许留空表示默认值，此时不显示滑块 */
  optional?: boolean
  onChange: (value: number | null) => void
}) => {
  const t = useTranslate()
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const focused = useRef(false)

  // 外部值变化（滑块、导入设置）时同步草稿；正在输入时不打断
  useEffect(() => {
    if (!focused.current) {
      setDraft(value === null ? '' : String(value))
    }
  }, [value])

  const commit = (raw: string) => {
    const text = raw.trim()
    if (text === '') {
      setDraft('')
      onChange(optional ? null : min)
      return
    }
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) {
      setDraft(value === null ? '' : String(value))
      return
    }
    const next = clamp(roundToStep(parsed, step), min, max)
    setDraft(String(next))
    onChange(next)
  }

  const update = (next: number) => {
    const clamped = clamp(roundToStep(next, step), min, max)
    setDraft(String(clamped))
    onChange(clamped)
  }

  return (
    <div className={styles.control}>
      {optional ? null : (
        <input
          type="range"
          className={styles.range}
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value ?? min}
          onChange={(event) => update(Number(event.target.value))}
        />
      )}
      <input
        type="number"
        className={styles.number}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        inputMode="decimal"
        placeholder={optional ? t('settingsParamDefault') : undefined}
        value={draft}
        onFocus={() => {
          focused.current = true
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          focused.current = false
          commit(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            return
          }
          if (event.key === 'Enter') {
            commit(event.currentTarget.value)
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}
