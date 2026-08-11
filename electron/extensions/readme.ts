import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveInside } from '../fs/resolveInside'
import { isSafeExtensionName } from '../../shared/extensions/manifest'

// 확장 폴더의 README.md 를 읽는다. 설정 창의 「상세」가 이걸 그린다.
//
// **화면이 준 이름을 그대로 믿지 않는다.** renderer 는 신뢰 경계 밖이라 `../../` 같은 것이
// 올 수 있다. 다만 막는 자리가 둘로 갈린다:
//
//  1. **이름** — `isSafeExtensionName` 으로 본다 (매니페스트가 쓰는 규칙 그대로).
//     여기서 확장 폴더를 `realpath` 로 가두면 안 된다. **심링크로 걸어둔 개발용 확장**이
//     통째로 막힌다 — `registry.ts` 가 일부러 따라가게 만든 워크플로다.
//  2. **README 경로** — `resolveInside` 로 자기 확장 폴더 안인지 본다
//     (`extensionLoader` 가 main.js 를 열 때와 같은 자리).
//
// **없는 것이 정상이다.** 지금 깔린 확장 대부분에 README 가 없다 — 없음을 실패로 만들면
// 화면이 오류를 띄우게 되고, 아무 잘못도 없는 확장이 고장난 것처럼 보인다.

/** README 를 못 읽은 사유. `missing` 은 오류가 아니라 상태다. */
export type ReadmeFailure =
  /** 확장 폴더 밖을 가리킨다 (이름에 경로가 섞였다) */
  | 'outside'
  /** 그런 확장이 없거나 README.md 가 없다 */
  | 'missing'
  /** 파일이 아니다 (디렉토리를 README.md 로 만들어 둔 경우) */
  | 'not_file'
  /** 너무 크다 — 설정 창에 통째로 올릴 것이 아니다 */
  | 'too_large'
  /** 읽다 실패했다 (권한·손상) */
  | 'unreadable'

export type ReadmeResult = { ok: true; text: string } | { ok: false; reason: ReadmeFailure }

/**
 * 설정 창에 실을 수 있는 크기 상한.
 *
 * 확장이 만든 파일이라 크기를 우리가 정하지 않는다 — 상한이 없으면 수 MB 짜리 문서가
 * IPC 를 타고 화면까지 그대로 간다. 읽을 사람이 없는 크기다.
 *
 * 배포처에서 받아오는 설명(`registryReadmeFetch.ts`)도 이 값을 쓴다 — 같은 화면에 같은
 * 모양으로 그려지는 글이라 상한이 갈리면 그 차이를 설명할 길이 없다.
 */
export const README_MAX_BYTES = 256 * 1024

const README = 'README.md'

export async function readExtensionReadme(
  extensionsDir: string,
  name: string,
): Promise<ReadmeResult> {
  // 이름이 경로 조각이면 여기서 끝. 폴더 존재 여부는 아직 보지 않는다 —
  // 없는 확장을 `outside` 로 답하면 "경로가 이상하다" 는 엉뚱한 진단이 나간다.
  if (!isSafeExtensionName(name)) return { ok: false, reason: 'outside' }

  const path = await resolveInside(join(extensionsDir, name), README)
  if (path === null) return { ok: false, reason: 'missing' }

  let info
  try {
    info = await stat(path)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  if (!info.isFile()) return { ok: false, reason: 'not_file' }
  if (info.size > README_MAX_BYTES) return { ok: false, reason: 'too_large' }

  try {
    return { ok: true, text: await readFile(path, 'utf8') }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}
