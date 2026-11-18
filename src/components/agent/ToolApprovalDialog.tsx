import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  resolveToolApproval,
  useToolApproval,
  type ApprovalRequest,
} from '../../services/agent/approval.js'
import { agentToolById } from '../../services/agent/tools.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './ToolApprovalDialog.module.css'

/**
 * 工具确认弹窗：队列里第一个待确认调用。
 *
 * 同时只会有一个弹窗，允许后自动切到下一个；关闭弹窗按拒绝处理，
 * 避免流式回复卡在「等待确认」。
 */

const inputPreview = (input: unknown): string => {
  if (typeof input !== 'object' || input === null) {
    return String(input ?? '')
  }
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) {
    return '（无参数）'
  }
  return entries
    .map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      return `${key}: ${text.length > 600 ? `${text.slice(0, 600)}…` : text}`
    })
    .join('\n')
}

const ApprovalDialog = ({ request }: { request: ApprovalRequest }) => {
  const t = useTranslate()
  const [remember, setRemember] = useState(false)
  const tool = agentToolById(request.toolId)
  return (
    <Modal
      title={t('toolApprovalTitle')}
      closable
      onClose={() => resolveToolApproval(request.id, false)}
      className={styles.dialog}
      footer={
        <div className={styles.actions}>
          <label className={styles.remember}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            {t('toolApprovalRemember')}
          </label>
          <div className={styles.buttons}>
            <Button variant="outlined" onClick={() => resolveToolApproval(request.id, false)}>
              {t('toolApprovalReject')}
            </Button>
            <Button onClick={() => resolveToolApproval(request.id, true, remember)}>
              {t('toolApprovalAllow')}
            </Button>
          </div>
        </div>
      }
    >
      <p className={styles.lead}>{t('toolApprovalLead', { tool: tool?.label ?? request.label })}</p>
      <pre className={styles.input}>{inputPreview(request.input)}</pre>
    </Modal>
  )
}

/** 挂在应用根部：有等待确认的调用时才渲染 */
export const ToolApprovalDialog = () => {
  const request = useToolApproval((state) => state.queue[0])
  return request ? <ApprovalDialog key={request.id} request={request} /> : null
}
