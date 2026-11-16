import { create } from 'zustand'

/** 会话统计弹窗的开关；输入框右下角的统计按钮打开它 */
export const useStatsDialog = create<{ open: boolean }>(() => ({ open: false }))

export const openStats = () => useStatsDialog.setState({ open: true })
export const closeStats = () => useStatsDialog.setState({ open: false })
