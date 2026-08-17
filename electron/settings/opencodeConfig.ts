import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { describeError } from '../../shared/errors/describeError'
import { dirname, join } from 'node:path'

// opencode 자신의 설정 파일을 읽고 쓴다.
//
// **이 앱의 설정(`settings.json`)과 다른 물건이다.** 이쪽은 opencode 서버가 읽는 파일이고,
// 모델·프로바이더·MCP 가 여기서 정해진다. 앱은 그 서버에 붙을 뿐이라 원래는 안 건드렸는데,
// MCP 를 붙이려면 결국 이 파일을 봐야 해서 화면에 꺼냈다 (사용자 결정 2026-08-13).
//
// **자리가 둘이고 둘 다 먹는다** — 프로젝트(`<루트>/opencode.json`)가 전역
// (`$XDG_CONFIG_HOME/opencode/opencode.json`, 없으면 `~/.config/…`) 위에 얹힌다.
// **고치는 것은 프로젝트뿐이다** — 전역은 보기만 한다 (사용자 결정: 전역은 관리하기 어렵다).
//
// **언제 읽히는가** (실측): 서버가 **처음 만지는 디렉토리**면 서버를 다시 안 띄워도 읽는다 —
// 서버가 도는 중에 새 폴더에 파일을 만들었더니 그대로 잡혔다. 그러나 **한 번 읽은 뒤에는
// 들고 있다** — 같은 파일에 키를 더해도 `GET /config` 는 옛 값을 계속 줬다.
// 그래서 이미 붙어 있는 프로젝트의 파일을 고치면 **서버를 다시 띄워야** 반영된다.
//
// ⚠️ **`~/.config/opencode/mcp.json` 은 opencode 가 읽지 않는다.** 그 파일이 있는 계정에서
// 거기 적힌 서버가 `GET /mcp` 에 한 번도 나오지 않았다 — `mcpServers` 는 다른 도구의 규격이다.
//
// ⚠️ **저장해도 즉시 반영되지 않는다.** 서버가 디렉토리별로 설정을 한 번 읽고 들고 있다 —
// 이미 읽은 뒤에 키를 더하니 `GET /config` 에 안 나타났다. 그래서 쓰기 결과에
// `needsReload` 를 실어 화면이 "서버를 다시 띄워야 한다" 를 말할 수 있게 한다.

export type ConfigScope = 'global' | 'project'

export interface ConfigFile {
  scope: ConfigScope
  path: string
  /** 파일 원문. 없으면 null (오류가 아니다 — 안 만들었을 뿐이다) */
  content: string | null
  /** 읽지 못한 사유. 없으면 읽은 것이다. */
  error?: string
}

export interface OpencodeConfigResult {
  /** 전역 · (열린 프로젝트가 있으면) 프로젝트 순. */
  files: ConfigFile[]
  /** 서버가 합쳐서 **지금 실제로 쓰는** 설정. 못 받으면 없다. */
  effective?: unknown
  effectiveError?: string
  /**
   * 지금 붙어 있는 MCP 서버와 그 상태 (`GET /mcp`).
   *
   * 설정에 적혀 있는 것과 **실제로 붙은 것은 다르다** — 설정 파일에만 있고 안 붙은 경우도,
   * 반대로 파일에 없는데 붙어 있는 경우(이 앱이 `POST /mcp` 로 넣은 것)도 있다.
   */
  mcp?: Record<string, { status?: string; error?: string }>
}

export function globalConfigPath(): string {
  const base = process.env['XDG_CONFIG_HOME']?.trim()
  return join(base && base !== '' ? base : join(homedir(), '.config'), 'opencode', 'opencode.json')
}

export function projectConfigPath(projectRoot: string): string {
  return join(projectRoot, 'opencode.json')
}

/** 파일 둘과, 서버가 합친 유효 설정을 함께 준다. 하나가 실패해도 나머지는 돌려준다. */
export async function readOpencodeConfig(
  projectRoot: string,
  opencodeUrl: string,
): Promise<OpencodeConfigResult> {
  const targets: { scope: ConfigScope; path: string }[] = [
    { scope: 'global', path: globalConfigPath() },
    ...(projectRoot.trim() === ''
      ? []
      : [{ scope: 'project' as const, path: projectConfigPath(projectRoot) }]),
  ]

  const [files, effective, mcp] = await Promise.all([
    Promise.all(targets.map(readOne)),
    effectiveConfig(projectRoot, opencodeUrl),
    mcpStatus(projectRoot, opencodeUrl),
  ])
  return { ...effective, ...(mcp ? { mcp } : {}), files }
}

