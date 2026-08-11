import { access } from 'node:fs/promises'
import { join } from 'node:path'

// 저장소 판별.
//
// 루트에 `.git` 이 **존재하는지** 하나만 본다. 폴더인지 파일인지 따지지 않는다 —
// worktree 로 만든 작업 폴더에서는 `.git` 이 파일이고, 그것도 엄연한 저장소다.
//
// `git rev-parse` 를 부르지 않는 이유는 두 가지다. 프로세스를 띄우는 값이 아깝고,
// 상위 폴더가 저장소면 참이 되는데 우리는 **이 프로젝트 자신이** 저장소인지를 묻고 있다.
// 프로젝트 루트가 남의 저장소 안에 들어 있다고 그 저장소를 다루면 안 된다.

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    await access(join(root, '.git'))
    return true
  } catch {
    return false
  }
}
