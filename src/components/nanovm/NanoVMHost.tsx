import { useEffect } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { loadEngine, useEngine } from '../../services/nanovm/boot.js'
import { useNanoVMConfig } from '../../services/nanovm/config.js'
import { useNanoVM } from '../../services/nanovm/session.js'
import { ShellDock } from './ShellDock.js'
import { ShellSheet } from './ShellSheet.js'

/**
 * NanoVM Slim 的挂载点：桌面端右侧停靠、手机端底部面板。
 *
 * 只决定「什么时候显示哪一块」——开合由侧栏按钮 toggleNanoVM() 驱动，
 * 总开关关掉后整块不渲染（App 里已经无条件挂载这里）。
 */
export const NanoVMHost = () => {
  const open = useNanoVM((state) => state.open)
  const enabled = useNanoVMConfig((state) => state.enabled)
  const autoLoad = useNanoVMConfig((state) => state.autoLoad)
  const isMobile = useIsMobile()
  const engineStatus = useEngine((state) => state.status)

  // 打开面板时预热引擎；autoLoad 关掉就等第一条命令自己加载引擎
  useEffect(() => {
    if (!enabled || !open || !autoLoad || engineStatus !== 'idle') {
      return
    }
    // 失败时 boot.ts 会把错误放进 useEngine，面板里显示状态与重试按钮
    void loadEngine()
  }, [autoLoad, enabled, engineStatus, open])

  if (!enabled || !open) {
    return null
  }
  return isMobile ? <ShellSheet /> : <ShellDock />
}
