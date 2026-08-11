import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// 충돌 파일의 충돌 지점 개수.
//
// **`git diff --check` 를 쓰지 않는다** (탐색 실측). 그쪽은 충돌 마커와 공백 오류를
// 같은 목록에 섞어 내서, 줄 끝 공백이 있는 파일이면 개수가 부풀려진다.
// 여기서는 파일을 읽어 git 이 남긴 마커 줄만 센다.
//
// 줄 수(`gitNumstat.ts`)와 파일을 가른 이유: 저쪽은 diff 를 묻고 이쪽은
// 파일 내용을 훑는다 — 출처가 다르다.

/**
 * 충돌 시작 마커. git 은 `<<<<<<< ` 일곱 글자 다음에 공백과 라벨(브랜치·`HEAD`)을 붙인다.
 * 공백까지 봐야 `<<<<<<<<` 같은 본문 줄을 마커로 오인하지 않는다.
 */
const MARKER = '<<<<<<< '

export async function countConflicts(root: string, path: string): Promise<number> {
  let text: string
  try {
    text = await readFile(join(root, path), 'utf8')
  } catch {
    // 지워졌거나 읽을 수 없다. 개수를 모르는 것과 0 은 다르지만,
    // 화면은 배지를 안 그리는 쪽으로 둘을 같게 다룬다.
    return 0
  }

  let count = 0
  for (const line of text.split('\n')) {
    if (line.startsWith(MARKER)) count += 1
  }
  return count
}
