import { app } from 'electron'
import { join } from 'node:path'

// 실행 목록 저장소의 **자리 하나**. `~/Library/Application Support/open-code-desktop/run-lists/`.
//
// 여기만 electron 을 안다. 목록을 읽고 쓰는 쪽(`runListStore.ts`·`mcp/saveRunCommands.ts`·
// `ipc/runListHandlers.ts`)은 전부 폴더를 **인자로 받는다** — 시험이 임시 폴더를 그대로
// 끼울 수 있어야 하고, 그쪽 모듈이 electron 을 물어 오면 그게 안 된다.
//
// **부르는 곳은 배선 둘뿐이다**: `mcp/appWiring.ts`(도구가 적는 길)와
// `ipc/projectBridge.ts`(화면이 읽는 길). 둘이 같은 폴더를 봐야 한다는 것이 이 파일의 전부다.
//
// `app.getPath('userData')` 는 ready 이전에도 답한다 (`main.ts` 머리말) — 부르는 시점을
// 재지 않아도 된다.

export function runListDir(): string {
  return join(app.getPath('userData'), 'run-lists')
}
