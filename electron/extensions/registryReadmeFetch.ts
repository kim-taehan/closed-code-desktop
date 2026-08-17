import { networkFailure } from './fetchFailure'
import { README_MAX_BYTES } from './readme'

// 배포처가 내놓은 설명(README 마크다운)을 받아온다. 표준 §4.4 "받기 전에 보는 설명".
//
// **받기 전에 읽는 글이다.** 그래서 패키지를 통째로 받아 열지 않는다 — 안 받을 수도 있는
// 것을 미리 받는 셈이라 폐쇄망 회선에서 낭비다. 목록 문서가 준 주소만 따라간다.
//
// 주소는 **배포처가 준 것**이다. 파서(`registryIndex.ts`)가 http/https 로 이미 걸렀지만
// 여기서 한 번 더 본다 — 이 함수는 IPC 로도 불리고, 그 인자는 renderer 를 거쳐 온다.
//
// 크기 상한을 설치본 README(`readme.ts`)와 **같은 값**으로 둔다. 같은 화면에 같은 모양으로
// 그려지는 글인데 한쪽만 더 큰 것을 허용하면 사용자가 그 차이를 설명할 길이 없다.

export type RegistryReadmeFailure =
  | 'bad_url'
  | 'unreachable'
  | 'timeout'
  | 'http_error'
  /** 상한을 넘겼다. 설명 하나가 화면과 IPC 를 가득 채우게 두지 않는다 */
  | 'too_large'

export type RegistryReadmeResult =
  | { ok: true; text: string }
  | { ok: false; reason: RegistryReadmeFailure; detail?: string }

export interface RegistryReadmeOptions {
  url: string
  /** 목록 조회와 같은 10초. 글 한 편이라 패키지(60초)만큼 기다릴 이유가 없다 */
  timeoutMs?: number
  /** 시험에서 갈아끼운다. 기본은 전역 fetch */
  fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 10_000

export async function fetchRegistryReadme(
  options: RegistryReadmeOptions,
): Promise<RegistryReadmeResult> {
  const { url, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = options

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
  try {
    response = await fetchImpl(parsedUrl.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: { accept: 'text/markdown, text/plain' },
    })
  } catch (error) {
    return networkFailure(error, timeoutMs)
  }

  // 404 를 "설명 없음" 으로 바꾸지 않는다. 배포처가 readme 주소를 실어 놓고 404 를 주는 것은
  // 배포처가 틀린 것이고, 그것을 앱이 조용히 정상으로 만들면 틀린 채로 남는다.
  if (!response.ok) return { ok: false, reason: 'http_error', detail: `HTTP ${response.status}` }

  // 미리 밝힌 크기부터 본다 — 넘는다면 본문을 읽을 이유가 없다.
  // 안 밝히는 배포처(정적 파일 서버)도 있어서 읽은 뒤에 한 번 더 잰다.
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > README_MAX_BYTES) {
    return { ok: false, reason: 'too_large', detail: `${declared}B` }
  }

  let text: string
  try {
    text = await response.text()
  } catch (error) {
    return networkFailure(error, timeoutMs)
  }

  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > README_MAX_BYTES) return { ok: false, reason: 'too_large', detail: `${bytes}B` }

  return { ok: true, text }
}
