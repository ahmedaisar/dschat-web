import {
  deleteWorkspaceFile,
  diffWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  saveWorkspaceFile,
  isTextFile,
  workspaceUsage,
} from '../workspace/store.js'
import type { AgentTool } from './tools.js'
import { clip, fail, ok, str } from './tools.js'

/**
 * 虚拟工作区工具：读写的是 localStorage 里的虚拟文件系统，不碰真实磁盘。
 *
 * 与 DeepSeek-Agent 的 workspace 工具对应，但去掉了「切换分支」——这里没有 git，
 * 只有文件内容与进入工作区时的基线，所以「查看 diff」按行比较基线。
 * 全部工具都要求工作区开关打开；单独开关关闭时不执行。
 */

const listTool: AgentTool = {
  id: 'list_workspace',
  label: '列出工作区',
  labelEn: 'List workspace',
  summary: '列出虚拟工作区里的文件、大小与更新时间。',
  summaryEn: 'List files in the virtual workspace with sizes and timestamps.',
  description:
    '列出当前虚拟工作区里的文件。返回路径、大小与更新时间；写文件前先用它确认路径，避免写错位置。',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  risk: 'safe',
  run: async () => {
    const files = listWorkspaceFiles()
    if (files.length === 0) {
      return ok('工作区目前是空的。可用 write_workspace_file 创建文件。')
    }
    const usage = workspaceUsage()
    const lines = files.map(
      (file) =>
        `- ${file.path}（${file.size} 字节，${isTextFile(file) ? '文本' : file.mime}，更新于 ${new Date(file.updatedAt).toLocaleString()}）`
    )
    return ok([`工作区共 ${usage.files} 个文件、${usage.bytes} 字节：`, ...lines].join('\n'))
  },
}

const readTool: AgentTool = {
  id: 'read_workspace_file',
  label: '读取工作区文件',
  labelEn: 'Read workspace file',
  summary: '读取虚拟工作区里的一个文本文件。',
  summaryEn: 'Read one text file from the virtual workspace.',
  description: '读取工作区里的一个文本文件。路径为相对路径，例如 src/agent/loop.ts。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对路径，例如 notes/todo.md' },
      max_chars: { type: 'number', description: '最多返回多少字符，默认 20000' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  risk: 'safe',
  run: async (input) => {
    const path = str(input, 'path')
    const file = readWorkspaceFile(path)
    if (!file) {
      return fail(`工作区里没有文件「${path}」。可以先用 list_workspace 看一下现有文件。`)
    }
    const max = Math.min(200_000, Math.max(500, (input.max_chars as number) || 20_000))
    const header = [
      `路径：${file.path}`,
      `类型：${file.mime}`,
      `大小：${file.size} 字节`,
      `更新：${new Date(file.updatedAt).toLocaleString()}`,
    ]
    if (isTextFile(file)) {
      return ok([...header, '', clip(file.content, max)].join('\n'))
    }
    // 二进制没法直接给模型读，给 base64 片段并说明
    const base64 = file.content.slice(0, Math.max(256, Math.floor(max * 0.75)))
    return ok(
      [
        ...header,
        `说明：二进制文件，以下为 base64 片段（前 ${base64.length} 字符，共 ${file.content.length} 字符）。`,
        '',
        base64,
      ].join('\n')
    )
  },
}

const writeTool: AgentTool = {
  id: 'write_workspace_file',
  label: '写入工作区文件',
  labelEn: 'Write workspace file',
  summary: '把完整内容写入虚拟工作区文件，可新建；执行前需要确认。',
  summaryEn:
    'Write full content to a workspace file, creating it if needed; asks for confirmation.',
  description:
    '把完整内容写入工作区文件，允许新建文件。写入前需要用户确认；内容只保存在浏览器本地的虚拟工作区里。写入会覆盖同名文件的全部内容。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对路径，例如 notes/plan.md' },
      content: { type: 'string', description: '完整文件内容（覆盖写入）' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  risk: 'write',
  requiresApproval: true,
  run: async (input) => {
    const path = str(input, 'path')
    const content = str(input, 'content')
    const result = saveWorkspaceFile(path, content)
    if (!result.ok) {
      const reasons: Record<string, string> = {
        path: '路径不合法：只允许相对路径，且不能包含 ..',
        tooLarge: '文件超过当前存储方式的大小上限，请拆分成更小的文件',
        tooManyFiles: '工作区文件数已达上限，请先删除一些文件',
        totalTooLarge: '工作区总容量已满，请先清理文件',
      }
      return fail(reasons[result.reason] ?? '写入失败')
    }
    return ok(
      `已${result.created ? '创建' : '更新'}文件「${result.file.path}」（${content.length} 字符）。`
    )
  },
}

const diffTool: AgentTool = {
  id: 'diff_workspace_file',
  label: '查看工作区 diff',
  labelEn: 'Workspace diff',
  summary: '查看文件相对进入工作区时基线的变化。',
  summaryEn: 'Show changes against the baseline captured when the file entered the workspace.',
  description:
    '查看文件相对基线的逐行差异。传 path 看单个文件；不传则返回全部变更文件的摘要。基线是文件第一次进入工作区时的内容。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对路径；省略则汇总全部变更' },
    },
    required: [],
    additionalProperties: false,
  },
  risk: 'safe',
  run: async (input) => {
    const path = str(input, 'path')
    if (path) {
      const file = readWorkspaceFile(path)
      if (!file) {
        return fail(`工作区里没有文件「${path}」。`)
      }
      const diff = diffWorkspaceFile(file)
      if (diff.added === 0 && diff.removed === 0) {
        return ok(`「${file.path}」相对基线没有变化。`)
      }
      return ok([`「${file.path}」+${diff.added} / -${diff.removed}`, '', ...diff.lines].join('\n'))
    }
    const changed = listWorkspaceFiles()
      .map((file) => ({ file, diff: diffWorkspaceFile(file) }))
      .filter((item) => item.diff.added > 0 || item.diff.removed > 0)
    if (changed.length === 0) {
      return ok('工作区里的文件相对基线都没有变化。')
    }
    return ok(
      changed
        .map(({ file, diff }) => `- ${file.path}：+${diff.added} / -${diff.removed}`)
        .join('\n')
    )
  },
}

const deleteTool: AgentTool = {
  id: 'delete_workspace_file',
  label: '删除工作区文件',
  labelEn: 'Delete workspace file',
  summary: '删除虚拟工作区里的一个文件；执行前需要确认。',
  summaryEn: 'Delete a workspace file; asks for confirmation.',
  description: '删除工作区里的一个文件。执行前需要用户确认，删除后不可恢复。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要删除的相对路径' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  risk: 'write',
  requiresApproval: true,
  run: async (input) => {
    const path = str(input, 'path')
    const removed = deleteWorkspaceFile(path)
    return removed ? ok(`已删除「${path}」。`) : fail(`工作区里没有文件「${path}」。`)
  },
}

/** 工作区工具；顺序即设置页展示顺序 */
export const WORKSPACE_TOOLS: AgentTool[] = [listTool, readTool, writeTool, diffTool, deleteTool]

export const WORKSPACE_TOOL_IDS = WORKSPACE_TOOLS.map((tool) => tool.id)
