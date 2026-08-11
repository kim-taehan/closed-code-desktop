import { lstat, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

// 설치된 확장을 지운다 — 폴더째.
//
// **이름이 아니라 폴더로 가리킨다.** 설치 폴더 이름이 매니페스트 이름과 늘 같지는 않다:
// 배포처·디스크 설치는 이름으로 폴더를 만들지만, 폴더째 복사·심링크로 깔린 것은
// 사용자가 지은 이름을 쓴다. 이름으로 지우면 그런 확장은 영영 못 지운다.
//
// **화면이 준 경로를 그대로 믿지 않는다.** renderer 는 신뢰 경계 밖이다. 다만 가두는 방법이
// `realpath` 여서는 안 된다 — 심링크로 걸어둔 개발용 확장이 통째로 막힌다
// (`readme.ts`·`registry.ts` 가 일부러 따라가게 만든 워크플로다). 그래서 **부모가 설치
// 폴더인지**만 본다. `..` 이 섞여 있어도 `resolve` 뒤에는 부모가 달라져 걸린다.
//
// 심링크로 깔린 확장을 지우면 **링크만 지워지고 원본은 남는다.** `rm` 이 링크를 따라가지
// 않기 때문인데, 이게 맞는 동작이다 — 개발 중인 원본 소스가 목록에서 뺀다고 사라지면 안 된다.

export type UninstallFailure =
  /** 설치 폴더 바로 아래가 아니다 (경로가 섞였거나 남의 폴더다) */
  | 'outside'
  /** 그런 폴더가 없다. 이미 지워졌을 수 있다 */
  | 'missing'
  /** 지우다 실패했다 (권한·사용 중) */
  | 'failed'

export type UninstallResult = { ok: true } | { ok: false; reason: UninstallFailure; detail?: string }

export async function uninstallExtension(extensionsDir: string, dir: string): Promise<UninstallResult> {
  const target = resolve(dir)
  if (dirname(target) !== resolve(extensionsDir)) return { ok: false, reason: 'outside' }

  // `lstat` 이다 — 끊어진 심링크도 목록에는 뜬다(`registry.ts` 의 broken_link).
  // `stat` 으로 보면 그런 것은 "없다" 가 되어 지울 방법이 사라진다.
  try {
    await lstat(target)
  } catch {
    return { ok: false, reason: 'missing' }
  }

  try {
    // `force` 는 쓰지 않는다 — 위에서 존재를 확인했으므로, 여기서 조용히 성공하면
    // 정말 지운 것인지 알 수 없다
    await rm(target, { recursive: true })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}
