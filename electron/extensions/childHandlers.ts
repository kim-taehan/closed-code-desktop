import {
  METHOD_ACTIVE_FILE,
  METHOD_LOAD_EXTENSIONS,
  METHOD_PING,
  METHOD_REDRAW,
  METHOD_RUN_COMMAND,
  type RpcRequest,
} from './rpc'
import { describeError } from '../../shared/errors/describeError'
import {
  loadExtensions,
  type RegisteredCommand,
  type ExtensionApiFor,
  type ExtensionSource,
  type LoadDeps,
  type RedrawHandler,
  type ActiveFileHandler,
} from './extensionLoader'
import type { ActiveFileRef } from './extensionLoader'

// 자식(확장 호스트)이 부모의 요청에 답하는 규칙.
//
// `hostEntry.ts` 에서 갈라냈다 — 저쪽은 최상위에서 `process.parentPort` 를 만져
// vitest 로 import 조차 안 된다(node 환경에서는 undefined). 판단이 거기 남으면
// **왕복의 절반이 영원히 테스트 밖에 있게 된다.**

/**
 * 요청 하나를 처리하는 함수를 만든다. 명령표는 이 함수의 클로저가 쥔다 —
 * 싣기(load)와 실행(run)이 같은 표를 봐야 하기 때문이다.
 *
 * 모르는 메서드는 **던진다.** 부르는 쪽(hostEntry)이 그것을 오류 응답으로 바꾼다 —
 * 삼키면 부모의 await 가 영원히 걸린다.
 */
export function createChildHandler(apiFor: ExtensionApiFor, deps: LoadDeps): (request: RpcRequest) => Promise<unknown> {
  let commands = new Map<string, RegisteredCommand>()
  let redraws: RedrawHandler[] = []
  let activeFiles: ActiveFileHandler[] = []

  return async (request) => {
    if (request.method === METHOD_PING) return { pid: process.pid }

    if (request.method === METHOD_LOAD_EXTENSIONS) {
      const result = await loadExtensions(toSources(request.params), apiFor, deps)
      commands = result.commands
      redraws = result.redraws
      activeFiles = result.activeFiles
      return { loaded: result.loaded, failed: result.failed }
    }

    if (request.method === METHOD_RUN_COMMAND) {
      const commandId = asRecord(request.params)['commandId']
      if (typeof commandId !== 'string') throw new Error('commandId 가 문자열이 아닙니다')

      const registered = commands.get(commandId)
      if (!registered) throw new Error(`등록되지 않은 명령입니다: ${commandId}`)

      // **주인 확인.** 확장 화면에서 온 명령에만 `extension` 이 실린다 — 그 화면을 낸
      // 확장이다. 명령표는 확장 전부가 나눠 쓰는 한 장이라, 대조하지 않으면 확장 A 의
      // 화면이 확장 B 의 명령을 돌릴 수 있다.
      //
      // **안 실려 오면 확인하지 않는다.** 사이드바 단추가 그 경로이고 거기는 앱이 그린
      // 화면이라 확장이 id 를 지어낼 자리가 없다. 옛 경로를 이번에 바꾸지 않는다.
      const owner = asRecord(request.params)['extension']
      if (typeof owner === 'string' && owner !== registered.extension) {
        throw new Error(`남의 확장 명령입니다: ${commandId} (${registered.extension})`)
      }

      // 확장이 async 로 써도 끝까지 기다린다 — 안 기다리면 부모가 완료를 오해한다.
      // `selection` 은 사용자가 화면에서 고른 것이고, 없으면 undefined 다.
      return await registered.handler(asRecord(request.params)['selection'])
    }

    if (request.method === METHOD_REDRAW) {
      // **한 확장이 터져도 나머지는 그린다.** 하나가 던져서 전부가 빈 화면이 되면,
      // 사용자는 저장한 것이 통째로 사라진 줄 안다.
      const failed: string[] = []
      for (const redraw of redraws) {
        try {
          await redraw()
        } catch (error) {
          failed.push(describeError(error))
        }
      }
      return { drawn: redraws.length - failed.length, failed }
    }

    if (request.method === METHOD_ACTIVE_FILE) {
      // **redraw 와 같은 규율** — 한 확장이 터져도 나머지는 받는다. 파일을 옮길 때마다
      // 도는 자리라, 하나가 던져서 전부가 멈추면 그 뒤로 아무도 안 따라온다.
      const file = toActiveFile(asRecord(request.params)['file'])
      const failed: string[] = []
      for (const handler of activeFiles) {
        try {
          await handler(file)
        } catch (error) {
          failed.push(describeError(error))
        }
      }
      return { notified: activeFiles.length - failed.length, failed }
    }

    throw new Error(`알 수 없는 메서드: ${request.method}`)
  }
}

/** 부모가 보낸 목록의 모양만 확인한다. 매니페스트 검증은 부모(registry)가 이미 했다. */
function toSources(params: unknown): ExtensionSource[] {
  const list = asRecord(params)['extensions']
  if (!Array.isArray(list)) return []
  return list.flatMap((item) => {
    const source = asRecord(item)
    const dir = source['dir']
    const manifest = asRecord(source['manifest'])
    return typeof dir === 'string' && typeof manifest['main'] === 'string'
      ? [{ dir, manifest: manifest as unknown as ExtensionSource['manifest'] }]
      : []
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/**
 * 부모가 보낸 활성 파일. **모양이 아니면 null 이다** — 빈 객체를 만들면 확장이
 * 「경로 없는 파일」을 받고, 그건 「아무것도 안 보고 있다」와 구분되지 않는다.
 */
function toActiveFile(value: unknown): ActiveFileRef | null {
  const record = asRecord(value)
  const path = record['path']
  if (typeof path !== 'string' || path.trim() === '') return null
  const line = record['line']
  return typeof line === 'number' && Number.isInteger(line) && line > 0 ? { path, line } : { path }
}
