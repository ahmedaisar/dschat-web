import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import styles from './ReplyEditor.module.css'

/** 输入框随内容增高，超过这个高度后内部滚动 */
const MAX_HEIGHT = 320

export type ReplyDraft = { thinking: string; text: string }

/**
 * 回复改写编辑器：思维链与正文各一个输入框，保存后写回消息内容块。
 * Ctrl/Cmd + Enter 保存，Esc 取消。
 */
export const ReplyEditor = ({
  hasThinking,
  canRevert,
  busy,
  initialThinking,
  initialText,
  onSave,
  onCancel,
  onRevert,
}: {
  /** 回复本身带思维链时才显示思维链输入框 */
  hasThinking: boolean
  /** 存在首次改写前保存的原始快照 */
  canRevert: boolean
  busy: boolean
  initialThinking: string
  initialText: string
  onSave: (draft: ReplyDraft) => void
  onCancel: () => void
  onRevert: () => void
}) => {
  const t = useTranslate()
  const [thinking, setThinking] = useState(initialThinking)
  const [text, setText] = useState(initialText)
  const thinkingRef = useRef<HTMLTextAreaElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    for (const area of [thinkingRef.current, textRef.current]) {
      if (area) {
        area.style.height = 'auto'
        area.style.height = `${Math.min(area.scrollHeight, MAX_HEIGHT)}px`
      }
    }
  }, [thinking, text])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'Escape') {
      onCancel()
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onSave({ thinking, text })
    }
  }

  return (
    <div className={styles.editor}>
      {hasThinking ? (
        <label className={styles.field}>
          <span className={styles.label}>{t('replyThinkingLabel')}</span>
          <textarea
            ref={thinkingRef}
            className={styles.textarea}
            aria-label={t('replyThinkingLabel')}
            rows={1}
            value={thinking}
            disabled={busy}
            onChange={(event) => setThinking(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>
      ) : null}
      <label className={styles.field}>
        <span className={styles.label}>{t('replyBodyLabel')}</span>
        <textarea
          ref={textRef}
          className={styles.textarea}
          aria-label={t('replyBodyLabel')}
          rows={1}
          autoFocus
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      <div className={styles.actions}>
        {canRevert ? (
          <Button
            variant="outlined"
            size="s"
            className={styles.revert}
            disabled={busy}
            onClick={onRevert}
          >
            {t('replyRevert')}
          </Button>
        ) : null}
        <Button variant="outlined" size="s" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button size="s" disabled={busy} onClick={() => onSave({ thinking, text })}>
          {t('save')}
        </Button>
      </div>
    </div>
  )
}
