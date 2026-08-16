import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  manifestFingerprint,
  MANIFEST_FILES,
  MANIFEST_MAX_BYTES,
} from '../../shared/run/runManifest'

// 지금 디스크의 매니페스트로 잰 지문 (설계 §2 — 「다시 물어볼 때가 됐는가」).
//
// **읽는 곳이 한 군데다.** 적을 때(`mcp/saveRunCommands.ts`)와 「다시 확인할까요?」를
// 정할 때(`ipc/runListHandlers.ts`)가 같은 함수를 부른다 — 둘이 갈리면 지문이 영영 안 맞고,
// 사용자는 무엇을 해도 사라지지 않는 물음을 보게 된다.
//
// 목록이 앱 저장소로 옮겨 오기 전에는 이 셈이 **두 벌**이었다: 화면이 `readFile` IPC 로
// 매니페스트를 읽어 자기 지문을 냈다. 읽는 쪽이 main 하나로 모이면서 그 갈래가 없어졌다.

/**
 * 그 프로젝트의 지문. **없거나 못 읽는 파일은 조용히 빠진다** — 후보 목록은 여러 생태계를
 * 함께 담고 있어 한 프로젝트에서 대부분이 없는 것이 정상이다.
 */
export async function diskFingerprint(root: string): Promise<string> {
  const found: { path: string; text: string }[] = []
  for (const name of MANIFEST_FILES) {
    const text = await readCapped(join(root, name))
    if (text !== '') found.push({ path: name, text })
  }
  return manifestFingerprint(found)
}

/** 상한을 넘으면 뺀다 (`MANIFEST_MAX_BYTES`). */
async function readCapped(path: string): Promise<string> {
  try {
    if ((await stat(path)).size > MANIFEST_MAX_BYTES) return ''
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}
