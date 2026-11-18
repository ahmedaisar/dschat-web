import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { showToast } from '../base/toastState.js'
import { loadEngine, resetEngine, useEngine } from '../../services/nanovm/boot.js'
import {
  DISK_MAX_MB,
  DISK_MIN_MB,
  MEMORY_MAX_MB,
  MEMORY_MIN_MB,
  TIMEOUT_MAX_MS,
  TIMEOUT_MIN_MS,
  setNanoVMAllowAgent,
  setNanoVMConfig,
  setNanoVMEnabled,
  useNanoVMConfig,
} from '../../services/nanovm/config.js'
import { vmFs } from '../../services/nanovm/fs.js'
import { NetError, fetchNet, netStatus, type NetRoute } from '../../services/nanovm/netProxy.js'
import {
  installToolchain,
  uninstallToolchain,
  usePackages,
} from '../../services/nanovm/packages.js'
import { openNanoVM, resetNanoVMSession } from '../../services/nanovm/session.js'
import type { ToolchainState } from '../../services/nanovm/types.js'
import { closeSettings } from '../settings/settingsDialogState.js'
import { mbText, useVmUsage } from './usage.js'
import styles from './NanoVM.module.css'

/** 单行开关：左侧文案 + 右侧方块开关 */
const SwitchRow = ({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
}) => (
  <div className={styles.switchRow}>
    <div className={styles.switchText}>
      <div className={styles.switchLabel}>{label}</div>
      <div className={styles.hint}>{hint}</div>
    </div>
    <Switch checked={checked} onChange={onChange} label={label} />
  </div>
)

/** 配额滑块：数值显示在标题右侧，说明放在滑块下面 */
const SliderRow = ({
  label,
  hint,
  display,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  hint: string
  display: string
  value: number
  min: number
  max: number
  step: number
  onChange: (next: number) => void
}) => (
  <div className={styles.sliderRow}>
    <div className={styles.sliderHead}>
      <span className={styles.sliderLabel}>{label}</span>
      <span className={styles.sliderValue}>{display}</span>
    </div>
    <input
      type="range"
      className={styles.range}
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
    <div className={styles.hint}>{hint}</div>
  </div>
)

/** 联网代理：自动 / 直连 / 自定义，带一条连通性测试 */
const NetCard = () => {
  const t = useTranslate()
  const netMode = useNanoVMConfig((state) => state.netMode)
  const proxyUrl = useNanoVMConfig((state) => state.proxyUrl)
  const [draft, setDraft] = useState(proxyUrl)
  const [invalid, setInvalid] = useState(false)
  const [checking, setChecking] = useState(false)

  // 提交后（或别处改了地址）把输入框同步成落盘值
  useEffect(() => {
    setDraft(proxyUrl)
  }, [proxyUrl])

  const status = netStatus()
  const detail =
    status.route === 'native'
      ? t('nanovmNetNative')
      : status.route === 'custom'
        ? t('nanovmNetCustomStatus', { url: proxyUrl })
        : status.route === 'off'
          ? t('nanovmNetCustomEmpty')
          : t('nanovmNetNativeOff')

  const routeLabel = (route: NetRoute): string =>
    route === 'native'
      ? t('nanovmNetNative')
      : route === 'custom'
        ? t('nanovmNetCustom')
        : t('nanovmNetNativeOff')

  /** 失焦 / 回车提交：空值等于清空，非空必须以 http(s):// 开头 */
  const commit = () => {
    const value = draft.trim()
    if (value && !/^https?:\/\//i.test(value)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setNanoVMConfig({ proxyUrl: value })
  }

  const check = async () => {
    setChecking(true)
    const started = performance.now()
    try {
      // api.github.com 带 Access-Control-Allow-Origin: *，浏览器直连也能成功
      const result = await fetchNet('api.github.com', { method: 'HEAD', timeoutMs: 8000 })
      showToast({
        key: 'nanovmNetCheckOk',
        params: {
          status: result.status,
          ms: Math.round(performance.now() - started),
          route: routeLabel(result.route),
        },
      })
    } catch (error) {
      const reason =
        error instanceof NetError
          ? (error.hint ?? error.message)
          : error instanceof Error
            ? error.message
            : String(error)
      showToast({ key: 'nanovmNetCheckFail', params: { reason }, type: 'error' })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className={styles.card} data-section="net">
      <div className={styles.netHead}>
        <div className={styles.actionLabel}>{t('nanovmNet')}</div>
        <div className={styles.hint}>{t('nanovmNetHint')}</div>
      </div>
      <div className={styles.netControl}>
        <Select
          value={netMode}
          ariaLabel={t('nanovmNet')}
          options={[
            { value: 'auto', label: t('nanovmNetAuto') },
            { value: 'direct', label: t('nanovmNetDirect') },
            { value: 'custom', label: t('nanovmNetCustom') },
          ]}
          onChange={(mode) => setNanoVMConfig({ netMode: mode })}
        />
      </div>
      {netMode === 'custom' ? (
        <>
          <input
            className={styles.netInput}
            value={draft}
            placeholder={t('nanovmNetPlaceholder')}
            aria-label={t('nanovmNetCustom')}
            aria-invalid={invalid || undefined}
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value)
              setInvalid(false)
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit()
              }
            }}
          />
          {/* 地址格式不对：红边 + 一行红字 */}
          {invalid ? <div className={styles.error}>{t('nanovmNetInvalid')}</div> : null}
        </>
      ) : null}
      <div className={styles.netStatus}>{t('nanovmNetStatus', { detail })}</div>
      <div className={styles.netActions}>
        <Button
          size="s"
          variant="outlined"
          disabled={checking}
          aria-busy={checking}
          onClick={() => void check()}
        >
          {checking ? t('nanovmNetChecking') : t('nanovmNetCheck')}
        </Button>
        {checking ? <span className={styles.spinner} aria-hidden /> : null}
      </div>
      <div className={styles.netNote}>{t('nanovmNetPingHint')}</div>
    </div>
  )
}

