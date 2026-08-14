import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

// opencode 실행 파일을 찾는다.
//
// **이 파일이 생기면서 "이 앱은 CLI 를 띄우지 않는다" 가 끝났다.** 원래 이 앱은 사용자가
// 손으로 띄운 서버 한 곳에 붙기만 했다 (`endpoint.ts`·`mcp/register.ts` 머리말이 그 근거를
// 적어 두었다). 설정 `opencodeUrl` 이 비면 **프로젝트마다 우리가 띄운다** — 그래야 MCP 등록이
// 프로젝트별로 갈린다 (MCP 등록은 instance 수명이라 서버가 갈리면 서로 안 보인다, 실측).
//
// ⚠️ **macOS 에서 GUI 로 띄운 앱은 셸 PATH 를 못 받는다.** Finder·Dock 에서 실행하면
// `process.env.PATH` 가 `/usr/bin:/bin:/usr/sbin:/sbin` 뿐이라, 터미널에서 `opencode` 가
// 보인다고 앱에서도 보이는 것이 아니다. 이 레포 CLAUDE.md 의 「PATH 가 비어 있다」와 같은
// 함정이고, 여기서는 **PATH 를 본 뒤 알려진 설치 자리를 직접 뒤지는 것**으로 막는다.
//
// **못 찾으면 어디를 봤는지 통째로 돌려준다.** 이 실패는 화면에 "연결 실패" 로만 보이는
// 종류라, 목록이 없으면 사용자가 무엇을 고쳐야 하는지 알 방법이 없다.

/** 알려진 설치 자리. PATH 다음에 이 순서로 본다. */
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
 * opencode 실행 파일을 찾는다.
 *
 * 순서는 **명시 지정 > PATH > 알려진 자리**다. `OPENCODE_BIN` 을 맨 앞에 두는 이유는
 * 우리가 못 찾는 자리에 깔린 사용자에게 되돌아갈 길을 주기 위해서다 — 아래 두 갈래는
 * 우리가 아는 만큼만 보므로 언젠가 틀린다.
 */
export function findOpencodeBinary(
  env: NodeJS.ProcessEnv = process.env,
  executable: (path: string) => boolean = isExecutable,
): BinaryLookup {
  const searched: string[] = []

  const explicit = env['OPENCODE_BIN']?.trim()
  if (explicit) {
    searched.push(`${explicit} (OPENCODE_BIN)`)
    if (executable(explicit)) return { path: explicit, source: 'OPENCODE_BIN', searched }
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

/** 못 찾았을 때 화면에 띄울 문장. 본 자리를 다 적는다 — 이게 유일한 단서다. */
export function notFoundMessage(lookup: BinaryLookup): string {
  return [
    'opencode 실행 파일을 찾지 못했습니다.',
    '설정에서 `opencodeUrl` 에 이미 띄운 서버 주소를 넣거나, `OPENCODE_BIN` 으로 경로를 지정하세요.',
    '찾아본 자리:',
    ...lookup.searched.map((entry) => `  · ${entry}`),
  ].join('\n')
}
