import { logStore } from '../logs/logStore'
import type { FrameMirror } from '../ipc/frameSink'
import { RemoteService, type RemoteDeps } from './service'

// 원격 채널을 **앱 상태에 잇는** 자리. 선례이자 쌍둥이는 `electron/mcp/appWiring.ts` 다 —
// 거기 적힌 A7 경고가 여기에도 글자 그대로 적용된다.
//
// ## `main.ts` 에 한 줄만 들어가게 한다
//
// `main.ts` 는 298줄로 300줄 상한에 닿아 있다 (계획 §6 이 이 위험을 「높다」로 적었다). 그래서
// 배선은 전부 이 파일이 지고, 저쪽에는 훅 한 줄만 남는다. 앱 수명 인스턴스를 모듈 변수로 쥐는
// 것도 `main.ts` 의 `desktopMcp ??=` 와 같은 모양이고, 옮겨온 이유가 그 한 줄이다.
//
// ## ⚠️ 첫 호출의 `deps` 만 쓴다
//
// `??=` 라서 두 번째 창이 넘긴 `deps` 는 버려진다. 그래서 `deps` 의 항목은 **전부 함수**여야 한다 —
// macOS 는 창을 다 닫아도 앱이 살아 있고(`window-all-closed` 가 quit 하지 않는다) 독에서 되살리면
// `createWindow()` 가 **새 registry** 를 만든다. 값으로 받으면 죽은 세대를 영영 바라본다
// (`mcp/appWiring.ts` 가 같은 함정에서 「화면이 없어 파일을 열지 못했습니다」만 돌려주던 그 자리).

let service: RemoteService | null = null

/**
 * 앱 수명 원격 서비스를 (없으면) 띄우고 **프레임 미러**를 돌려준다.
 *
 * 돌려주는 것이 서비스가 아니라 함수인 이유: `main.ts` 가 필요한 것은 `SessionBridge` 훅 하나이고,
 * 서비스를 건네면 저쪽이 그 인스턴스를 들고 있게 된다 (창 수명 변수에 앱 수명 물건이 앉는다).
 */
export function remoteFrameMirror(deps: Omit<RemoteDeps, 'log'>): FrameMirror {
  // 로그는 여기서 꽂는다 — 연결·명령은 남겨야 하고(계획 §3 「보이게」) 그 판단이 `main.ts` 로
  // 새어 나갈 이유가 없다
  service ??= new RemoteService({ ...deps, log: (line) => logStore.add('desktop', line) })
  return service.mirror
}

/**
 * 앱이 끝난다. 지금은 링크를 놓고 기억을 버리는 것뿐이다.
 *
 * ⚠️ **전송이 붙으면 이 자리에 끌 순서가 들어온다** — 광고 중지 → 서비스 해제 → 연결 끊기 →
 * 모듈 놓기. P0 측정에서 bleno 가 `SIGTERM` 을 받고 `abort()` 로 죽었고(계획 §13), 제품에서는
 * 그게 **앱을 닫을 때마다 크래시로 잡힌다.**
 */
export function disposeRemote(): void {
  service?.dispose()
  service = null
}
