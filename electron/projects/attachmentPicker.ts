import { readFile, stat } from 'node:fs/promises'
import { basename, sep } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import {
  MAX_IMAGE_BASE64_BYTES,
  imageTypeOf,
  type AllowedImageType,
} from '../../shared/protocol/chatImage'

// 대화에 붙일 것을 고른다. **이미지와 파일을 나누지 않는다** —
// 사용자는 "이걸 붙인다" 고만 생각한다. 나누는 것은 runtime 사정이다:
//
//   이미지 → data.images 에 내용(base64)을 실어 보낸다. 어디에 있든 된다
//   그 밖  → data.contextFiles 에 경로만 보낸다. 에이전트가 직접 읽으므로
//            프로젝트 안이어야 한다 (PathScope 가 밖을 막는다)
//
// 고른 것을 여기서 판별해 알맞은 쪽으로 보낸다.

export type PickedAttachment =
  | { kind: 'image'; name: string; bytes: number; data: string; mediaType: AllowedImageType }
  | { kind: 'file'; name: string; filePath: string; type: 'file' | 'dir' }
  | { kind: 'error'; name: string; error: string }

export async function pickAttachments(
  window: BrowserWindow,
  projectRoot: string | null,
): Promise<PickedAttachment[]> {
  const result = await dialog.showOpenDialog(window, {
    title: '대화에 붙일 파일 선택',
    ...(projectRoot ? { defaultPath: projectRoot } : {}),
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled) return []

  return Promise.all(result.filePaths.map((path) => classify(path, projectRoot)))
}

/** 경로 목록을 곧바로 판별한다 (다이얼로그 없이 — 입력창 드래그드롭용). */
export async function resolveAttachments(
  paths: string[],
  projectRoot: string | null,
): Promise<PickedAttachment[]> {
  return Promise.all(paths.map((path) => classify(path, projectRoot)))
}

async function classify(path: string, projectRoot: string | null): Promise<PickedAttachment> {
  const name = basename(path)
  const mediaType = imageTypeOf(path)

  try {
    const info = await stat(path)
    return mediaType === null
      ? asContextFile(path, name, info.isDirectory(), projectRoot)
      : await asImage(path, name, info.size, mediaType)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { kind: 'error', name, error: `읽지 못했습니다: ${reason}` }
  }
}

async function asImage(
  path: string,
  name: string,
  bytes: number,
  mediaType: AllowedImageType,
): Promise<PickedAttachment> {
  // base64 는 원본의 약 4/3 이다. 읽기 전에 걸러야 큰 파일로 메모리를 잡지 않는다.
  if (bytes * 1.34 > MAX_IMAGE_BASE64_BYTES) {
    return { kind: 'error', name, error: '이미지가 너무 큽니다 (약 7MB 이하)' }
  }
  const data = (await readFile(path)).toString('base64')
  return { kind: 'image', name, bytes, data, mediaType }
}

function asContextFile(
  path: string,
  name: string,
  isDirectory: boolean,
  projectRoot: string | null,
): PickedAttachment {
  // 경로만 보내므로 runtime 이 읽을 수 있어야 한다 — 프로젝트 밖은 PathScope 가 막는다
  if (projectRoot === null || !isInside(projectRoot, path)) {
    return { kind: 'error', name, error: '프로젝트 밖 파일은 붙일 수 없습니다' }
  }
  return { kind: 'file', name, filePath: path, type: isDirectory ? 'dir' : 'file' }
}

function isInside(root: string, path: string): boolean {
  // 윈도우는 구분자가 `\` 라 '/' 고정이면 항상 밖으로 판정된다 — OS 구분자를 쓴다
  return path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}
