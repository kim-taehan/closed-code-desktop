/**
 * 확장 호스트 자식 프로세스의 엔트리 (utilityProcess.fork 의 대상).
 *
 * **`electron` 을 import 하지 않는다.** utilityProcess 자식에는 app/BrowserWindow 가 없고,
 * 부모와의 통로는 `process.parentPort` 하나뿐이다 (electron.d.ts:24290-24293).
 * import 하는 순간 자식이 기동 즉시 죽는다. — 같은 이유로 `./rpc` 도 electron 을 쓰지 않는다.
 *
 * 이 파일은 **배선만** 한다. 요청 처리는 `childHandlers.ts`, 확장을 싣는 판단은
 * `extensionLoader.ts`, 확장에 넘길 표면은 `davisApi.ts` 에 있다 —
 * 여기는 vitest 로 돌릴 수 없어서다(최상위에서 parentPort 를 만진다).
 */
import {
  createNotice,
  createRequest,
  errorResponse,
  NOTICE_AGENT_ACTIVITY,
  NOTICE_READY,
  NOTICE_SHUTDOWN,
  okResponse,
  parseFromParent,
  PendingRequests,
} from './rpc'
import type { RpcRequest } from './rpc'
import { createDavisApi } from './davisApi'
import { deliverAgentActivity } from './agentActivityBus'
import { createChildHandler } from './childHandlers'

const port = process.parentPort
const pending = new PendingRequests()

/** 확장이 부른 davis.* 를 부모에게 넘긴다. 부모가 거부하면 확장 쪽에서 던진다. */
function call(method: string, params?: unknown): Promise<unknown> {
  const message = createRequest(method, params)
  const waiting = pending.track(message.id)
  port.postMessage(message)
  return waiting
}

// **확장마다 따로 만든다** — 하나를 돌려 쓰면 storage 가 어느 확장 것인지 알 수 없다.
const handle = createChildHandler((name, label) => createDavisApi(call, name, label), {
  // 확장은 앱 번들 밖(~/.davis-code)에 있어 번들러가 손대지 않는다. 런타임 require 그대로다.
  requireModule: (absolutePath) => require(absolutePath),
  log: (line) => console.log(line),
})

port.on('message', (event) => {
  // 자식은 페이로드를 event.data 에 싸서 받는다. 껍질을 벗기는 곳은 rpc.ts 하나다.
  const message = parseFromParent(event)
  if (!message) return

  if (message.kind === 'response') {
    if (!pending.settle(message)) console.error(`[ext-host] 짝 없는 응답 id=${message.id}`)
    return
  }
  if (message.kind === 'notice') {
    if (message.method === NOTICE_SHUTDOWN) shutdown()
    // 어시스턴트가 답하는 도중의 활동. **모양이 아니면 조용히 버린다** — 곁가지 하나가
    // 확장 호스트를 죽이면 도는 명령이 통째로 날아간다.
    if (message.method === NOTICE_AGENT_ACTIVITY) {
      const params = (message.params ?? {}) as Record<string, unknown>
      if (typeof params['extension'] === 'string' && typeof params['text'] === 'string') {
        deliverAgentActivity(params['extension'], {
          kind: typeof params['kind'] === 'string' ? params['kind'] : 'text',
          text: params['text'],
        })
      }
    }
    return
  }
  void respond(message)
})

/** 모르는 메서드도 반드시 답한다 — 삼키면 부모의 await 가 영원히 걸린다. */
async function respond(request: RpcRequest): Promise<void> {
  try {
    port.postMessage(okResponse(request.id, await handle(request)))
  } catch (error) {
    port.postMessage(errorResponse(request.id, error instanceof Error ? error.message : String(error)))
  }
}

function shutdown(): void {
  // ParentPort 에는 close() 가 없다 (electron.d.ts:9680-9697). 걸어둔 리스너가 이벤트 루프를
  // 붙잡고 있어 스스로 끝나지 않으므로 직접 나간다.
  // 코드 0 = 정상 종료. 부모의 크래시 판정(code !== 0)이 이 값에 걸려 있다.
  process.exit(0)
}

// 요청 없이 먼저 보낸다 — 부모가 "떴다" 를 아는 유일한 신호이고,
// 부모는 이걸 받고서야 확장 목록을 싣는다.
// __dirname 은 asar 안이면 `.../app.asar/dist-electron/electron/extensions` 로 찍힌다.
port.postMessage(createNotice(NOTICE_READY, { pid: process.pid, dirname: __dirname }))

console.log(`[ext-host] booted pid=${process.pid} dir=${__dirname}`)
