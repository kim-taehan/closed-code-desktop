import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 배포처에서 확장 패키지 바이트를 받아 임시 파일로 떨군다. 표준 §4.4 "내려받기".
//
// **여기는 받기만 한다.** 받은 것을 푸는 것은 `install.ts` 가 디스크 설치와 **똑같은
// 경로로** 한다 — zip slip 검사도 매니페스트 검증도 다시 탄다. 배포처가 사내라도 그
// 안의 패키지는 누가 올렸는지 모르기 때문이다 (표준: "배포처를 믿고 검사를 건너뛰지 않는다").
//
// **임시 파일을 확장 설치 폴더 안에 두지 않는다.** `scanExtensions` 는 그 폴더 한 겹을
// 훑어 디렉토리마다 확장으로 치므로, 받는 동안 목록에 `no_manifest` 유령 행이 뜬다.
// `install.ts` 가 staging 을 설치 폴더 옆에 두는 것은 마지막 `rename` 의 EXDEV 때문인데,
// 이쪽은 **읽히기만 하는 파일**이라 볼륨이 달라도 상관없다.
//
// 사유를 가르는 이유는 `registryFetch.ts` 와 같다 — 주소 오타·망 미접속·서버 다운은
// 고치는 방법이 전혀 다르다.

export type PackageDownloadFailure =
  | 'bad_url'
  | 'unreachable'
  | 'timeout'
  | 'http_error'
  /** 받은 것을 디스크에 못 썼다 (용량·권한) */
  | 'write_failed'

export type PackageDownloadResult =
  | {
      ok: true
      /** 받은 패키지 파일 */
      path: string
      /** 부르는 쪽이 다 쓰고 `discardDownload` 로 치워야 하는 임시 폴더 */
      dir: string
      bytes: number
    }
  | { ok: false; reason: PackageDownloadFailure; detail?: string }

export interface PackageDownloadOptions {
  url: string
  /**
   * 응답이 없을 때 포기하는 시간. 목록 조회(10초)보다 넉넉하다 — 패키지는 목록 문서보다
   * 크고, 사내망이 느린 것과 죽은 것은 다르다. 본문을 읽는 동안에도 이 시계가 돈다.
   */
  timeoutMs?: number
  /** 시험에서 갈아끼운다. 기본은 전역 fetch */
  fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 60_000

/**
 * 받은 파일의 이름은 **우리가 정한다.** 주소 마지막 조각을 쓰면 배포처가 파일명으로
 * 경로를 밀어 넣을 수 있다. 안이 무엇인지는 매직바이트로 판별하므로(`detectArchiveFormat`)
 * 이름은 아무 뜻이 없어도 된다.
 */
const PACKAGE_FILENAME = 'package.axcx'

export async function downloadPackage(
  options: PackageDownloadOptions,
): Promise<PackageDownloadResult> {
  const { url, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = options

  // 주소를 먼저 본다 — 네트워크를 건드리기 전에 걸러낼 수 있는 것이다.
  // 화면이 넘긴 주소라도 다시 본다: renderer 가 보낸 것은 신뢰 경계 밖이다.
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return { ok: false, reason: 'bad_url', detail: url }
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, reason: 'bad_url', detail: parsedUrl.protocol }
  }

  let response: Response
  let body: ArrayBuffer
  try {
    response = await fetchImpl(parsedUrl.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    if (!response.ok) {
      return { ok: false, reason: 'http_error', detail: `HTTP ${response.status}` }
    }
    // 본문 읽기도 같은 try 안이다 — 다 받기 전에 끊기는 것이 실제로 흔하다
    body = await response.arrayBuffer()
  } catch (error) {
    return isTimeout(error)
      ? { ok: false, reason: 'timeout', detail: `${timeoutMs}ms` }
      : { ok: false, reason: 'unreachable', detail: describe(error) }
  }

  let dir: string
  let path: string
  try {
    dir = await mkdtemp(join(tmpdir(), 'davis-ext-'))
    path = join(dir, PACKAGE_FILENAME)
    await writeFile(path, Buffer.from(body))
  } catch (error) {
    return { ok: false, reason: 'write_failed', detail: describe(error) }
  }

  return { ok: true, path, dir, bytes: body.byteLength }
}

/**
 * 임시 폴더를 치운다. **실패해도 던지지 않는다** — 못 치운 임시 파일 때문에 설치가
 * 실패로 뒤집히면, 사용자에게는 되지도 않은 실패가 보인다. 설치는 이미 끝나 있다.
 */
export async function discardDownload(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

function isTimeout(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    ((error as { name?: unknown }).name === 'TimeoutError' ||
      (error as { name?: unknown }).name === 'AbortError')
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
