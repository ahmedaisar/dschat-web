import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import {
  IconCheckedOutline14,
  IconChevronDownOutline14,
  IconRefreshOutline16,
  IconSearchOutline16,
} from '../base/icons.js'
import {
  BUILTIN_MODELS,
  fetchRemoteModels,
  modelLabel,
  readCachedModels,
  type ModelOption,
} from '../../services/api/models.js'
import { setCustomProviderModel, setModel, useSettings } from '../../services/settings.js'
import { isCustomProviderEnabled, getCustomProvider } from '../../services/api/provider.js'
import { formatMoney, isKnownModel, modelPriceFor } from '../../services/chat/sessionStats.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ModelPicker.module.css'

const mergeModels = (remote: ModelOption[]): ModelOption[] => {
  const seen = new Set(remote.map((item) => item.id))
  return [...remote, ...BUILTIN_MODELS.filter((item) => !seen.has(item.id))]
}

/** 每个模型下方的价格：命中 / 未命中 / 输出，单位每 1M tokens */
const priceText = (model: string, t: ReturnType<typeof useTranslate>): string => {
  if (!isKnownModel(model)) {
    return t('modelPriceUnknown')
  }
  const price = modelPriceFor(model)
  return `${formatMoney(price.cacheHit)} / ${formatMoney(price.cacheMiss)} / ${formatMoney(price.output)}`
}

/** 自定义提供商：列表只来自其 GET /models；内置的 DeepSeek 模型与缓存都不适用 */
const customSeedModels = (): ModelOption[] => {
  const custom = getCustomProvider()
  return custom ? [{ id: custom.model, label: modelLabel(custom.model), source: 'builtin' }] : []
}

/**
 * 模型选择卡片：默认内置 Flash / V4 Pro，可从云端 GET /models 拉取并缓存。
 * 选择结果写入设置，下一条消息就用新模型；旧回复保留自己的模型与计费。
 * 启用自定义 OpenAI 兼容提供商时，列表来自该端点的 /models。
 */
export const ModelPicker = () => {
  const t = useTranslate()
  const model = useSettings((state) => state.model)
  const provider = useSettings((state) => state.provider)
  const customEnabled = provider === 'custom'
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelOption[]>(() =>
    isCustomProviderEnabled() ? customSeedModels() : mergeModels(readCachedModels() ?? [])
  )
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const fetched = useRef(false)

  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, {
    side: 'top',
    align: 'start',
    offset: 8,
    maxHeight: 360,
    minSpace: 220,
    measureKey: models.length,
  })
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { captureEscape: true })

  const refresh = useCallback(async (silent = false) => {
    const custom = getCustomProvider()
    const apiKey = custom?.apiKey ?? useSettings.getState().apiKey ?? ''
    if (!apiKey) {
      if (!silent) {
        showToast({ key: 'modelFetchFailed' })
      }
      return
    }
    setLoading(true)
    try {
      const remote = await fetchRemoteModels(apiKey, custom?.baseURL)
      setModels(custom ? remote : mergeModels(remote))
    } catch {
      if (!silent) {
        showToast({ key: 'modelFetchFailed' })
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // 首次打开且没有缓存时静默拉一次；失败继续用现有列表；自定义端点每次打开都重新拉取
  useEffect(() => {
    if (!open || (fetched.current && !customEnabled)) {
      return
    }
    fetched.current = true
    if (customEnabled || !readCachedModels()) {
      void refresh(true)
    }
  }, [open, refresh, customEnabled])

  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) {
      return models
    }
    return models.filter((item) =>
      `${item.label} ${item.id}`.toLocaleLowerCase().includes(normalized)
    )
  }, [models, query])

  const sourceText = useMemo(() => {
    if (loading) {
      return t('modelFetching')
    }
    const count = models.filter((item) => item.source === 'remote').length
    return count > 0 ? t('modelRemoteOk', { count }) : t('modelBuiltinFallback')
  }, [loading, models, t])

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(styles.trigger, open && styles.open)}
        aria-label={`${t('modelSelect')}: ${modelLabel(model)}`}
        title={modelLabel(model)}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.name}>{modelLabel(model)}</span>
        <span className={styles.arrow}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.panel}
              style={position ?? undefined}
              role="listbox"
              aria-label={t('modelSelect')}
            >
              <div className={styles.head}>
                <span className={styles.title}>{t('modelSelect')}</span>
                <button
                  type="button"
                  className={clsx(styles.refresh, loading && styles.spinning)}
                  disabled={loading}
                  onClick={() => void refresh()}
                >
                  <IconRefreshOutline16 />
                  {loading ? t('modelFetching') : t('modelFetch')}
                </button>
              </div>
              <label className={styles.search}>
                <IconSearchOutline16 />
                <input
                  type="search"
                  value={query}
                  placeholder={t('modelSearchPlaceholder')}
                  aria-label={t('modelSearchPlaceholder')}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  autoFocus
                />
              </label>
              <div className={styles.list}>
                {filteredModels.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={item.id === model}
                    className={clsx(styles.option, item.id === model && styles.active)}
                    onClick={() => {
                      setModel(item.id)
                      // custom 模式下把选择写回提供商配置，保持与设置页模型字段一致
                      if (isCustomProviderEnabled()) {
                        setCustomProviderModel(item.id)
                      }
                      setOpen(false)
                    }}
                  >
                    <span className={styles.optionMain}>
                      <span className={styles.optionNameRow}>
                        <span className={styles.optionName}>{item.label}</span>
                        <span className={styles.sourceTag}>
                          {item.source === 'remote' ? t('modelRemote') : t('modelBuiltin')}
                        </span>
                      </span>
                      <span className={styles.optionId}>{item.id}</span>
                      <span className={styles.optionPrice}>{priceText(item.id, t)}</span>
                    </span>
                    {item.id === model ? <IconCheckedOutline14 /> : null}
                  </button>
                ))}
                {filteredModels.length === 0 ? (
                  <div className={styles.empty}>{t('modelSearchEmpty')}</div>
                ) : null}
              </div>
              <div className={styles.foot}>
                <span>{sourceText}</span>
                <span>
                  {t('modelPriceNote')} · {t('modelPriceUnitShort')}
                </span>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
