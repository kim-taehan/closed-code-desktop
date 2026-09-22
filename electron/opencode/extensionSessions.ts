import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// **확장 전용 AI 세션의 장부** — (확장 × 프로젝트) → opencode 세션 id (확장 재설계 §2-3, 결정 F2·F3).
//
// 이 장부가 하는 일은 둘이다.
//   1. 같은 확장이 같은 프로젝트에서 다시 물으면 **같은 세션**으로 묻는다 (`extensionRun.ts`).
//   2. 여기 적힌 id 를 **대화 이력 목록에서 뺀다** (`historyApi.ts` 의 `listSessions`).
//
// ## 왜 opencode 에 기대지 않나 (U-A, 2026-09-22 실측 — 안 B)
//
// `parentID` 를 달면 `roots=true` 질의에서 빠지지만, 그 질의 하나에만 기대게 되고 없는 부모도
// 받아 주며 부모를 지우면 자식이 연쇄 삭제된다. 그래서 **우리가 만든 id 를 우리가 적어 두고**
// 목록에서 뺀다. opencode 의 세션 저장소는 서버끼리 공유되므로(`serverPool.ts` ⚠️) id 하나로
// 어느 프로젝트 목록에서든 뺄 수 있다.
//
// ## 지운 확장의 세션은 **계속 숨긴다**
//
// 확장을 지우면 그 확장의 줄은 장부에서 빠진다 — 다시 깔면 새 세션으로 시작한다. 그런데 id 를
// 같이 버리면 그 세션이 **사용자 대화 이력에 튀어나온다** (opencode 에는 그대로 남아 있다).
// 그래서 `retired` 에 옮겨 숨김만 유지한다. 서버에서 지우지 않는 이유: 지우는 순간 어느 서버도
// 떠 있지 않을 수 있다.
//
// ## 앱에 하나다 — 그리고 모듈이 쥔다
//
// 이력 목록(`historyApi.ts`)은 `transport.ts`(300줄 상한)가 만든 클라이언트를 거쳐 불리고,
// 그 배선은 `electron/session/*` 에 있다. 장부를 인자로 흘려 넣으려면 그 둘을 고쳐야 해서,
// **앱 수명 장부 하나를 이 모듈이 쥐고** 두 쓰는 곳(이력·지우기)이 함수로 묻는다.
// 걸기 전(시험·기동 전)에는 아무것도 숨기지 않는다.
//
// **electron 을 import 하지 않는다** — 파일 경로는 부르는 쪽(`appLaunch.ts`)이 준다.

interface Ledger {
  /** `JSON.stringify([extension, projectId])` → 세션 id */
  sessions: Record<string, string>
  /** 지운 확장이 쓰던 세션. 목록에서 계속 뺀다 (머리말) */
  retired: string[]
}

export class ExtensionSessionStore {
  private ledger: Ledger

  constructor(private readonly path: string) {
    this.ledger = readLedger(path)
  }

  get(extension: string, projectId: string): string | undefined {
    return this.ledger.sessions[keyOf(extension, projectId)]
  }

  set(extension: string, projectId: string, sessionId: string): void {
    this.ledger.sessions[keyOf(extension, projectId)] = sessionId
    this.save()
  }

  /** 우리가 만든 확장 세션인가 — 지운 확장 것까지 */
  has(sessionId: string): boolean {
    return Object.values(this.ledger.sessions).includes(sessionId) || this.ledger.retired.includes(sessionId)
  }

  /** 확장을 지웠다. 그 확장의 줄을 빼되 id 는 숨김으로 남긴다 (머리말) */
  forget(extension: string): void {
    const kept: Record<string, string> = {}
    const retired = [...this.ledger.retired]
    for (const [key, id] of Object.entries(this.ledger.sessions)) {
      if ((JSON.parse(key) as string[])[0] === extension) retired.push(id)
      else kept[key] = id
    }
    this.ledger = { sessions: kept, retired }
    this.save()
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    // 반쯤 쓴 파일을 남기지 않는다 — 깨지면 숨기던 세션이 전부 이력에 튀어나온다
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, JSON.stringify(this.ledger), 'utf8')
    renameSync(temporary, this.path)
  }
}

/** 없거나 깨진 파일은 빈 장부 — 확장은 새 세션으로 시작한다 */
function readLedger(path: string): Ledger {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Ledger>
    const sessions = parsed.sessions !== null && typeof parsed.sessions === 'object' ? parsed.sessions : {}
    const retired = Array.isArray(parsed.retired) ? parsed.retired.filter((id) => typeof id === 'string') : []
    return { sessions: { ...sessions }, retired }
  } catch {
    return { sessions: {}, retired: [] }
  }
}

/** 확장 이름과 프로젝트 id 둘 다 남의 문자열이라 구분자로 잇지 않는다 (`uiHandlers.ts` 와 같은 규칙) */
function keyOf(extension: string, projectId: string): string {
  return JSON.stringify([extension, projectId])
}

let current: ExtensionSessionStore | null = null

/** 앱이 뜰 때 한 번 건다 (`appLaunch.ts`). 시험은 걸었다가 null 로 푼다 */
export function useExtensionSessionStore(store: ExtensionSessionStore | null): void {
  current = store
}

/** 이력 목록에서 뺄 세션인가 (`historyApi.ts`) */
export function isExtensionSession(sessionId: string | undefined): boolean {
  return sessionId !== undefined && (current?.has(sessionId) ?? false)
}

/** 확장을 지웠다 (`extensionManageHandlers.ts`) */
export function forgetExtensionSessions(extension: string): void {
  current?.forget(extension)
}
