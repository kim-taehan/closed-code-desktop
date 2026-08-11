import { spawn } from 'node:child_process'
import { open, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

// 아카이브 해제 · OS 격리 해제.
//
// npm 압축 라이브러리를 새로 들이지 않는다 (에어갭: 외부 의존성 최소화).
// ponytail: 시스템 tar(bsdtar/GNU)에 의존한다. 실제 배포 포맷은
//   linux·macos=.tar.gz(모든 tar 처리), windows=.zip(윈도우 tar.exe=bsdtar 처리).
//   linux 에서 .zip 을 파일설치하는 예외만 unzip 으로 폴백한다.

export type ArchiveFormat = 'tar.gz' | 'zip'

/** 매직바이트로 포맷을 판정한다. 0x1F8B=gzip, "PK"=zip. */
export async function detectArchiveFormat(filePath: string): Promise<ArchiveFormat> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(2)
    await handle.read(buffer, 0, 2, 0)
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'zip' // "PK"
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) return 'tar.gz' // gzip
    // 판정 실패 시 확장자로 되돌린다
    return filePath.endsWith('.zip') ? 'zip' : 'tar.gz'
  } finally {
    await handle.close()
  }
}

/**
 * 아카이브가 담고 있는 항목 이름을 읽는다. **풀기 전에** 안전한지 보려고 쓴다.
 *
 * 확장 설치가 이걸 요구한다 — zip 안에 `../../evil` 같은 경로가 있으면 푸는 순간
 * 설치 폴더 밖에 파일이 생기고(zip slip), 이미 풀린 뒤에는 그 파일이 설치 폴더 안에
 * 없으므로 사후 검사로는 못 잡는다. 런타임 설치는 우리가 만든 아카이브만 받아서
 * 이 검사를 안 했지만, 확장은 사용자가 아무 파일이나 고를 수 있다.
 */
export async function listArchiveEntries(archivePath: string): Promise<string[]> {
  // bsdtar(mac·win)는 zip 도 읽는다. 실패하면 linux 의 GNU tar 이므로 unzip 으로 간다.
  try {
    return splitLines(await capture('tar', ['-tf', archivePath]))
  } catch {
    return splitLines(await capture('unzip', ['-Z1', archivePath]))
  }
}

/** 아카이브를 dest 로 푼다. dest 는 미리 존재해야 한다. */
export async function extractArchive(archivePath: string, dest: string, format: ArchiveFormat): Promise<void> {
  // tar -xf 는 gzip 을 자동 인식하고, bsdtar 는 zip 도 읽는다
  try {
    await run('tar', ['-xf', archivePath, '-C', dest])
    return
  } catch (error) {
    // linux 의 GNU tar 는 zip 을 못 읽는다 — unzip 으로 한 번 더 시도
    if (format === 'zip') {
      await run('unzip', ['-o', archivePath, '-d', dest])
      return
    }
    throw error
  }
}

/**
 * 최상위에 폴더 하나만 있으면 그 안을 dest 로 끌어올린다.
 * (배포 아카이브가 `davis-runtime/…` 처럼 한 겹 감싸는 경우가 있다.)
 */
export async function normalizeExtractedStructure(dest: string): Promise<void> {
  const entries = await readdir(dest)
  if (entries.length !== 1) return
  const only = join(dest, entries[0]!)
  if (!(await isDirectory(only))) return

  for (const name of await readdir(only)) {
    await rename(join(only, name), join(dest, name))
  }
  await rm(only, { recursive: true, force: true })
}

/**
 * OS 격리/서명 제한을 푼다 — 안 하면 mac 에서 실행이 막힌다.
 * mac: 격리 속성 제거 + ad-hoc 서명. win: Unblock-File. linux: 없음.
 * 실패는 치명적이지 않다 (환경에 따라 도구가 없을 수 있다).
 */
export async function removeSecurityRestrictions(
  dir: string,
  exePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  try {
    if (platform === 'darwin') {
      await run('xattr', ['-cr', dir])
      await run('codesign', ['--force', '--deep', '--sign', '-', exePath])
    } else if (platform === 'win32') {
      await run('powershell', [
        '-NoProfile',
        '-Command',
        `Get-ChildItem -Path '${dir}' -Recurse | Unblock-File`,
      ])
    }
  } catch {
    // 격리 해제 실패는 경고로 그친다 — 서명된 환경이면 필요 없을 수도 있다
  }
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** `run` 과 달리 stdout 을 모은다 — 목록을 읽어야 하기 때문이다. */
function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${command} 실패 (exit ${code})`)),
    )
  })
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} 실패 (exit ${code})`)),
    )
  })
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
