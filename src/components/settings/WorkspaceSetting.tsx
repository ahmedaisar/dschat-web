import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  WORKSPACE_MAX_FILES,
  WORKSPACE_MAX_FILE_CHARS,
  WORKSPACE_MAX_TOTAL_CHARS,
  clearWorkspace,
  deleteWorkspaceFile,
  exportWorkspace,
  importWorkspace,
  saveWorkspaceFile,
  setWorkspaceEnabled,
  setWorkspaceMode,
  useWorkspace,
  type WorkspaceMode,
  workspaceUsage,
  type WorkspaceFile,
} from '../../services/workspace/store.js'
import {
  opfsSupported,
  readStorageStatus,
  requestPersistentStorage,
  type StorageStatus,
} from '../../services/workspace/opfs.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Switch } from '../base/Switch.js'
import { showToast } from '../base/toastState.js'
import { useIsMobile } from '../../app/viewport.js'
import { useSettings } from '../../services/settings.js'
import settingsStyles from './Settings.module.css'
import styles from './WorkspaceSetting.module.css'

/**
 * 设置 → 工作区。
 *
 * 这里是 localStorage 里的虚拟文件系统：可以新建 / 编辑 / 删除文件，
 * 也可以整包导出或导入，用来长期保存 Agent 的产出，不依赖任何后端。
 * 默认关闭，开启后工作区工具才会下发给模型。
 */

/** 字节数按人类可读单位显示 */
const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

const formatTime = (at: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at))

