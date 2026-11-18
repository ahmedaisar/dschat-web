import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import { hydrateWorkspace, refreshWorkspaceQuota } from './services/workspace/store.js'
import { hydrateNanovmFs } from './services/nanovm/fs.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
// OPFS 工作区是异步加载的；localStorage 模式会立即完成
void hydrateWorkspace()
void refreshWorkspaceQuota()
// NanoVM Slim 的虚拟文件系统：默认目录树立即可用，历史文件异步恢复
void hydrateNanovmFs()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
