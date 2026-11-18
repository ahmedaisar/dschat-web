import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import {
  closeNanoVMTab,
  newNanoVMTab,
  selectNanoVMTab,
  useNanoVM,
} from '../../services/nanovm/session.js'
import styles from './NanoVM.module.css'

/**
 * 标签条：桌面停靠与手机底部面板共用。
 *
 * 每个标签是一个圆角块，选中时高亮；多于一个标签时才出现关闭按钮，
 * 免得把唯一的终端关掉（store 里也会退化成清屏）。右侧固定一个 + 新建。
 */
export const ShellTabs = ({ variant }: { variant: 'dock' | 'sheet' }) => {
  const t = useTranslate()
  const tabs = useNanoVM((state) => state.tabs)
  const activeId = useNanoVM((state) => state.activeId)
  const closable = tabs.length > 1

  return (
    <div className={clsx(styles.tabsBar, variant === 'sheet' && styles.tabsBarSheet)}>
      <div className={styles.tabsScroll} role="tablist" aria-label={t('nanovm')}>
        {tabs.map((tab) => (
          <div key={tab.id} className={clsx(styles.tab, tab.id === activeId && styles.tabActive)}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              className={styles.tabLabel}
              onClick={() => selectNanoVMTab(tab.id)}
            >
              {tab.title}
            </button>
            {closable ? (
              <button
                type="button"
                className={styles.tabClose}
                aria-label={t('nanovmCloseTab')}
                onClick={() => closeNanoVMTab(tab.id)}
              >
                <IconCloseOutline16 />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <button
        type="button"
        className={styles.tabNew}
        aria-label={t('nanovmNewTab')}
        onClick={newNanoVMTab}
      >
        {'+'}
      </button>
    </div>
  )
}