/** 실패하면 그냥 없는 셈 친다 — 설정 화면이 이것 때문에 막히면 안 된다. */
async function mcpStatus(
  projectRoot: string,
  opencodeUrl: string,
): Promise<Record<string, { status?: string; error?: string }> | null> {
  const base = opencodeUrl.trim().replace(/\/+$/, '')
  if (base === '' || projectRoot.trim() === '') return null
  try {
    // ⚠️ 평문 `directory=` 다 (`client.ts` 의 `addMcpServer` 와 같은 규칙)
    const response = await fetch(`${base}/mcp?directory=${encodeURIComponent(projectRoot)}`)
    if (!response.ok) return null
    return (await response.json()) as Record<string, { status?: string; error?: string }>
  } catch {
    return null
  }
}

async function readOne({ scope, path }: { scope: ConfigScope; path: string }): Promise<ConfigFile> {
  try {
    return { scope, path, content: await readFile(path, 'utf8') }
  } catch (error) {
    // 없는 것은 오류가 아니다 — 아직 안 만든 상태를 그대로 보여 준다
    if (isMissing(error)) return { scope, path, content: null }
    return { scope, path, content: null, error: describeError(error) }
  }
}

async function effectiveConfig(
  projectRoot: string,
  opencodeUrl: string,
): Promise<{ effective?: unknown; effectiveError?: string }> {
  const base = opencodeUrl.trim().replace(/\/+$/, '')
  if (base === '') return { effectiveError: 'opencode 서버 주소가 없습니다' }

  // 디렉토리마다 합쳐진 결과가 다르다 — 프로젝트 파일이 전역 위에 얹히기 때문이다
  const query = projectRoot.trim() === '' ? '' : `?directory=${encodeURIComponent(projectRoot)}`
  try {
    const response = await fetch(`${base}/config${query}`)
    if (!response.ok) return { effectiveError: `유효 설정 조회 실패 (HTTP ${response.status})` }
    return { effective: await response.json() }
  } catch (error) {
    return { effectiveError: describeError(error) }
  }
}

export interface WriteResult {
  ok: boolean
  /** 실패 사유. JSON 이 깨졌으면 여기에 온다 (그 경우 파일은 건드리지 않는다). */
  error?: string
  /** 덮어쓰기 전에 남긴 사본. 새로 만든 경우엔 없다. */
  backupPath?: string
  /** 서버가 이미 읽은 설정은 안 바뀐다 — 화면이 다시 띄우라고 말해야 한다 */
  needsReload: boolean
}

/**
 * 설정 파일을 쓴다. **깨진 JSON 은 쓰지 않는다.**
 *
 * opencode 는 설정이 깨지면 아예 안 뜬다. 화면에서 고치다 오타 하나로 서버를 못 띄우게
 * 만드는 것이 가장 나쁜 결과라, 파싱에 실패하면 파일을 건드리지 않고 사유만 돌려준다.
 * 덮어쓰기 전에는 `.bak` 을 남긴다 — 되돌릴 자리가 있어야 한다.
 */
export async function writeOpencodeConfig(path: string, content: string): Promise<WriteResult> {
  try {
    JSON.parse(content)
  } catch (error) {
    return { ok: false, error: `JSON 이 아닙니다: ${describeError(error)}`, needsReload: false }
  }

  let backupPath: string | undefined
  try {
    const existing = await readFile(path, 'utf8').catch((error: unknown) => {
      if (isMissing(error)) return null
      throw error
    })
    if (existing !== null) {
      backupPath = `${path}.bak`
      await copyFile(path, backupPath)
    } else {
      // 전역 설정을 처음 만드는 경우 `~/.config/opencode` 자체가 없을 수 있다
      await mkdir(dirname(path), { recursive: true })
    }

    await writeFile(path, content, 'utf8')
    return { ok: true, needsReload: true, ...(backupPath ? { backupPath } : {}) }
  } catch (error) {
    return { ok: false, error: describeError(error), needsReload: false }
  }
}

/**
 * 이 프로젝트의 opencode **instance 를 버린다** — 설정을 다시 읽히는 유일한 길이다.
 *
 * 서버 프로세스는 사용자가 띄운 것이라 우리가 못 끈다. 대신 instance 만 버리면 다음 요청에서
 * 새로 만들어지면서 설정을 다시 읽는다. 실측: 캐시된 값이 `alpha` 뿐인 상태에서 파일에
 * `beta` 를 더해도 안 보이다가, dispose 뒤에 `alpha, beta` 가 됐다.
 *
 * ⚠️ **런타임으로 등록한 MCP 도 함께 죽는다** (instance 수명 — `register.ts` 머리말).
 * 그래서 부르는 쪽이 이어서 재연결해 다시 등록해야 한다.
 */
export async function disposeInstance(
  projectRoot: string,
  opencodeUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const base = opencodeUrl.trim().replace(/\/+$/, '')
  if (base === '' || projectRoot.trim() === '') {
    return { ok: false, error: '열린 프로젝트나 서버 주소가 없습니다' }
  }
  try {
    const url = `${base}/instance/dispose?directory=${encodeURIComponent(projectRoot)}`
    const response = await fetch(url, { method: 'POST' })
    if (!response.ok) return { ok: false, error: `다시 읽기 실패 (HTTP ${response.status})` }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}
