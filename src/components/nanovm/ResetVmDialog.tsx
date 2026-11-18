import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { resetEngine } from '../../services/nanovm/boot.js'
import { vmFs } from '../../services/nanovm/fs.js'
import { resetNanoVMSession } from '../../services/nanovm/session.js'
import styles from './NanoVM.module.css'

/**
 * 重置虚拟机：清空虚拟磁盘 → 清掉所有标签的输出与 cwd → 释放引擎实例。
 * 下次执行命令时会按当前配额重新实例化引擎。
 */
export const resetVirtualMachine = async (): Promise<void> => {
  await vmFs.reset()
  resetNanoVMSession()
  resetEngine()
}

/**
 * 终端里的「清空虚拟机」确认框，桌面停靠与手机面板共用。
 *
 * 和设置里的重置是同一个动作、两个入口：那边的文案是「重置虚拟机」，
 * 这里用更短的「清空虚拟机」，确认按钮同样是红色。
 */
export const ResetVmDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const [resetting, setResetting] = useState(false)

  const reset = async () => {
    setResetting(true)
    try {
      await resetVirtualMachine()
      showToast({ key: 'nanovmResetDone' })
      onClose()
    } finally {
      setResetting(false)
    }
  }

  return (
    <Modal
      title={t('nanovmResetClear')}
      onClose={onClose}
      className={styles.confirm}
      footer={
        <div className={styles.confirmActions}>
          <Button variant="outlined" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="danger" disabled={resetting} onClick={() => void reset()}>
            {t('nanovmResetClear')}
          </Button>
        </div>
      }
    >
      {t('nanovmResetClearHint')}
    </Modal>
  )
}
