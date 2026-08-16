// 돌다가 깨지면 스스로 고친다 — **판정과 문구**만 여기 있다 (설계 2026-08-16 §4).
//
// 언제 시작하나 · 몇 번 도나 · 실패한 뒤엔 뭘 하나는 `useRunHeal.ts` 다. 가른 자리가
// 설계 §5 의 「경계」 그대로다: *판정과 문구는 렌더러 순수 함수에.* 그래야 화면 없이 단언할
// 수 있고, 자가 복구(`healNotice.ts`)가 이미 같은 모양으로 서 있다.
//
// ## 처방은 실측으로만 늘린다 — 지금 **하나뿐**이다 (의존성 없음 → 설치)
//
// 그럴듯한 목록을 미리 만들면 **틀린 처방이 조용히 돈다** (설계 §4 표) — 틀린 처방은 안 도는
// 것보다 나쁘다: 사용자 프로젝트를 흔들어 놓고 증상은 그대로다. 그래서 **직접 재고 넣었다**
// (Node v22.18.0, 임시 폴더에 `npm run dev` 로 재현, 2026-08-16):
//
// | 무엇이 없나 | 로그에 나오는 문장 | 처방 |
// |---|---|---|
// | 의존성 (CJS) | `Error: Cannot find module 'vite'` | 설치 |
// | 의존성 (ESM) | `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from …` | 설치 |
// | 그 프로젝트 안의 파일 (CJS) | `Cannot find module './nope'` | **없음** |
// | 그 프로젝트 안의 파일 (ESM) | `Cannot find module '/abs/path/nope.js' imported from …` | **없음** |
//
// ⚠️ **아래 두 줄이 이 표의 값이다.** ESM 은 낱말이 `package` 로 갈리고(안 재 봤으면 최신
// 프로젝트 대부분을 놓쳤다), **파일을 못 찾은 ESM 은 낱말이 `module` 인 채 따옴표 안이
// 절대경로다** — 경로 판정이 없으면 설치가 돌고 아무것도 안 고쳐진다.
//
// **아직 못 잰 이웃은 안 넣는다.** 파이썬의 `ModuleNotFoundError`, gradle 의 의존성 해석
// 실패 — 문구도 처방도 그럴듯하지만 재 본 적이 없다. 재는 날 위 표에 한 줄씩 는다.
// 그때까지 그 실패들은 아무 일도 안 일어나고, 사용자가 로그를 직접 본다 (그 편이 옳다).

/** 아는 실패 하나. 늘어나면 여기가 유니온이 된다 */
export interface Prescription {
  id: 'missing-module'
  /** 못 찾은 것. **사용자에게 보이는 근거**라 지어내지 않고 로그에서 뽑는다 */
  missing: string
  /** 우리가 돌릴 명령 (`npm install` 등). 원래 명령은 `fixLine` 이 뒤에 붙인다 */
  fix: string
}

/**
 * 이 출력에 아는 실패가 있나. **없으면 null 이고, 그때는 아무 일도 안 일어난다.**
 *
 * `command` 를 함께 받는 이유는 처방이 그것에서 나오기 때문이다 (`packageManagerOf`) —
 * 무엇으로 설치할지 모르면 실패를 알아봐도 할 일이 없다.
 */
export function prescribe(output: string, command: string): Prescription | null {
  const missing = missingModule(output)
  if (missing === null) return null
  const manager = packageManagerOf(command)
  if (manager === null) return null
  return { id: 'missing-module', missing, fix: `${manager} install` }
}

/**
 * 실제로 칸에 넣을 한 줄. **`&&` 다** — 설치가 실패하면 다시 띄우지 않는다.
 *
 * `;` 로 이으면 설치가 깨진 채로 원래 명령이 또 돌아 같은 실패가 한 벌 더 쌓인다.
 * 대신 잃는 것을 적어 둔다: **설치 자체가 실패한 경우는 우리가 못 알아챈다** — 같은 실패가
 * 다시 나야 「막혔다」로 가는데(`useRunHeal`), 다시 띄우지 않았으니 안 난다. 그때 화면은
 * 조용히 내려가고 사용자는 드로어의 설치 오류를 본다. 설치 실패를 실측하면 그때 처방이
 * 하나 더 는다.
 */
export function fixLine(rx: Prescription, command: string): string {
  return `${rx.fix} && ${command}`
}

/** 「이 칸은 지금 무엇을 겪고 있나」 — 세 칸이 곧 화면의 세 문장이다 */
export type RunHealPhase = 'announce' | 'healing' | 'stuck'

export interface RunHealNotice {
  /** 예고를 앞세운 한 줄 (`healNotice.ts` 와 같은 규칙) */
  headline: string
  /** 근거 — 로그에서 뽑은 것. 지어내지 않는다 */
  detail: string
  /** 도는 표시를 낼 자리인가. **예고 칸에서는 아직 아무것도 안 돈다** */
  spinning: boolean
  /**
   * 손잡이에 적을 말. 칸마다 **하는 일이 다르다** — 예고 칸에서는 아직 안 한 일을 물리는
   * 것이고(그래서 「지금은 그만」), 그 뒤로는 이미 나간 명령이라 화면을 내리는 것뿐이다.
   * 같은 버튼에 같은 말을 쓰면 뒤엣것이 "설치를 취소한다" 로 읽힌다.
   */
  dismissLabel: string
}

