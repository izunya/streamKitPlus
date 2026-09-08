import type { PlatformCategory } from '@shared/types'
import { ALIAS_DICTIONARY } from '@/platforms/catalog'

/**
 * 카테고리 통합의 핵심 로직.
 *
 * 문제: 같은 "발로란트"가 플랫폼마다 VALORANT / 발로란트 / 발로란트(코드 00040001)로 제각각입니다.
 * 해결: 내부 표준(canonical) 이름 하나를 기준으로, 각 플랫폼 카탈로그에서 후보를 찾아
 *      신뢰도와 함께 돌려줍니다. 사용자가 한 번 확정한 매핑은 저장해서 다시 묻지 않습니다.
 */

/** 비교 전 문자열 정규화: 공백/특수문자 제거, 소문자화, 전각→반각 */
export function normalize(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_/:()[\]{}.,'"!?~·]/g, '')
    .trim()
}

/** 두 문자열의 편집 거리 (Levenshtein) */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

/** 0~1 유사도. 1이면 완전 일치 */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  const max = Math.max(a.length, b.length)
  return 1 - editDistance(a, b) / max
}

/** 별칭 사전을 펼쳐서 "이 단어와 같은 뜻인 모든 표기"를 모읍니다. */
export function expandAliases(term: string): string[] {
  const n = normalize(term)
  const out = new Set<string>([term])

  for (const [canonical, aliases] of Object.entries(ALIAS_DICTIONARY)) {
    const group = [canonical, ...aliases]
    if (group.some((g) => normalize(g) === n)) {
      group.forEach((g) => out.add(g))
    }
  }

  /*
   * 띄어쓰기만 다른 표기도 시도합니다.
   *
   * 플랫폼 검색은 대개 문자열 포함 여부로만 찾아서, 한 칸 차이로 결과가 갈립니다.
   * 치지직에서 "비트 세이버" 는 찾히지만 "Beat Saber" 는 0건인 식입니다.
   * 사전에 없는 게임이라도 이 변형만으로 상당수가 걸립니다.
   */
  const spaced = term.trim().replace(/\s+/g, ' ')
  const tight = spaced.replace(/\s/g, '')
  if (tight && tight !== spaced) out.add(tight)

  return [...out]
}

export type MatchConfidence = 'exact' | 'high' | 'low' | 'none'

export interface CategoryMatch {
  category: PlatformCategory
  score: number
  confidence: MatchConfidence
  /**
   * 카테고리 자기 이름으로 맞은 것인지 (별칭을 거치지 않고).
   *
   * 동점일 때 순서를 가르는 데 씁니다. 예를 들어 "토크" 로 검색하면
   * 별칭을 통해 여러 항목이 1.0 점을 받을 수 있는데,
   * 이름 자체가 일치하는 쪽이 사용자가 기대하는 답에 가깝습니다.
   */
  byName: boolean
}

/**
 * 한 플랫폼의 카테고리 목록에서 query에 가장 가까운 후보들을 찾습니다.
 *
 * - exact : 이름 또는 별칭이 정확히 일치 → 자동 선택
 * - high  : 유사도 0.8 이상 → 자동 선택하되 UI에 "자동 매칭됨" 표시
 * - low   : 유사도 0.55 이상 → 사용자에게 후보로 제시
 * - none  : 매칭 실패 → 해당 플랫폼만 카테고리 미변경
 */
export function matchCategory(
  query: string,
  catalog: PlatformCategory[],
  limit = 3
): CategoryMatch[] {
  if (!query.trim()) return []

  const terms = expandAliases(query).map(normalize)
  const scored: CategoryMatch[] = []

  for (const category of catalog) {
    const nameKey = normalize(category.name)
    const targets = [category.name, ...(category.aliases ?? [])].map(normalize)

    let best = 0
    let isExact = false
    let byName = false

    for (const t of terms) {
      for (const target of targets) {
        if (t === target) {
          isExact = true
          best = 1
          if (target === nameKey) byName = true
          break
        }
        // 한쪽이 다른 쪽을 포함하면 부분 일치로 가산.
        // 다만 길이 차이가 크면 신뢰할 수 없습니다 —
        // "게임"은 "존재하지않는게임123"에 포함되지만 같은 카테고리가 아닙니다.
        // 길이 비율에 따라 0.55~0.85 사이로만 줍니다 (자동 확정선 0.8 아래에서 시작).
        if (target.includes(t) || t.includes(target)) {
          const ratio = Math.min(t.length, target.length) / Math.max(t.length, target.length)
          best = Math.max(best, 0.55 + 0.3 * ratio)
        }
        best = Math.max(best, similarity(t, target))
      }
      if (isExact) break
    }

    if (best <= 0) continue
    scored.push({
      category,
      score: best,
      byName,
      confidence: isExact ? 'exact' : best >= 0.8 ? 'high' : best >= 0.55 ? 'low' : 'none'
    })
  }

  return scored
    .filter((s) => s.confidence !== 'none')
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // 점수가 같으면 이름으로 직접 맞은 쪽을 먼저 둡니다.
      if (a.byName !== b.byName) return a.byName ? -1 : 1
      // 그래도 같으면 짧은 이름을 먼저 — 대개 더 일반적인 카테고리입니다.
      return a.category.name.length - b.category.name.length
    })
    .slice(0, limit)
}

/** 자동 확정해도 되는 매칭인지 */
export function isAutoConfirmable(match: CategoryMatch | undefined): boolean {
  return !!match && (match.confidence === 'exact' || match.confidence === 'high')
}
