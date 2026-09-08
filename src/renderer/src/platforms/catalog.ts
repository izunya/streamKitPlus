import type { PlatformId, PlatformMeta, PlatformCategory } from '@shared/types'

/**
 * ⚠️ 여기 적힌 제한값(제목 길이, 태그 개수 등)은 "잠정값"입니다.
 * 실제 API 연동 단계에서 각 플랫폼 공식 문서로 반드시 재확인하고 고쳐야 합니다.
 * capabilities 만 고치면 UI 전체가 자동으로 따라옵니다 — 컴포넌트는 건드리지 않습니다.
 */
export const PLATFORMS: Record<PlatformId, PlatformMeta> = {
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    color: '#FF0033',
    authMethods: ['oauth'],
    capabilities: {
      title: { supported: true, maxLength: 100 },
      category: {
        supported: true,
        searchable: false,
        // 대분류 '게임'을 고르면 그 아래에 게임 제목을 따로 지정합니다.
        gameTitle: { underCategoryId: 'yt-20', maxLength: 100 },
        note: '대분류 15종 고정 + 게임 선택 시 게임 제목 별도 지정'
      },
      tags: {
        supported: true,
        maxTotalLength: 500,
        note: '개수 제한 대신 전체 합산 글자수로 제한됩니다.'
      }
    }
  },

  // 공식 문서 확인 완료: https://dev.twitch.tv/docs/api/reference/#modify-channel-information
  //   PATCH https://api.twitch.tv/helix/channels?broadcaster_id=..  scope: channel:manage:broadcast
  //   { title(<=140, 빈 문자열 불가), game_id, tags(<=10, 각 <=25, 공백/특수문자 불가) }
  twitch: {
    id: 'twitch',
    name: 'Twitch',
    color: '#9146FF',
    authMethods: ['oauth'],
    capabilities: {
      title: { supported: true, maxLength: 140 },
      category: { supported: true, searchable: true, note: 'IGDB 기반 게임 카탈로그' },
      tags: { supported: true, maxCount: 10, maxLength: 25, noSpaceOrSpecial: true }
    }
  },

  // 공식 문서 확인 완료: https://chzzk.gitbook.io/chzzk/chzzk-api/live
  //   PATCH /open/v1/lives/setting  (사용자 인증)
  //   { defaultLiveTitle?(빈 값 불가), categoryType?(GAME|SPORTS|ETC), categoryId?, tags?(공백/특수문자 불가) }
  //   GET   /open/v1/categories/search?query=&size=  -> data[] { categoryId, categoryType, categoryValue }
  chzzk: {
    id: 'chzzk',
    name: '치지직',
    color: '#00FFA3',
    authMethods: ['oauth', 'apiKey'],
    capabilities: {
      // 문서에 제목 최대 길이가 없습니다. 추측값으로 자르지 않고 그대로 보냅니다.
      title: { supported: true },
      category: { supported: true, searchable: true, requiresCategoryType: true },
      // 개수/길이 제한도 문서에 없습니다. 확인된 제약은 문자 종류뿐입니다.
      tags: { supported: true, noSpaceOrSpecial: true, note: '공백·특수문자 불가. 개수 제한은 문서에 없음' }
    }
  },

  soop: {
    id: 'soop',
    name: 'SOOP',
    color: '#00A8FF',
    authMethods: ['oauth', 'apiKey'],
    capabilities: {
      // 개발자 문서 페이지가 JS 렌더링이라 스펙을 확인하지 못했습니다.
      // 확인 전까지는 제한값을 지어내지 않고 비워둡니다.
      title: { supported: true },
      category: { supported: true, searchable: true, note: '스펙 미확인' },
      tags: { supported: true, note: '스펙 미확인' }
    },
    caution:
      '개발자 문서에서 스펙을 확인하지 못했습니다. 제목/카테고리/태그 수정 API 존재 여부부터 확인이 필요합니다.'
  },

  // 공식 문서 확인 완료: https://developers.ci.me/docs/api-lives
  //   PATCH /api/openapi/open/v1/lives/setting   scope: WRITE:LIVE_STREAM_SETTINGS
  //   { defaultLiveTitle?: string(1~100), tags?: string[](최대 6), categoryId?: string | null }
  //   GET   /api/openapi/open/v1/categories/search?keyword=&size=  (Client ID/Secret)
  cime: {
    id: 'cime',
    name: 'CIME',
    color: '#6C5CE7',
    // 공식 문서상 인증은 OAuth 2.0 뿐입니다.
    // apiKey 는 이미 발급받은 액세스 토큰을 직접 붙여넣는 용도로 남겨둡니다.
    authMethods: ['oauth', 'apiKey'],
    capabilities: {
      title: { supported: true, maxLength: 100 },
      category: {
        supported: true,
        searchable: true,
        requiresCategoryType: true,
        note: 'categories/search API 제공. 치지직과 동일한 응답 구조'
      },
      // 개당 길이 제한은 문서에 없어 지정하지 않습니다 (미지정 = 제한 없음).
      tags: { supported: true, maxCount: 6, note: '최대 6개. 개당 길이 제한은 문서에 없음' }
    },
    caution:
      'defaultLiveTitle 이 방송 중인 라이브에 즉시 반영되는지 문서에 없습니다. 실제 호출로 확인 필요.'
  }
}

