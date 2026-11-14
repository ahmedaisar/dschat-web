import clsx from 'clsx'
import styles from './Switch.module.css'

type SwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 无障碍名称；开关本身没有文字内容 */
  label: string
  disabled?: boolean
  className?: string
}

/** 方块开关：方形轨道加方形滑块，滑块在两端之间滑动，开启时填充品牌色 */
export const Switch = ({ checked, onChange, label, disabled = false, className }: SwitchProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={clsx(styles.switch, className)}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  />
)
