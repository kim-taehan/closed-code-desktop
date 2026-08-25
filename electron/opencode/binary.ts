import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

// opencode 실행 파일을 찾는다.
//
// **이 파일이 생기면서 "이 앱은 CLI 를 띄우지 않는다" 가 끝났다.** 원래 이 앱은 사용자가
// 손으로 띄운 서버 한 곳에 붙기만 했다 (`endpoint.ts`·`mcp/register.ts` 머리말이 그 근거를
// 적어 두었다 — 전부 고쳐 썼다). **프로젝트마다 우리가 띄운다. 붙기만 하는 길은 없다** —
// 폐쇄망 현장에서는 사용자가 `opencode serve` 를 칠 방법이 없기 때문이다
// (`serverPool.ts` 머리말). 서버가 갈리면 MCP 등록도 갈린다 (등록은 instance 수명이라
// 서버가 다르면 서로 안 보인다, 실측).
//
// ⚠️ **macOS 에서 GUI 로 띄운 앱은 셸 PATH 를 못 받는다.** Finder·Dock 에서 실행하면
// `process.env.PATH` 가 `/usr/bin:/bin:/usr/sbin:/sbin` 뿐이라, 터미널에서 `opencode` 가
// 보인다고 앱에서도 보이는 것이 아니다. 이 레포 CLAUDE.md 의 「PATH 가 비어 있다」와 같은
// 함정이고, 여기서는 **PATH 를 본 뒤 알려진 설치 자리를 직접 뒤지는 것**으로 막는다.
//
// **못 찾으면 어디를 봤는지 통째로 돌려준다.** 이 실패는 화면에 "연결 실패" 로만 보이는
// 종류라, 목록이 없으면 사용자가 무엇을 고쳐야 하는지 알 방법이 없다.
//
// **패키징한 앱은 실행 파일을 동봉해 간다 (2026-08-25).** 폐쇄망에는 npm·bun·curl 이 없어
// "따로 설치하세요" 가 성립하지 않는다 — `scripts/fetch-opencode.mjs` 가 받아 둔 것을
// electron-builder 가 `extraResources` 로 싣는다. 그래서 아래 탐색은 동봉을 **PATH 보다
// 먼저** 본다.

