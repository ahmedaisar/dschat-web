import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  addSavedMemory,
  clearSavedMemories,
  deleteSavedMemory,
  toggleSavedMemory,
  updateSavedMemory,
  useSavedMemories,
} from '../../services/chat/savedMemory.js'
import {
  addMemoryNode,
  clearMemoryBank,
  deleteMemoryNode,
  searchMemoryBank,
  useMemoryBank,
  type MemorySearchDebug,
} from '../../services/chat/memoryBank.js'
import {
  setAutoExtractMemory,
  setMemoryBankDimension,
  setMemoryBankEnabled,
  setMemoryBankLimit,
  setMemoryBankThreshold,
  setMemoryBankWeight,
  setSavedMemoryEnabled,
  useSettings,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { ParamControl } from './ParamControls.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { IconEditOutline16, IconTrashOutline16 } from '../base/icons.js'
import styles from './MemorySettings.module.css'

const DIMENSIONS = [64, 128, 256, 384, 768]

const score = (value: number): string => value.toFixed(2)

/** 记忆设置：长期记忆列表 + 网状记忆库（节点 / 连边 / 检索权重 / 搜索调试） */
export const MemorySettings = () => {
  const t = useTranslate()
  const settings = useSettings()
  const items = useSavedMemories((state) => state.items)
  const nodes = useMemoryBank((state) => state.nodes)
  const edges = useMemoryBank((state) => state.edges)

  const [newText, setNewText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [nodeTitle, setNodeTitle] = useState('')
  const [nodeContent, setNodeContent] = useState('')
  const [nodeTags, setNodeTags] = useState('')
  const [query, setQuery] = useState('')
  const [debug, setDebug] = useState<MemorySearchDebug | null>(null)

  const config = useMemo(
    () => ({
      dimension: settings.memoryBankDimension,
      limit: settings.memoryBankLimit,
      threshold: settings.memoryBankThreshold,
      keywordWeight: settings.memoryBankKeywordWeight,
      tagWeight: settings.memoryBankTagWeight,
      vectorWeight: settings.memoryBankVectorWeight,
      edgeWeight: settings.memoryBankEdgeWeight,
    }),
    [
      settings.memoryBankDimension,
      settings.memoryBankLimit,
      settings.memoryBankThreshold,
      settings.memoryBankKeywordWeight,
      settings.memoryBankTagWeight,
      settings.memoryBankVectorWeight,
      settings.memoryBankEdgeWeight,
    ]
  )

  const handleAdd = () => {
    if (addSavedMemory(newText)) {
      setNewText('')
    }
  }

  const handleAddNode = () => {
    if (
      addMemoryNode(
        {
          title: nodeTitle,
          content: nodeContent,
          tags: nodeTags.split(/[,，]/),
        },
        settings.memoryBankDimension
      )
    ) {
      setNodeTitle('')
      setNodeContent('')
      setNodeTags('')
    }
  }

  const runSearch = () => {
    setDebug(searchMemoryBank(query, config))
  }

  return (
    <div className={styles.memory}>
      <div className={styles.groupTitle}>{t('memorySavedSection')}</div>

      <div className={styles.toggleRow}>
        <div className={styles.text}>
          <div className={styles.label}>{t('memorySavedEnabledLabel')}</div>
          <div className={styles.desc}>{t('memorySavedEnabledDesc')}</div>
        </div>
        <Switch
          checked={settings.savedMemoryEnabled}
          onChange={setSavedMemoryEnabled}
          label={t('memorySavedEnabledLabel')}
        />
      </div>

      <div className={styles.toggleRow}>
        <div className={styles.text}>
          <div className={styles.label}>{t('memoryAutoExtractLabel')}</div>
          <div className={styles.desc}>{t('memoryAutoExtractDesc')}</div>
        </div>
        <Switch
          checked={settings.autoExtractMemory}
          onChange={setAutoExtractMemory}
          label={t('memoryAutoExtractLabel')}
        />
      </div>

      <div className={styles.addRow}>
        <input
          className={styles.input}
          value={newText}
          placeholder={t('memoryAddPlaceholder')}
          onChange={(event) => setNewText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              handleAdd()
            }
          }}
        />
        <Button size="m" disabled={!newText.trim()} onClick={handleAdd}>
          {t('memoryAddButton')}
        </Button>
      </div>

      {items.length > 0 ? (
        <div className={styles.list}>
          {items.map((item) => {
            const editing = editingId === item.id
            return (
              <div
                key={item.id}
                className={clsx(styles.item, !item.enabled && styles.itemDisabled)}
              >
                {editing ? (
                  <div className={styles.editBox}>
                    <textarea
                      className={styles.textarea}
                      autoFocus
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                    />
                    <div className={styles.editActions}>
                      <Button size="s" variant="outlined" onClick={() => setEditingId(null)}>
                        {t('cancel')}
                      </Button>
                      <Button
                        size="s"
                        disabled={!editDraft.trim()}
                        onClick={() => {
                          if (updateSavedMemory(item.id, editDraft)) {
                            setEditingId(null)
                          }
                        }}
                      >
                        {t('save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={styles.itemContent}>{item.content}</div>
                    <div className={styles.actions}>
                      <Switch
                        checked={item.enabled}
                        onChange={() => toggleSavedMemory(item.id)}
                        label={item.content}
                      />
                      <IconButton
                        size="xs"
                        icon={<IconEditOutline16 />}
                        tooltip={t('memoryEditTooltip')}
                        onClick={() => {
                          setEditingId(item.id)
                          setEditDraft(item.content)
                        }}
                      />
                      <IconButton
                        size="xs"
                        icon={<IconTrashOutline16 />}
                        tooltip={t('memoryDeleteTooltip')}
                        onClick={() => deleteSavedMemory(item.id)}
                      />
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className={styles.empty}>{t('memoryEmpty')}</div>
      )}

      {items.length > 0 ? (
        <div className={styles.clearRow}>
          <Button variant="dangerOutlined" size="s" onClick={clearSavedMemories}>
            {t('memoryClearAll')}
          </Button>
        </div>
      ) : null}

      <div className={styles.groupTitle}>{t('memoryBankSection')}</div>

      <div className={styles.toggleRow}>
        <div className={styles.text}>
          <div className={styles.label}>{t('memoryBankEnabledLabel')}</div>
          <div className={styles.desc}>{t('memoryBankEnabledDesc')}</div>
        </div>
        <Switch
          checked={settings.memoryBankEnabled}
          onChange={setMemoryBankEnabled}
          label={t('memoryBankEnabledLabel')}
        />
      </div>

      <div className={styles.fieldGrid}>
        <div className={styles.field}>
          <div className={styles.label}>{t('memoryBankDimensionLabel')}</div>
          <Select
            ariaLabel={t('memoryBankDimensionLabel')}
            value={String(settings.memoryBankDimension)}
            options={DIMENSIONS.map((value) => ({ value: String(value), label: String(value) }))}
            onChange={(value) => setMemoryBankDimension(Number(value))}
          />
          <div className={styles.hint}>{t('memoryBankDimensionDesc')}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.label}>{t('memoryBankLimitLabel')}</div>
          <ParamControl
            label={t('memoryBankLimitLabel')}
            value={settings.memoryBankLimit}
            min={1}
            max={12}
            step={1}
            onChange={(value) => setMemoryBankLimit(value ?? 4)}
          />
        </div>
      </div>

      <div className={styles.fieldGrid}>
        <div className={styles.field}>
          <div className={styles.label}>{t('memoryBankThresholdLabel')}</div>
          <ParamControl
            label={t('memoryBankThresholdLabel')}
            value={settings.memoryBankThreshold}
            min={0}
            max={1}
            step={0.05}
            onChange={(value) => setMemoryBankThreshold(value ?? 0.15)}
          />
        </div>
      </div>

      <div className={styles.label}>{t('memoryBankWeightsLabel')}</div>
      <div className={styles.weights}>
        <ParamControl
          label={t('memoryBankKeywordWeight')}
          value={settings.memoryBankKeywordWeight}
          min={0}
          max={5}
          step={0.1}
          onChange={(value) => setMemoryBankWeight('keyword', value ?? 1)}
        />
        <ParamControl
          label={t('memoryBankTagWeight')}
          value={settings.memoryBankTagWeight}
          min={0}
          max={5}
          step={0.1}
          onChange={(value) => setMemoryBankWeight('tag', value ?? 0.5)}
        />
        <ParamControl
          label={t('memoryBankVectorWeight')}
          value={settings.memoryBankVectorWeight}
          min={0}
          max={5}
          step={0.1}
          onChange={(value) => setMemoryBankWeight('vector', value ?? 0.8)}
        />
        <ParamControl
          label={t('memoryBankEdgeWeight')}
          value={settings.memoryBankEdgeWeight}
          min={0}
          max={5}
          step={0.1}
          onChange={(value) => setMemoryBankWeight('edge', value ?? 0.4)}
        />
      </div>

      <div className={styles.addCard}>
        <input
          className={styles.input}
          value={nodeTitle}
          placeholder={t('memoryBankAddTitle')}
          onChange={(event) => setNodeTitle(event.target.value)}
        />
        <textarea
          className={styles.textarea}
          rows={3}
          value={nodeContent}
          placeholder={t('memoryBankAddContent')}
          onChange={(event) => setNodeContent(event.target.value)}
        />
        <div className={styles.addRow}>
          <input
            className={styles.input}
            value={nodeTags}
            placeholder={t('memoryBankAddTags')}
            onChange={(event) => setNodeTags(event.target.value)}
          />
          <Button size="m" disabled={!nodeContent.trim()} onClick={handleAddNode}>
            {t('memoryBankAddButton')}
          </Button>
        </div>
      </div>

      <div className={styles.meta}>
        {t('memoryBankNodes')}: {nodes.length} · {t('memoryBankEdges')}: {edges.length}
      </div>

      {nodes.length > 0 ? (
        <div className={clsx(styles.list, styles.nodeList)}>
          {nodes.map((node) => {
            const nodeEdges = edges.filter(
              (edge) => edge.sourceId === node.id || edge.targetId === node.id
            )
            const degree = nodeEdges.length
            const neighbors = nodeEdges.slice(0, 3).flatMap((edge) => {
              const otherId = edge.sourceId === node.id ? edge.targetId : edge.sourceId
              const other = nodes.find((item) => item.id === otherId)
              return other ? [{ id: other.id, title: other.title, weight: edge.weight }] : []
            })
            return (
              <div key={node.id} className={styles.node}>
                <div className={styles.nodeHead}>
                  <span className={styles.nodeTitle}>{node.title}</span>
                  <span className={styles.meta}>
                    {t('memoryBankEdges')}: {degree}
                  </span>
                  <IconButton
                    size="xs"
                    icon={<IconTrashOutline16 />}
                    tooltip={t('memoryDeleteTooltip')}
                    onClick={() => deleteMemoryNode(node.id)}
                  />
                </div>
                <div className={styles.nodeContent}>{node.content}</div>
                {node.tags.length > 0 ? (
                  <div className={styles.chips}>
                    {node.tags.map((tag) => (
                      <span key={tag} className={styles.chip}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {neighbors.length > 0 ? (
                  <div className={styles.links}>
                    {neighbors.map((neighbor) => (
                      <span key={neighbor.id} className={styles.link}>
                        ↔ {neighbor.title} · {neighbor.weight.toFixed(2)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <div className={styles.empty}>{t('memoryBankEmpty')}</div>
      )}

      {nodes.length > 0 ? (
        <div className={styles.clearRow}>
          <Button variant="dangerOutlined" size="s" onClick={clearMemoryBank}>
            {t('memoryBankClear')}
          </Button>
        </div>
      ) : null}

      <div className={styles.groupTitle}>{t('memorySearchTitle')}</div>
      <div className={styles.addRow}>
        <input
          className={styles.input}
          value={query}
          placeholder={t('memorySearchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              runSearch()
            }
          }}
        />
        <Button size="m" disabled={!query.trim()} onClick={runSearch}>
          {t('memorySearchButton')}
        </Button>
      </div>

      {debug ? (
        <div className={styles.debug}>
          <div className={styles.meta}>
            {t('memoryDebugScope', { nodes: debug.nodes, edges: debug.edges })}
          </div>
          <div className={styles.meta}>
            {t('memoryDebugMatches', {
              keyword: debug.keywordMatches,
              tag: debug.tagMatches,
              vector: debug.vectorMatches,
              edges: debug.edgesTraversed,
            })}
          </div>
          {debug.candidates.length === 0 ? (
            <div className={styles.empty}>{t('memoryDebugEmpty')}</div>
          ) : (
            <div className={styles.debugTable}>
              <table>
                <thead>
                  <tr>
                    <th>{t('memoryDebugTitle')}</th>
                    <th>{t('memoryDebugKeyword')}</th>
                    <th>{t('memoryDebugTag')}</th>
                    <th>{t('memoryDebugVector')}</th>
                    <th>{t('memoryDebugEdge')}</th>
                    <th>{t('memoryDebugTotal')}</th>
                    <th>{t('memoryDebugPassed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {debug.candidates.slice(0, 12).map((candidate) => (
                    <tr key={candidate.nodeId}>
                      <td className={styles.debugTitle}>{candidate.title}</td>
                      <td>{score(candidate.keyword)}</td>
                      <td>{score(candidate.tag)}</td>
                      <td>{score(candidate.vector)}</td>
                      <td>{score(candidate.edge)}</td>
                      <td>{score(candidate.total)}</td>
                      <td>{candidate.passed ? '✓' : '·'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