/**
 * 지금 상태를 화면 문구로 옮긴다.
 *
 * **예고가 축이다** (설계 §4 · Doctor 설계 §3 과 같다). 무거운 조치가 **일어난 뒤에**
 * 알리면 사용자는 자기가 겪은 일을 사후에 통보받을 뿐이고, 멈출 기회를 못 가진다.
 * 그래서 `announce` 는 **아직 안 한 일**을 말하고, 몇 초 뒤인지까지 적는다 — 그 몇 초가
 * 「지금은 그만」을 누를 시간이다.
 */
export function runHealNotice(
  pane: string,
  command: string,
  rx: Prescription,
  phase: RunHealPhase,
  graceMs: number,
): RunHealNotice {
  const detail = `\`${pane}\` 로그: 모듈 \`${rx.missing}\` 을 찾지 못했습니다`
  if (phase === 'announce') {
    return {
      headline: `\`${pane}\` 의 의존성이 없습니다. ${Math.round(graceMs / 1000)}초 뒤 \`${rx.fix}\` 를 돌리고 다시 띄웁니다`,
      detail,
      spinning: false,
      dismissLabel: '지금은 그만',
    }
  }
  if (phase === 'healing') {
    return {
      headline: `\`${fixLine(rx, command)}\` 를 돌리는 중…`,
      detail,
      spinning: true,
      dismissLabel: '닫기',
    }
  }
  // **자동은 한 바퀴만**이라 여기서 멈춘다 (설계 §4). 다음에 할 일을 사람에게 넘긴다 —
  // 같은 조건에서 또 설치하면 그게 설치 루프고, 그 사이 사용자 프로젝트가 계속 흔들린다.
  return {
    headline: `\`${rx.fix}\` 로도 못 고쳤습니다 — \`${pane}\` 에서 같은 실패가 다시 났습니다`,
    detail: `${detail}. 자동 복구는 한 바퀴만 돕니다 — 드로어에서 직접 확인해 주세요`,
    spinning: false,
    dismissLabel: '닫기',
  }
}

/**
 * 로그에서 못 찾은 의존성 이름을 뽑는다. 없으면 null.
 *
 * **낱말이 둘이다** — CJS 는 `module`, ESM 은 `package` 다 (머리말의 표, 실측). 하나만
 * 보면 요즘 프로젝트 대부분(`"type": "module"`)에서 아무 일도 안 일어난다.
 *
 * **따옴표 형태만 받는다** — Node 가 내는 문장이 그렇고, 이름을 못 뽑으면 근거를 화면에
 * 못 적고 아래 경로 판정도 못 한다.
 */
function missingModule(output: string): string | null {
  const hit = /Cannot find (?:module|package) '([^']+)'/.exec(stripAnsi(output))
  const spec = hit?.[1] ?? ''
  // ⚠️ **상대·절대 경로는 설치로 안 고쳐진다** — 그 프로젝트 안의 파일을 못 찾은 것이다.
  // 안 가르면 `npm install` 이 멀쩡히 성공한 뒤 같은 실패가 그대로 다시 나고, 사용자는
  // 우리가 왜 아무 소용 없는 짓을 했는지 모른다.
  //
  // **절대경로 갈래는 지어낸 걱정이 아니다** — ESM 에서 `./nope.js` 를 못 찾으면 따옴표
  // 안이 통째로 절대경로가 된다 (머리말의 표, 실측). 이 한 줄이 그 경우를 막는다.
  if (spec === '' || spec.startsWith('.') || spec.startsWith('/')) return null
  return spec
}

/** 아는 패키지 관리자. 여기 없으면 처방이 없다 */
const MANAGERS: readonly string[] = ['npm', 'pnpm', 'yarn', 'bun']

/**
 * 무엇으로 설치하나. **실행 명령의 첫 낱말에서만 읽는다 — 파일을 뒤지지 않는다.**
 *
 * 락파일을 보는 길(`pnpm-lock.yaml` 이 있으면 pnpm)도 있지만 그건 앱이 프로젝트를 규칙으로
 * 알아내는 일이고, 이 설계는 그 길을 이미 한 번 거절했다 (설계 §2 「규칙으로 알아내지
 * 않는다」). 목록의 명령은 **모델이 프로젝트를 읽고 정한 것**이라 답이 이미 들어 있다.
 *
 * 첫 낱말이 모르는 이름이면 null — `make dev` 가 속으로 npm 을 쓰더라도 우리는 모른다.
 * **모르면 아무것도 안 한다.**
 */
function packageManagerOf(command: string): string | null {
  const head = command.trim().split(/\s+/)[0] ?? ''
  return MANAGERS.includes(head) ? head : null
}

/**
 * 색을 벗긴다. 로그는 pty 바이트 그대로라 이스케이프가 섞여 있다 (`outputBuffer.ts` 가
 * 일부러 안 벗긴다 — 벗기는 것은 읽는 층의 일이다).
 *
 * `electron/mcp/readLogs.ts` 에 같은 함수가 있다. **합치지 않는다** — 저쪽은 main, 이쪽은
 * 렌더러라 tsconfig 가 갈려 있고, 공유하려면 `shared/` 로 옮겨야 하는데 그 이사는 이 두
 * 줄이 값을 못 한다. (세 번째 사본이 생기면 그때 옮긴다.)
 */
function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
}
