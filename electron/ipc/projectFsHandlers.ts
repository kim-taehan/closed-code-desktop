import { ipcMain } from 'electron'
import {
  Channel,
  type OpenInOsPayload,
  type OpenInOsResultPayload,
  type ReadDirPayload,
  type ReadDirResultPayload,
  type ReadFilePayload,
  type ReadFileResultPayload,
  type WriteFilePayload,
  type WriteFileResultPayload,
} from '../../shared/ipc/channels'
import type { ProjectFsActionPayload, ProjectFsResult } from '../../shared/ipc/projectFsPayloads'
import type { ProjectFs } from '../projects/projectFs'

// 프로젝트 파일 IPC 등록. ProjectBridge 가 300줄 상한에 닿아 이 묶음만 갈라냈다 —
// 등록/해제 수명은 여전히 ProjectBridge 의 register()/dispose()(HANDLED_CHANNELS)가 쥔다.

export function registerFsHandlers(fs: ProjectFs): void {
  ipcMain.handle(
    Channel.PROJECT_WRITE_FILE,
    async (_event, payload: WriteFilePayload): Promise<WriteFileResultPayload> => {
      const result = await fs.writeFile(
        payload.projectId,
        payload.path,
        payload.text,
        payload.expectedMtimeMs,
      )
      return result.ok ? { ok: true, mtimeMs: result.mtimeMs } : { ok: false, reason: result.reason }
    },
  )
  ipcMain.handle(
    Channel.PROJECT_FS_ACTION,
    async (_event, payload: ProjectFsActionPayload): Promise<ProjectFsResult> =>
      fs.fsAction(payload.projectId, payload.action),
  )
  ipcMain.handle(
    Channel.PROJECT_READ_FILE,
    async (_event, payload: ReadFilePayload): Promise<ReadFileResultPayload> => {
      const result = await fs.readFile(payload.projectId, payload.path)
      return result.ok
        ? { ok: true, text: result.text, mtimeMs: result.mtimeMs }
        : { ok: false, text: '', reason: result.reason }
    },
  )
  ipcMain.handle(
    Channel.PROJECT_OPEN_IN_OS,
    (_event, payload: OpenInOsPayload): Promise<OpenInOsResultPayload> =>
      fs.openInOs(payload.projectId, payload.path, payload.mode),
  )
  ipcMain.handle(
    Channel.PROJECT_READ_DIR,
    async (_event, payload: ReadDirPayload): Promise<ReadDirResultPayload> => {
      const result = await fs.readDir(payload.projectId, payload.path ?? '')
      return result.ok ? { ok: true, entries: result.entries } : { ok: false, entries: [] }
    },
  )
}
