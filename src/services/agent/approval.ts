import { create } from 'zustand'

/**
 * 工具执行前的人工确认队列。
 *
 * 需要确认的工具（读取剪贴板、生成文件）在流式回复里被调用时挂起等待：
 * 卡片上显示「等待确认」，弹窗给出参数预览，用户点允许或拒绝后 promise 才结算。
 * 关闭弹窗等同拒绝，避免回复永远卡在 running。
 */

export type ApprovalRequest = {
  id: string
  toolId: string
  label: string
  input: unknown
}

type Resolver = (allowed: boolean) => void

type ApprovalState = {
  queue: ApprovalRequest[]
  /** 是否记住本次会话的授权，记住后同工具不再重复询问 */
  remembered: Record<string, boolean>
}

export const useToolApproval = create<ApprovalState>(() => ({ queue: [], remembered: {} }))

const resolvers = new Map<string, Resolver>()

/** 发起确认；返回用户是否允许执行 */
export const requestToolApproval = (
  request: ApprovalRequest,
  options: { rememberKey?: string } = {}
): Promise<boolean> => {
  const { remembered } = useToolApproval.getState()
  if (options.rememberKey && remembered[options.rememberKey]) {
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    resolvers.set(request.id, resolve)
    useToolApproval.setState((state) => ({ queue: [...state.queue, request] }))
  })
}

/** 结算队首（或指定）请求；remember 为 true 时同工具后续调用直接放行 */
export const resolveToolApproval = (id: string, allowed: boolean, remember = false) => {
  const state = useToolApproval.getState()
  const request = state.queue.find((item) => item.id === id)
  const resolve = resolvers.get(id)
  resolvers.delete(id)
  useToolApproval.setState((current) => ({
    queue: current.queue.filter((item) => item.id !== id),
    remembered:
      remember && allowed && request
        ? { ...current.remembered, [request.toolId]: true }
        : current.remembered,
  }))
  resolve?.(allowed)
}

/** 中止整轮生成时，把所有等待中的确认按拒绝处理 */
export const cancelAllToolApprovals = () => {
  for (const request of useToolApproval.getState().queue) {
    resolvers.get(request.id)?.(false)
    resolvers.delete(request.id)
  }
  useToolApproval.setState({ queue: [] })
}
