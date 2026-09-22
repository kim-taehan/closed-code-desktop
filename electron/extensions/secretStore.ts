import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// 확장의 비밀 (`code.secrets`) — Jira 토큰 같은 것. **OS 보안 저장소로 암호화해** userData 아래 둔다.
//
// `storage.*` 와 가른 이유가 셋이다:
//  - **평문으로 안 쓴다.** 암호화는 Electron `safeStorage`(mac 키체인 · Windows DPAPI)가 한다.
//    못 쓰는 환경이면 **사유와 함께 거절한다 — 평문으로 떨어지지 않는다.** 떨어지면 확장은
//    잘 저장된 줄 알고, 토큰은 디스크에 그대로 남는다.
//  - **확장마다지 프로젝트마다가 아니다.** 토큰은 사람의 것이라 프로젝트를 옮겨도 같다.
//  - **웹뷰로 가는 길이 없다.** 자식(뒷단) API 로만 연다 — 앞단은 뒷단이 골라 준 것만 본다.
//
// 파일은 확장 하나에 하나이고 **통째로** 암호화한다 — 키 이름(`jiraToken`)도 무엇을 쥐었는지 말해 준다.
// 확장을 지우면 그 파일을 지운다 (`forgetExtensionSecrets`, `extensionManageHandlers.ts`).

/** `electron.safeStorage` 에서 쓰는 것만. 시험은 가짜를 끼운다 (vitest 에서 electron 은 가짜다) */
export interface SecretCipher {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface ExtensionSecrets {
  /** 넣은 적 없으면 `undefined` */
  get(extension: string, key: string): Promise<string | undefined>
  set(extension: string, key: string, value: string): Promise<void>
  delete(extension: string, key: string): Promise<void>
  /** 그 확장의 비밀을 전부 지운다 (지우기) */
  forget(extension: string): Promise<void>
}

/** 배선이 없을 때. 조용히 「없음」으로 답하지 않는다 — 확장은 토큰을 다시 묻고 또 못 저장한다 */
export const REFUSE_SECRETS: ExtensionSecrets = {
  get: () => Promise.reject(new Error('이 앱에는 비밀 저장소가 배선되지 않았습니다')),
  set: () => Promise.reject(new Error('이 앱에는 비밀 저장소가 배선되지 않았습니다')),
  delete: () => Promise.reject(new Error('이 앱에는 비밀 저장소가 배선되지 않았습니다')),
  forget: async () => {},
}

/** 확장 이름은 남의 문자열이라 해시로 접는다 (`storageStore.ts` 의 `fileOf` 와 같은 이유) */
function fileOf(root: string, extension: string): string {
  return join(root, `${createHash('sha256').update(extension).digest('hex').slice(0, 32)}.bin`)
}

export function createSecretStore(root: string, cipher: SecretCipher): ExtensionSecrets {
  /** 파일 하나의 읽고-고쳐-쓰기를 한 줄로 세운다 (`storageStore.ts` 의 `writing` 과 같은 이유) */
  const writing = new Map<string, Promise<unknown>>()

  const requireCipher = (): void => {
    if (!cipher.isEncryptionAvailable()) {
      throw new Error('OS 보안 저장소를 쓸 수 없어 비밀을 다루지 않습니다 (평문으로 저장하지 않습니다)')
    }
  }

  const change = (extension: string, edit: (bag: Record<string, string>) => void): Promise<void> => {
    const path = fileOf(root, extension)
    const mine = (writing.get(path) ?? Promise.resolve()).then(async () => {
      const bag = await read(path, cipher)
      edit(bag)
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${(tempSeq += 1)}.tmp`
      await writeFile(temporary, cipher.encryptString(JSON.stringify(bag)))
      await rename(temporary, path)
    })
    writing.set(
      path,
      mine.catch(() => {}),
    )
    return mine
  }

  return {
    async get(extension, key) {
      requireCipher()
      const bag = await read(fileOf(root, extension), cipher)
      return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : undefined
    },
    async set(extension, key, value) {
      requireCipher()
      await change(extension, (bag) => {
        bag[key] = value
      })
    },
    async delete(extension, key) {
      requireCipher()
      await change(extension, (bag) => {
        delete bag[key]
      })
    },
    async forget(extension) {
      await rm(fileOf(root, extension), { force: true })
    },
  }
}

let tempSeq = 0

/**
 * 없으면 빈 것. **못 푸는 파일은 빈 것으로 눙치지 않고 던진다** — 눙치면 다음 `set` 이 남은 비밀을
 * 전부 덮어 지운다 (키체인이 바뀐 경우 등). 확장을 지웠다 다시 깔면 풀린다.
 */
async function read(path: string, cipher: SecretCipher): Promise<Record<string, string>> {
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(cipher.decryptString(bytes))
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    throw new Error('저장된 비밀을 풀 수 없습니다 — OS 보안 저장소가 바뀌었을 수 있습니다')
  }
}

// ─── 지우기 정리 ─────────────────────────────────────────────────────────────
// 확장 지우기(`extensionManageHandlers.ts`)는 창 수명 브리지가 부르고 저장소는 앱 수명이다.
// 둘 사이를 잇는 방식은 AI 세션 장부와 같다 (`opencode/extensionSessions.ts` 의 `useExtensionSessionStore`).

let current: ExtensionSecrets | null = null

/** 앱이 뜰 때 한 번 건다 (`appLaunch.ts`) */
export function useExtensionSecretStore(store: ExtensionSecrets | null): void {
  current = store
}

/** 확장을 지웠다 — 그 확장의 비밀 파일을 지운다 */
export async function forgetExtensionSecrets(extension: string): Promise<void> {
  await current?.forget(extension)
}
