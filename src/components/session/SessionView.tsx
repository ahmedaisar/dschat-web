import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import {
  forkSession,
  setSessionCompression,
  setSessionSystemPrompt,
} from '../../services/chat/store.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <Button
            variant="outlined"
            size="s"
            className={styles.headerAction}
            onClick={() => {
              const forked = forkSession(session.id)
              showToast(forked ? { key: 'forkCreated' } : { key: 'forkFailed' })
            }}
          >
            {t('forkToNewChat')}
          </Button>
        </div>
      )}
      {session.systemPrompt ? (
        <div className={styles.promptNotice}>
          <span className={styles.promptNoticeText}>{t('sessionPromptNotice')}</span>
          <button
            type="button"
            className={styles.promptNoticeAction}
            onClick={() => setSessionSystemPrompt(session.id, null)}
          >
            {t('sessionPromptClear')}
          </button>
        </div>
      ) : null}
      {session.compression ? (
        <div className={styles.promptNotice}>
          <span className={styles.promptNoticeText}>
            {t('sessionCompressed', { rounds: session.compression.rounds })}
          </span>
          <button
            type="button"
            className={styles.promptNoticeAction}
            onClick={() => setSessionCompression(session.id, null)}
          >
            {t('sessionCompressClear')}
          </button>
        </div>
      ) : null}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}