/** 单张工具链卡片：安装 / 卸载、体积与进度 */
const ToolchainCard = ({ state, busy }: { state: ToolchainState; busy: boolean }) => {
  const t = useTranslate()
  const [installing, setInstalling] = useState(false)
  const pending = busy || installing
  const percent = Math.round(Math.min(1, Math.max(0, state.progress ?? 0)) * 100)

  const install = async () => {
    setInstalling(true)
    try {
      const result = await installToolchain(state.id)
      if (!result.ok) {
        showToast({
          key: 'nanovmInstallFailed',
          params: { reason: result.error ?? state.label },
          type: 'error',
        })
      }
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className={styles.toolchain}>
      <div className={styles.toolchainHead}>
        <span className={styles.toolchainName}>{state.label}</span>
        <span className={styles.toolchainSize}>{state.sizeMB} MB</span>
      </div>
      <div className={styles.hint}>{state.summary}</div>
      <div className={styles.toolchainState}>
        {state.installed
          ? t('nanovmInstalledVersion', { version: state.version ?? '—' })
          : t('nanovmNotInstalled')}
      </div>
      {pending ? (
        <>
          <div className={styles.toolchainState}>{t('nanovmInstalling', { percent })}</div>
          <div className={styles.toolchainBar} aria-hidden>
            <span style={{ width: `${percent}%` }} />
          </div>
        </>
      ) : null}
      {state.error ? (
        <div className={styles.error}>{t('nanovmInstallFailed', { reason: state.error })}</div>
      ) : null}
      <div className={styles.toolchainActions}>
        {state.installed ? (
          <Button
            size="s"
            variant="outlined"
            disabled={pending}
            onClick={() => void uninstallToolchain(state.id)}
          >
            {t('nanovmUninstall')}
          </Button>
        ) : (
          <Button size="s" disabled={pending} onClick={() => void install()}>
            {t('nanovmInstallNow')}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * 设置 → NanoVM Slim 控制台。
 *
 * 开关与资源配额、引擎与存储状态、虚拟机镜像的导入导出与重置、按需工具链，
 * 最后是「打开终端」。改内存 / 磁盘会重新分配 WASM 线性内存，所以顺手
 * resetEngine()，下一次执行命令时按新配额重建。
 */
export const NanoVMConsole = () => {
  const t = useTranslate()
  const enabled = useNanoVMConfig((state) => state.enabled)
  const allowAgent = useNanoVMConfig((state) => state.allowAgent)
  const autoLoad = useNanoVMConfig((state) => state.autoLoad)
  const desktopDock = useNanoVMConfig((state) => state.desktopDock)
  const memoryMB = useNanoVMConfig((state) => state.memoryMB)
  const diskMB = useNanoVMConfig((state) => state.diskMB)
  const timeoutMs = useNanoVMConfig((state) => state.timeoutMs)
  const engineStatus = useEngine((state) => state.status)
  const engineInfo = useEngine((state) => state.info)
  const engineError = useEngine((state) => state.error)
  const usage = useVmUsage()
  const packages = usePackages((state) => state.states)
  const busy = usePackages((state) => state.busy)

  const [mergeMode, setMergeMode] = useState<'merge' | 'replace'>('merge')
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const timeoutSeconds = Math.round(timeoutMs / 1000)
  const storageOpfs = vmFs.usage().opfs
  const usedPercent = Math.min(
    100,
    Math.round((usage.bytes / Math.max(1, usage.diskMB * 1024 * 1024)) * 100)
  )

  /** 改配额：立刻落盘，引擎下一次执行命令时按新配额重建线性内存 */
  const applyQuota = (patch: { memoryMB: number } | { diskMB: number }) => {
    setNanoVMConfig(patch)
    resetEngine()
    showToast({ key: 'nanovmApplyNext' })
  }

  const exportImage = async () => {
    setExporting(true)
    try {
      const blob = await vmFs.exportImage()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'nanovm-slim.zip'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      showToast({ key: 'nanovmExportDone' })
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  const importImage = async (file: File) => {
    setImporting(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const count = await vmFs.importImage(bytes, mergeMode)
      showToast({ key: 'nanovmImportDone', params: { count } })
    } catch (error) {
      showToast({
        key: 'nanovmImportFailed',
        params: { reason: error instanceof Error ? error.message : String(error) },
        type: 'error',
      })
    } finally {
      setImporting(false)
    }
  }

  const resetAll = async () => {
    setResetting(true)
    try {
      await vmFs.reset()
      resetNanoVMSession()
      resetEngine()
      showToast({ key: 'nanovmResetDone' })
      setConfirmReset(false)
    } finally {
      setResetting(false)
    }
  }

  const engineText =
    engineStatus === 'ready' && engineInfo
      ? t('nanovmEngineReady', { memory: engineInfo.wasmMemoryMB, ms: engineInfo.bootMs })
      : engineStatus === 'loading'
        ? t('nanovmStatusLoading')
        : engineStatus === 'error'
          ? t('nanovmStatusError', { reason: engineError ?? '—' })
          : t('nanovmEngineIdle')

  return (
    <div className={styles.console}>
      <div className={styles.groupTitle}>{t('nanovmConsoleTitle')}</div>

      <div className={styles.card}>
        <SwitchRow
          label={t('nanovmEnable')}
          hint={t('nanovmEnableHint')}
          checked={enabled}
          onChange={setNanoVMEnabled}
        />
        <SwitchRow
          label={t('nanovmAllowAgent')}
          hint={t('nanovmAllowAgentHint')}
          checked={allowAgent}
          onChange={setNanoVMAllowAgent}
        />
        <SwitchRow
          label={t('nanovmAutoLoad')}
          hint={t('nanovmAutoLoadHint')}
          checked={autoLoad}
          onChange={(next) => setNanoVMConfig({ autoLoad: next })}
        />
        <SwitchRow
          label={t('nanovmDesktopDock')}
          hint={t('nanovmDesktopDockHint')}
          checked={desktopDock}
          onChange={(next) => setNanoVMConfig({ desktopDock: next })}
        />
      </div>

      <div className={styles.card}>
        <SliderRow
          label={t('nanovmMemory')}
          hint={t('nanovmMemoryHint')}
          display={t('nanovmMemoryValue', { value: memoryMB })}
          value={memoryMB}
          min={MEMORY_MIN_MB}
          max={MEMORY_MAX_MB}
          step={32}
          onChange={(value) => applyQuota({ memoryMB: value })}
        />
        <SliderRow
          label={t('nanovmDisk')}
          hint={t('nanovmDiskHint')}
          display={t('nanovmMemoryValue', { value: diskMB })}
          value={diskMB}
          min={DISK_MIN_MB}
          max={DISK_MAX_MB}
          step={16}
          onChange={(value) => applyQuota({ diskMB: value })}
        />
        <SliderRow
          label={t('nanovmTimeout')}
          hint={t('nanovmTimeoutHint')}
          display={t('nanovmTimeoutValue', { value: timeoutSeconds })}
          value={timeoutSeconds}
          min={TIMEOUT_MIN_MS / 1000}
          max={TIMEOUT_MAX_MS / 1000}
          step={1}
          onChange={(value) => setNanoVMConfig({ timeoutMs: value * 1000 })}
        />
      </div>

      <NetCard />

      <div className={styles.card}>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>{t('nanovmEngine')}</span>
          <span className={styles.statValue} data-status={engineStatus}>
            {engineText}
          </span>
          {engineStatus === 'error' ? (
            <Button size="s" variant="outlined" onClick={() => void loadEngine()}>
              {t('nanovmRetry')}
            </Button>
          ) : null}
        </div>
        {/* 引擎没加载时没有命令数可显示，别写成「0 个内置命令」 */}
        {engineInfo ? (
          <div className={styles.statLine}>{t('nanovmApplets', { count: engineInfo.applets })}</div>
        ) : null}
        <div className={styles.usageBlock}>
          <div className={styles.usageText}>
            {t('nanovmUsage', {
              files: usage.files,
              used: mbText(usage.bytes),
              total: usage.diskMB,
            })}
          </div>
          <div className={styles.usageBar} aria-hidden>
            <span style={{ width: `${usedPercent}%` }} />
          </div>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>{t('nanovmStorage')}</span>
          <span className={styles.statValue}>
            {t(storageOpfs ? 'nanovmStorageOpfs' : 'nanovmStorageLocal')}
          </span>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.actionRow}>
          <div className={styles.actionText}>
            <div className={styles.actionLabel}>{t('nanovmExportImage')}</div>
            <div className={styles.hint}>{t('nanovmExportHint')}</div>
          </div>
          <Button
            size="s"
            variant="outlined"
            disabled={exporting}
            onClick={() => void exportImage()}
          >
            {t('nanovmExportImage')}
          </Button>
        </div>
        <div className={styles.actionRow}>
          <div className={styles.actionText}>
            <div className={styles.actionLabel}>{t('nanovmImportImage')}</div>
            <div className={styles.modeTabs} role="tablist" aria-label={t('nanovmImportMode')}>
              {(['merge', 'replace'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={mergeMode === mode}
                  className={clsx(styles.modeTab, mergeMode === mode && styles.modeTabActive)}
                  onClick={() => setMergeMode(mode)}
                >
                  {t(mode === 'merge' ? 'nanovmMerge' : 'nanovmReplace')}
                </button>
              ))}
            </div>
          </div>
          <Button
            size="s"
            variant="outlined"
            disabled={importing}
            onClick={() => importRef.current?.click()}
          >
            {t('nanovmImportImage')}
          </Button>
        </div>
        <div className={styles.actionRow}>
          <div className={styles.actionText}>
            <div className={styles.actionLabel}>{t('nanovmReset')}</div>
            <div className={styles.hint}>{t('nanovmResetHint')}</div>
          </div>
          <Button
            size="s"
            variant="dangerOutlined"
            disabled={resetting}
            onClick={() => setConfirmReset(true)}
          >
            {t('nanovmReset')}
          </Button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) {
              void importImage(file)
            }
          }}
        />
      </div>

      <div className={styles.groupTitle}>{t('nanovmToolchains')}</div>
      <div className={styles.sectionHint}>{t('nanovmToolchainsHint')}</div>
      <div className={styles.toolchains}>
        {(['python', 'node', 'git'] as const).map((id) => (
          <ToolchainCard key={id} state={packages[id]} busy={busy === id} />
        ))}
      </div>

      <div className={styles.footer}>
        <Button
          block
          disabled={!enabled}
          onClick={() => {
            openNanoVM()
            closeSettings()
          }}
        >
          {t('nanovmOpenTerminal')}
        </Button>
      </div>

      {confirmReset ? (
        <Modal
          title={t('nanovmReset')}
          onClose={() => setConfirmReset(false)}
          className={styles.confirm}
          footer={
            <div className={styles.confirmActions}>
              <Button variant="outlined" onClick={() => setConfirmReset(false)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" disabled={resetting} onClick={() => void resetAll()}>
                {t('nanovmReset')}
              </Button>
            </div>
          }
        >
          {t('nanovmResetConfirm')}
        </Modal>
      ) : null}
    </div>
  )
}
