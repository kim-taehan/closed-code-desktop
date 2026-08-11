// 시험용 최소 zip 작성기 — **테스트에서만 쓴다.**
//
// 왜 만들었나: `zip` CLI 는 `../` 로 시작하는 이름을 스스로 지운다. 그래서 zip slip 을
// 재현하는 악성 패키지를 CLI 로는 만들 수 없다. 가짜 목록으로 시험하면 배선이 빠져도
// 초록이 되므로, **실제로 밖을 가리키는 압축 바이트**를 직접 쓴다.
//
// ponytail: 압축하지 않는 저장(stored) 방식만 지원한다. 시험 파일은 작고,
// deflate 를 넣으면 이 파일이 시험보다 커진다. 실제 패키지는 압축돼 있어도
// `tar`/`unzip` 이 풀므로 앱 코드는 영향이 없다.

export interface ZipEntry {
  /** 압축 안에 기록될 이름. `../evil.js` 처럼 밖을 가리키는 것도 그대로 쓴다 */
  name: string
  body: string
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.body, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // 로컬 헤더 서명
    local.writeUInt16LE(20, 4) // 필요 버전
    local.writeUInt16LE(0, 6) // 플래그
    local.writeUInt16LE(0, 8) // 방식 0 = 저장
    local.writeUInt32LE(0, 10) // 시각·날짜
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // 여분 필드 없음
    locals.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0) // 중앙 디렉토리 서명
    central.writeUInt16LE(20, 4) // 만든 버전
    central.writeUInt16LE(20, 6) // 필요 버전
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // 여분
    central.writeUInt16LE(0, 32) // 주석
    central.writeUInt16LE(0, 34) // 디스크
    central.writeUInt16LE(0, 36) // 내부 속성
    central.writeUInt32LE(0, 38) // 외부 속성
    central.writeUInt32LE(offset, 42) // 로컬 헤더 위치
    centrals.push(central, name)

    offset += local.length + name.length + data.length
  }

  const central = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // 끝 기록 서명
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // 주석 없음

  return Buffer.concat([...locals, central, end])
}

const CRC_TABLE = buildCrcTable()

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