const downloadFile = (file: WorkspaceFile) => {
  const blob = new Blob([file.content], { type: file.mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.path.split('/').pop() ?? file.path
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const WorkspaceSetting = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const enabled = useWorkspace((state) => state.enabled)
  const mode = useWorkspace((state) => state.mode)
  const hydrated = useWorkspace((state) => state.hydrated)
  const persistError = useWorkspace((state) => state.persistError)
  const [storage, setStorage] = useState<StorageStatus | null>(null)
  const [storageBusy, setStorageBusy] = useState(false)
  const files = useWorkspace((state) => state.files)
  const usage = workspaceUsage()
  const fileList = Object.values(files).sort((a, b) => a.path.localeCompare(b.path))
  const [draft, setDraft] = useState<{ path: string; content: string; editing: boolean } | null>(
    null
  )
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [mergeMode, setMergeMode] = useState<'merge' | 'replace'>('merge')
  const inputRef = useRef<HTMLInputElement>(null)

  const refreshStorage = async () => {
    setStorage(await readStorageStatus())
  }

  useEffect(() => {
    void refreshStorage()
  }, [])

  const switchMode = async (next: WorkspaceMode) => {
    if (next === mode) {
      return
    }
    setStorageBusy(true)
    try {
      const applied = await setWorkspaceMode(next)
      if (applied !== next) {
        showToast({ key: 'workspaceModeUnsupported', type: 'error' })
      } else {
        showToast({ key: 'workspaceModeSwitched' })
        await refreshStorage()
      }
    } catch {
      showToast({ key: 'workspaceModeFailed', type: 'error' })
    } finally {
      setStorageBusy(false)
    }
  }

  const startEdit = (file: WorkspaceFile) => {
    setDraft({ path: file.path, content: file.content, editing: true })
  }

  const startCreate = () => {
    setDraft({ path: '', content: '', editing: true })
  }

  const save = () => {
    if (!draft) {
      return
    }
    const result = saveWorkspaceFile(draft.path, draft.content)
    if (!result.ok) {
      showToast({ key: `workspaceSaveFailed_${result.reason}` })
      return
    }
    showToast({ key: result.created ? 'workspaceFileCreated' : 'workspaceFileSaved' })
    setDraft(null)
  }

  const onImport = async (file: File) => {
    const text = await file.text()
    const result = importWorkspace(text, mergeMode)
    if (result.error) {
      showToast({ key: 'workspaceImportFailed', type: 'error' })
      return
    }
    showToast({ key: 'workspaceImported', params: { count: result.imported } })
  }

  return (
    <>
      <div className={settingsStyles.groupTitle}>{t('workspaceSectionTitle')}</div>
      <div className={clsx(settingsStyles.cell, settingsStyles.row)}>
        <div className={settingsStyles.text}>
          <div className={settingsStyles.label}>{t('workspaceEnableLabel')}</div>
          <div className={settingsStyles.description}>{t('workspaceEnableDesc')}</div>
        </div>
        <Switch
          checked={enabled}
          onChange={setWorkspaceEnabled}
          label={t('workspaceEnableLabel')}
        />
      </div>

      <div className={styles.storage}>
        <div className={styles.storageHead}>
          <span className={styles.storageTitle}>{t('workspaceStorageMode')}</span>
          <span className={styles.modeTabs} role="tablist" aria-label={t('workspaceStorageMode')}>
            {(
              [
                { value: 'local', label: 'workspaceModeLocal' },
                { value: 'opfs', label: 'workspaceModeOpfs' },
              ] as const
            ).map((item) => {
              const unsupported = item.value === 'opfs' && !opfsSupported()
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={mode === item.value}
                  disabled={storageBusy || unsupported}
                  className={clsx(
                    styles.modeTab,
                    mode === item.value && styles.modeTabActive,
                    unsupported && styles.modeTabDisabled
                  )}
                  onClick={() => void switchMode(item.value)}
                >
                  {t(item.label)}
                </button>
              )
            })}
          </span>
        </div>
        <div className={styles.modeDesc}>
          {t(mode === 'opfs' ? 'workspaceModeOpfsDesc' : 'workspaceModeLocalDesc')}
        </div>
        <div className={styles.storageStats}>
          <span>
            {t('workspacePersistState')}：
            {storage === null
              ? '—'
              : !storage.supported
                ? t('workspacePersistUnsupported')
                : storage.persisted
                  ? t('workspacePersistGranted')
                  : t('workspacePersistNotGranted')}
          </span>
          {storage?.usage !== null && storage?.usage !== undefined ? (
            <span>
              {t('workspaceStorageUsage', {
                usage: formatBytes(storage.usage),
                quota: formatBytes(storage.quota ?? 0),
              })}
            </span>
          ) : null}
          <button type="button" className={styles.linkButton} onClick={() => void refreshStorage()}>
            {t('workspaceStorageRefresh')}
          </button>
          <Button
            size="s"
            variant="outlined"
            disabled={storageBusy || !storage?.supported || storage?.persisted}
            onClick={() => {
              setStorageBusy(true)
              void requestPersistentStorage()
                .then(async (granted) => {
                  await refreshStorage()
                  showToast({
                    key: granted ? 'workspacePersistGrantedToast' : 'workspacePersistDeniedToast',
                    type: granted ? undefined : 'error',
                  })
                })
                .finally(() => setStorageBusy(false))
            }}
          >
            {t('workspacePersistRequest')}
          </Button>
        </div>
        {persistError ? (
          <div className={styles.persistError}>
            {t('workspacePersistError', { message: persistError })}
          </div>
        ) : null}
        {mode === 'opfs' && !hydrated ? (
          <div className={styles.hydrating}>{t('workspaceHydrating')}</div>
        ) : null}
      </div>

      <div className={styles.usage}>
        <div className={styles.usageHead}>
          <span>{t('workspaceUsageTitle')}</span>
          <span className={styles.usageNumbers}>
            {t('workspaceUsageFiles', { files: usage.files, max: WORKSPACE_MAX_FILES })} ·{' '}
            {t('workspaceUsageChars', {
              chars: usage.chars.toLocaleString(),
              max: WORKSPACE_MAX_TOTAL_CHARS.toLocaleString(),
            })}
          </span>
        </div>
        <div className={styles.bar} aria-hidden>
          <span
            style={{
              width: `${Math.min(100, Math.round((usage.chars / WORKSPACE_MAX_TOTAL_CHARS) * 100))}%`,
            }}
          />
        </div>
      </div>

      <div className={styles.actions}>
        <Button size="s" onClick={startCreate} disabled={!enabled}>
          {t('workspaceNewFile')}
        </Button>
        <Button size="s" variant="outlined" onClick={() => inputRef.current?.click()}>
          {t('workspaceImport')}
        </Button>
        <Button
          size="s"
          variant="outlined"
          disabled={fileList.length === 0}
          onClick={() => {
            const { name, blob } = exportWorkspace()
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = name
            link.click()
            setTimeout(() => URL.revokeObjectURL(url), 10_000)
            showToast({ key: 'workspaceExported' })
          }}
        >
          {t('workspaceExport')}
        </Button>
        <div className={styles.modeTabs} role="tablist" aria-label={t('workspaceImportMode')}>
          {(['merge', 'replace'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={mergeMode === mode}
              className={clsx(styles.modeTab, mergeMode === mode && styles.modeTabActive)}
              onClick={() => setMergeMode(mode)}
            >
              {t(mode === 'merge' ? 'workspaceImportMerge' : 'workspaceImportReplace')}
            </button>
          ))}
        </div>
        <Button
          size="s"
          variant="dangerOutlined"
          disabled={fileList.length === 0}
          onClick={() => {
            clearWorkspace()
            setDraft(null)
            showToast({ key: 'workspaceCleared' })
          }}
        >
          {t('workspaceClear')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) {
              void onImport(file)
            }
          }}
        />
      </div>

      {draft ? (
        <div className={styles.editor}>
          <input
            className={styles.pathInput}
            value={draft.path}
            placeholder={t('workspacePathPlaceholder')}
            spellCheck={false}
            onChange={(event) => setDraft({ ...draft, path: event.target.value })}
          />
          <textarea
            className={styles.textarea}
            aria-label={t('workspaceContentLabel')}
            rows={8}
            value={draft.content}
            maxLength={WORKSPACE_MAX_FILE_CHARS}
            placeholder={t('workspaceContentPlaceholder')}
            onChange={(event) => setDraft({ ...draft, content: event.target.value })}
          />
          <div className={styles.editorFoot}>
            <span className={styles.counter}>
              {draft.content.length} / {WORKSPACE_MAX_FILE_CHARS}
            </span>
            <div className={styles.editorActions}>
              <Button size="s" variant="outlined" onClick={() => setDraft(null)}>
                {t('cancel')}
              </Button>
              <Button size="s" onClick={save} disabled={!draft.path.trim()}>
                {t('workspaceSave')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {fileList.length === 0 ? (
        <div className={styles.empty}>{t('workspaceEmpty')}</div>
      ) : (
        <div className={styles.list} role="list">
          {fileList.map((file) => (
            <div key={file.path} className={styles.row} role="listitem">
              <div className={styles.rowMain}>
                <span className={styles.path} title={file.path}>
                  {file.path}
                </span>
                <span className={styles.meta}>
                  {file.content.length} · {formatTime(file.updatedAt, locale)}
                </span>
              </div>
              <div className={styles.rowActions}>
                <button type="button" className={styles.linkButton} onClick={() => startEdit(file)}>
                  {t('workspaceEdit')}
                </button>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => downloadFile(file)}
                >
                  {t('workspaceDownload')}
                </button>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => setPendingDelete(file.path)}
                >
                  {t('workspaceDelete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.note}>{isMobile ? t('workspaceNoteMobile') : t('workspaceNote')}</div>

      {pendingDelete ? (
        <Modal
          title={t('workspaceDeleteConfirmTitle')}
          onClose={() => setPendingDelete(null)}
          className={styles.confirm}
          footer={
            <div className={styles.confirmActions}>
              <Button variant="outlined" onClick={() => setPendingDelete(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  deleteWorkspaceFile(pendingDelete)
                  setPendingDelete(null)
                  showToast({ key: 'workspaceFileDeleted' })
                }}
              >
                {t('workspaceDelete')}
              </Button>
            </div>
          }
        >
          {t('workspaceDeleteConfirmBody', { path: pendingDelete })}
        </Modal>
      ) : null}
    </>
  )
}
