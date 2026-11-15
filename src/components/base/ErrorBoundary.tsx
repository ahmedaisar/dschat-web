import { Component, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** 出错时渲染的内容；父组件传入，方便使用 i18n 与样式 */
  fallback: (error: Error) => ReactNode
}

type State = { error: Error | null }

/** 渲染错误兜底：避免单个页面出错把整个应用变成灰屏。 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error)
    }
    return this.props.children
  }
}