/** 알려진 설치 자리. 동봉·PATH 다음에 이 순서로 본다. */
function knownDirs(home: string): string[] {
  return [
    // bun 으로 설치한 자리 — 이 계정의 실측 위치다 (`~/.bun/bin/opencode` 심볼릭 링크)
    join(home, '.bun', 'bin'),
    join(home, '.opencode', 'bin'),
    join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
}

export interface BinaryLookup {
  /** 찾은 실행 파일. 못 찾으면 null */
  path: string | null
  /** 어디서 찾았는지 — 진단에 그대로 싣는다 */
  source?: string
  /** 본 자리 전부. 못 찾았을 때 화면에 그대로 보여준다 */
  searched: string[]
}

/** 실행 가능한 파일인지. 존재만 보면 디렉토리·읽기 전용 파일을 실행 파일로 오인한다. */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 동봉본을 판정하는 데 필요한 것만. **`electron` 을 import 하지 않는다** — 이 파일은
 * 실물 없이 도는 단위 시험이 겨누는 자리라, 여기서 electron 을 끌어들이면 이 모듈을
 * 거쳐 가는 시험들이 전부 `vi.mock('electron')` 을 달아야 한다.
 */
export interface BundleHost {
  /** `process.resourcesPath` — Electron 밖(단위 시험·스크립트)에서는 없다 */
  resourcesPath?: string | undefined
  /** `process.defaultApp` — `electron .` 로 띄운 개발 모드에서만 참 */
  defaultApp?: boolean | undefined
  platform: string
}

/**
 * 앱에 동봉된 실행 파일 자리. 패키징된 앱이 아니면 **null** 이다.
 *
 * ⚠️ **개발 모드를 반드시 걸러야 한다.** `npm run dev` 는 `electron .` 이고, 그때
 * `process.resourcesPath` 는 우리 앱이 아니라 **node_modules 의 electron 배포물**을
 * 가리킨다. 거기에 우리 것이 있을 리 없으니 결과는 같지만, 사용자에게 보여줄
 * 「찾아본 자리」에 거짓 자리가 한 줄 실린다.
 *
 * 판정은 `app.isPackaged` 와 같은 값을 `process` 에서 직접 읽는다 — Electron 문서가
 * `defaultApp` 을 "기본 실행 파일에 인자로 넘겨 띄웠을 때 참" 으로 정의한다
 * (`node_modules/electron/electron.d.ts:24255`). 순수 node 에서는 둘 다 없어서 null 이다.
 */
export function bundledBinary(host: BundleHost = process): string | null {
  if (host.resourcesPath === undefined || host.defaultApp === true) return null
  // `extraResources` 의 `to: opencode` 가 만든 자리. Windows 만 이름이 다르다 (실측).
  return join(host.resourcesPath, 'opencode', host.platform === 'win32' ? 'opencode.exe' : 'opencode')
}

/**
 * opencode 실행 파일을 찾는다.
 *
 * 순서는 **명시 지정 > 동봉 > PATH > 알려진 자리**다. `OPENCODE_BIN` 을 맨 앞에 두는 이유는
 * 우리가 못 찾는 자리에 깔린 사용자에게 되돌아갈 길을 주기 위해서다 — 아래 갈래들은
 * 우리가 아는 만큼만 보므로 언젠가 틀린다.
 *
 * **동봉이 PATH 를 이긴다.** 설치물은 앱과 짝이 맞춰 검증된 버전이어야 한다 — PATH 가
 * 이기면 현장 머신에 우연히 있던 다른 버전이 조용히 잡히고, 하한선(1.17.18) 미달이면
 * 증상이 "어댑터가 이벤트를 못 받는다" 류로 보여 진단이 비싸다. 다른 것을 쓰려는 사람에게는
 * `OPENCODE_BIN` 이 그대로 남아 있다.
 */
export function findOpencodeBinary(
  env: NodeJS.ProcessEnv = process.env,
  executable: (path: string) => boolean = isExecutable,
  bundled: string | null = bundledBinary(),
): BinaryLookup {
  const searched: string[] = []

  const explicit = env['OPENCODE_BIN']?.trim()
  if (explicit) {
    searched.push(`${explicit} (OPENCODE_BIN)`)
    if (executable(explicit)) return { path: explicit, source: 'OPENCODE_BIN', searched }
  }

  if (bundled !== null) {
    searched.push(`${bundled} (앱에 동봉)`)
    if (executable(bundled)) return { path: bundled, source: '앱에 동봉', searched }
  }

  const home = env['HOME']?.trim() || homedir()
  const fromPath = (env['PATH'] ?? '').split(delimiter).filter((dir) => dir.trim() !== '')

  for (const dir of [...fromPath, ...knownDirs(home)]) {
    const candidate = join(dir, 'opencode')
    // 같은 자리가 PATH 와 알려진 목록에 둘 다 있을 수 있다 — 목록에 두 번 적지 않는다
    if (searched.includes(candidate)) continue
    searched.push(candidate)
    if (executable(candidate)) {
      return { path: candidate, source: fromPath.includes(dir) ? 'PATH' : dir, searched }
    }
  }

  return { path: null, searched }
}

/**
 * 못 찾았을 때 화면에 띄울 문장. 본 자리를 다 적는다 — 이게 유일한 단서다.
 *
 * 목록에 「앱에 동봉」 줄이 있는데도 여기까지 왔다면 **빌드가 잘못 나간 것**이다
 * (`scripts/fetch-opencode.mjs` 를 안 돌리고 패키징). 현장에서 고칠 수 있는 것은
 * `OPENCODE_BIN` 뿐이라 문구는 그대로 둔다.
 */
export function notFoundMessage(lookup: BinaryLookup): string {
  return [
    'opencode 실행 파일을 찾지 못했습니다.',
    // 되돌아갈 길은 이제 하나뿐이다 — 설정의 서버 주소 칸이 없어졌다 (`serverPool.ts`).
    '`OPENCODE_BIN` 환경변수로 실행 파일 경로를 지정하거나, opencode 를 설치하세요.',
    '찾아본 자리:',
    ...lookup.searched.map((entry) => `  · ${entry}`),
  ].join('\n')
}
