import type { PlatformId, PlatformCapabilities } from '@shared/types'
import { PLATFORMS } from '@/platforms/catalog'

/**
 * 태그 통합의 핵심 로직.
 *
 * 공통 태그를 그대로 밀어넣으면 플랫폼마다 개수/길이 제한에 걸립니다.
 * 여기서 플랫폼 제한에 맞게 "잘라서" 최종 목록을 만들고,
 * 무엇이 왜 잘렸는지도 함께 돌려줘 UI가 미리 경고할 수 있게 합니다.
 */

export interface TagAdjustment {
  /** 실제로 전송될 최종 태그 */
  accepted: string[]
  /** 제한 때문에 빠진 태그와 사유 */
  rejected: {
    tag: string
    reason: 'tooLong' | 'overCount' | 'overTotalLength' | 'duplicate' | 'badChars'
  }[]
  /** 플랫폼 자체가 태그 미지원 */
  unsupported: boolean
}

export function applyTagPolicy(
  platform: PlatformId,
  commonTags: string[],
  extraTags: string[] = []
): TagAdjustment {
  const caps: PlatformCapabilities['tags'] = PLATFORMS[platform].capabilities.tags

  if (!caps.supported) {
    return { accepted: [], rejected: [], unsupported: true }
  }

  const accepted: string[] = []
  const rejected: TagAdjustment['rejected'] = []
  const seen = new Set<string>()
  let totalLength = 0

  // 공통 태그를 먼저, 플랫폼 전용 태그를 뒤에 붙입니다.
  // 자리가 모자라면 뒤쪽(전용 태그)부터 잘리는 게 아니라 순서대로 채우고 넘치면 버립니다.
  for (const raw of [...commonTags, ...extraTags]) {
    const tag = raw.trim()
    if (!tag) continue

    const key = tag.toLowerCase()
    if (seen.has(key)) {
      rejected.push({ tag, reason: 'duplicate' })
      continue
    }

    if (caps.maxLength && tag.length > caps.maxLength) {
      rejected.push({ tag, reason: 'tooLong' })
      continue
    }

    // 트위치·치지직은 태그에 공백과 특수문자를 허용하지 않습니다.
    // 문자·숫자만 남기고 나머지는 거부합니다 (한글·일본어 등 유니코드 문자는 허용).
    if (caps.noSpaceOrSpecial && /[^\p{L}\p{N}]/u.test(tag)) {
      rejected.push({ tag, reason: 'badChars' })
      continue
    }

    if (caps.maxCount && accepted.length >= caps.maxCount) {
      rejected.push({ tag, reason: 'overCount' })
      continue
    }

    // 유튜브형: 태그 전체를 합친 길이로 제한
    if (caps.maxTotalLength) {
      const next = totalLength + tag.length + (accepted.length > 0 ? 1 : 0)
      if (next > caps.maxTotalLength) {
        rejected.push({ tag, reason: 'overTotalLength' })
        continue
      }
      totalLength = next
    }

    seen.add(key)
    accepted.push(tag)
  }

  return { accepted, rejected, unsupported: false }
}

export function rejectReasonLabel(reason: TagAdjustment['rejected'][number]['reason']): string {
  switch (reason) {
    case 'tooLong':
      return '너무 길어서'
    case 'overCount':
      return '개수를 넘어서'
    case 'overTotalLength':
      return '글자수를 넘어서'
    case 'duplicate':
      return '중복이라'
    case 'badChars':
      return '공백·특수문자를 쓸 수 없어서'
  }
}

/**
 * 제목을 플랫폼 최대 길이에 맞춰 자릅니다.
 *
 * maxLength 가 없는 플랫폼(문서에 제한이 명시되지 않은 곳)은 자르지 않습니다.
 * 추측한 숫자로 자르면 사용자가 쓴 제목이 조용히 사라지기 때문에,
 * 차라리 그대로 보내고 플랫폼이 거부하면 그 오류를 보여주는 편이 낫습니다.
 */
export function applyTitlePolicy(
  platform: PlatformId,
  title: string
): { value: string; trimmed: boolean } {
  const max = PLATFORMS[platform].capabilities.title.maxLength
  if (max === undefined || title.length <= max) return { value: title, trimmed: false }
  return { value: title.slice(0, max), trimmed: true }
}