/* ------------------------------------------------------------------ */
/* Mock 카테고리 카탈로그                                               */
/* 실제 연동 시에는 각 플랫폼 검색 API 응답으로 대체됩니다.               */
/* ------------------------------------------------------------------ */

export const MOCK_CATEGORIES: Record<PlatformId, PlatformCategory[]> = {
  // 유튜브 스튜디오 '카테고리' 드롭다운의 실제 15종 (가나다순).
  // 게임 개별 타이틀은 여기가 아니라 '게임 제목' 칸에 따로 들어갑니다.
  // ID는 YouTube videoCategoryId 기준이며, videoCategories.list 로 재확인이 필요합니다.
  youtube: [
    { id: 'yt-20', name: '게임', aliases: ['Gaming'] },
    { id: 'yt-28', name: '과학기술', aliases: ['Science & Technology', 'IT'] },
    { id: 'yt-27', name: '교육', aliases: ['Education'] },
    { id: 'yt-26', name: '노하우/스타일', aliases: ['Howto & Style'] },
    { id: 'yt-25', name: '뉴스/정치', aliases: ['News & Politics'] },
    { id: 'yt-29', name: '비영리/사회운동', aliases: ['Nonprofits & Activism'] },
    { id: 'yt-17', name: '스포츠', aliases: ['Sports'] },
    { id: 'yt-15', name: '애완동물/동물', aliases: ['Pets & Animals'] },
    { id: 'yt-24', name: '엔터테인먼트', aliases: ['Entertainment'] },
    { id: 'yt-19', name: '여행/이벤트', aliases: ['Travel & Events'] },
    { id: 'yt-1', name: '영화/애니메이션', aliases: ['Film & Animation'] },
    { id: 'yt-10', name: '음악', aliases: ['Music'] },
    { id: 'yt-22', name: '인물/블로그', aliases: ['People & Blogs', '일상', '토크'] },
    { id: 'yt-2', name: '자동차/교통', aliases: ['Autos & Vehicles'] },
    { id: 'yt-23', name: '코미디', aliases: ['Comedy'] }
  ],
  twitch: [
    { id: 'tw-516575', name: 'VALORANT', aliases: ['발로란트', '발로'], isGame: true },
    { id: 'tw-21779', name: 'League of Legends', aliases: ['리그 오브 레전드', '롤', 'LoL'], isGame: true },
    { id: 'tw-32982', name: 'Grand Theft Auto V', aliases: ['GTA5', 'GTA 5'], isGame: true },
    { id: 'tw-509658', name: 'Just Chatting', aliases: ['저스트 채팅', '토크', '수다'] },
    { id: 'tw-33214', name: 'Fortnite', aliases: ['포트나이트'], isGame: true },
    { id: 'tw-27471', name: 'Minecraft', aliases: ['마인크래프트', '마크'], isGame: true },
    { id: 'tw-518203', name: 'Sports', aliases: ['스포츠'] },
    { id: 'tw-26936', name: 'Music', aliases: ['음악'] }
  ],
  chzzk: [
    { id: 'cz-VALORANT', name: '발로란트', aliases: ['VALORANT', '발로'], isGame: true, categoryType: 'GAME' },
    { id: 'cz-LOL', name: '리그 오브 레전드', aliases: ['League of Legends', '롤'], isGame: true, categoryType: 'GAME' },
    { id: 'cz-GTA5', name: 'GTA 5', aliases: ['Grand Theft Auto V'], isGame: true, categoryType: 'GAME' },
    { id: 'cz-TALK', name: '토크', aliases: ['Just Chatting', '수다', '저스트 채팅'], categoryType: 'ETC' },
    { id: 'cz-FORTNITE', name: '포트나이트', aliases: ['Fortnite'], isGame: true, categoryType: 'GAME' },
    { id: 'cz-MINECRAFT', name: '마인크래프트', aliases: ['Minecraft', '마크'], isGame: true, categoryType: 'GAME' },
    { id: 'cz-SPORTS', name: '스포츠', aliases: ['Sports'], categoryType: 'SPORTS' }
  ],
  soop: [
    { id: 'sp-00040001', name: '발로란트', aliases: ['VALORANT'], isGame: true },
    { id: 'sp-00040002', name: '리그오브레전드', aliases: ['League of Legends', '롤', 'LoL'], isGame: true },
    { id: 'sp-00040003', name: 'GTA', aliases: ['Grand Theft Auto V', 'GTA5'], isGame: true },
    { id: 'sp-00050001', name: '토크/캠방', aliases: ['Just Chatting', '토크', '수다'] },
    { id: 'sp-00040004', name: '마인크래프트', aliases: ['Minecraft'], isGame: true },
    { id: 'sp-00060001', name: '스포츠', aliases: ['Sports'] }
  ],
  // categories/search 는 categoryId / categoryType / categoryValue 를 돌려줍니다.
  // categoryType 의 실제 값(GAME 등)은 문서에 예시가 없어, 연동 시 응답을 보고
  // isGame 판정 규칙을 확정해야 합니다. 아래는 그 형태를 가정한 Mock 입니다.
  cime: [
    { id: 'cm-valorant', name: '발로란트', aliases: ['VALORANT', '발로'], isGame: true, categoryType: 'GAME' },
    { id: 'cm-lol', name: '리그 오브 레전드', aliases: ['League of Legends', '롤'], isGame: true, categoryType: 'GAME' },
    { id: 'cm-minecraft', name: '마인크래프트', aliases: ['Minecraft', '마크'], isGame: true, categoryType: 'GAME' },
    { id: 'cm-talk', name: '토크', aliases: ['Just Chatting', '수다'], categoryType: 'ETC' },
    { id: 'cm-music', name: '음악', aliases: ['Music'], categoryType: 'ETC' },
    { id: 'cm-sports', name: '스포츠', aliases: ['Sports'], categoryType: 'SPORTS' },
    { id: 'cm-etc', name: '기타', aliases: ['Etc'], categoryType: 'ETC' }
  ]
}

