/**
 * 手机端「切换输入法」。
 *
 * WebView 里的页面没法调起系统输入法选择器，所以 Android 壳在 MainActivity 里挂了
 * `AndroidKeyboard` 这个 JavascriptInterface（见 android/src/.../MainActivity.java）。
 * 纯浏览器里没有这个桥，界面会退化成一句提示：用系统快捷键切换。
 */

type AndroidKeyboardBridge = {
  available?: () => boolean
  showInputMethodPicker?: () => void
}

const bridge = (): AndroidKeyboardBridge | undefined => {
  if (typeof window === 'undefined') {
    return undefined
  }
  return (window as unknown as { AndroidKeyboard?: AndroidKeyboardBridge }).AndroidKeyboard
}

/** 当前环境能不能唤起系统输入法选择器 */
export const keyboardPickerAvailable = (): boolean => {
  const api = bridge()
  if (!api) {
    return false
  }
  if (typeof api.showInputMethodPicker !== 'function') {
    return false
  }
  // 老版本壳只有 showInputMethodPicker，没有 available()
  return typeof api.available === 'function' ? api.available() !== false : true
}

/** 唤起系统输入法选择器；返回是否已交给原生处理 */
export const showKeyboardPicker = (): boolean => {
  const api = bridge()
  if (!api || typeof api.showInputMethodPicker !== 'function') {
    return false
  }
  try {
    api.showInputMethodPicker()
    return true
  } catch {
    return false
  }
}
