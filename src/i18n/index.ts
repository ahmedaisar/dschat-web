import { en } from './en.js'

export type TranslationKey = keyof typeof en
export type TranslationParams = Record<string, string | number>
export type TranslationMessage = { key: TranslationKey; params?: TranslationParams }
export type LinkedMessage = TranslationMessage & {
  type?: 'error'
  link?: { key: TranslationKey; href: string }
}

export const isTranslationKey = (key: unknown): key is TranslationKey =>
  typeof key === 'string' && Object.hasOwn(en, key)

const translateEnglish = (key: TranslationKey, params?: TranslationParams): string =>
  en[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params?.[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : placeholder
  })

export const useTranslate = () => translateEnglish

export const translate = (key: TranslationKey, params?: TranslationParams): string =>
  translateEnglish(key, params)