/**
 * 별칭 사전 — 같은 카테고리인데 플랫폼마다 이름이 다른 경우를 이어줍니다.
 *
 * 검색 API 는 "이름에 이 문자열이 들어있나" 로만 찾기 때문에,
 * 한 표기로는 다른 플랫폼을 못 찾습니다. 실제로 이렇게 다릅니다:
 *
 *   토크 방송 →  치지직 "talk" / 트위치 "IRL" / CIME "저스트 채팅" / SOOP "토크/캠방"
 *
 * 한 줄에 묶어두면 어느 이름으로 검색해도 나머지를 찾아냅니다.
 * 여기 없는 카테고리는 사용자가 한 번 직접 고르면 매핑 캐시에 남습니다.
 */
export const ALIAS_DICTIONARY: Record<string, string[]> = {
  // 게임
  발로란트: ['VALORANT', '발로', 'valo'],
  '리그 오브 레전드': ['League of Legends', 'LoL', '롤', '리그오브레전드'],
  마인크래프트: ['Minecraft', '마크'],
  포트나이트: ['Fortnite'],
  '비트 세이버': ['Beat Saber', '비트세이버', 'beatsaber'],
  'GTA 5': ['Grand Theft Auto V', 'GTA5', 'GTA'],

  // 게임이 아닌 카테고리 — 플랫폼마다 이름이 가장 많이 갈리는 곳입니다
  // 트위치는 'Just Chatting' 입니다.
  // 'IRL' 은 트위치에 따로 존재하는 다른 카테고리라 일부러 넣지 않았습니다 —
  // 같이 묶으면 둘 다 정확 일치가 되어 어느 쪽이 뽑힐지 알 수 없게 됩니다.
  토크: ['talk', 'Talk', 'Just Chatting', '저스트 채팅', '토크/캠방', '수다', '잡담', '캠방'],
  스포츠: ['Sports', 'sports'],
  음악: ['Music', 'music', '뮤직'],
  '먹방': ['Food & Drink', '음식', 'ASMR 먹방']
}
