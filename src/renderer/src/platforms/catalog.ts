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
        gameTitle: {
          underCategoryId: 'yt-20',
          maxLength: 100,
          manualNote:
            '게임 제목은 유튜브 API로 넣을 수 없습니다. 적어두면 다른 플랫폼에 쓰이고, 유튜브는 스튜디오에서 직접 골라주세요.'
        },
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

  // 공식 문서 확인 완료: https://developers.sooplive.co.kr/docs/api/broad-stream
  //   POST broad/info/update      access_token/title(<=75)/category/hashtags(<=5, 특수문자 불가)
  //   POST validate/live/status   access_token -> 방송 중일 때만 제목·카테고리
  //   GET  broad/category/list    ?client_id=&locale= -> 트리(부모 + child)
  soop: {
    id: 'soop',
    name: 'SOOP',
    color: '#00A8FF',
    authMethods: ['oauth', 'apiKey'],
    capabilities: {
      title: { supported: true, maxLength: 75 },
      // 검색 엔드포인트가 없어 전체 목록을 받아 앱에서 거릅니다.
      category: { supported: true, searchable: true },
      tags: {
        supported: true,
        maxCount: 5,
        noSpaceOrSpecial: true,
        note: '해시태그로 들어갑니다. 특수문자 불가'
      }
    },
    caution:
      '방송 중이 아니면 현재 제목·카테고리를 읽어올 수 없습니다. 변경은 방송 전에도 됩니다.'
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
      // defaultLiveTitle 은 방송 중인 라이브에도 바로 반영됩니다 (실제 호출로 확인).
      // 이름이 default 로 시작해 "다음 방송의 기본값" 처럼 읽히지만 그렇지 않습니다.
      title: { supported: true, maxLength: 100 },
      category: {
        supported: true,
        searchable: true,
        // 응답에 categoryType 이 있지만 값이 categoryId 와 같아 분류로 쓸 수 없습니다.
        // 수정 요청 바디에도 이 필드가 없습니다.
        note: 'categories/search API 제공. 카테고리 분류 체계는 없음'
      },
      // 개당 길이 제한은 문서에 없어 지정하지 않습니다 (미지정 = 제한 없음).
      tags: { supported: true, maxCount: 6, note: '최대 6개. 개당 길이 제한은 문서에 없음' }
    }
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
  /* ── 게임 ──────────────────────────────────────────────────
   * 각 줄에 넣은 것: 플랫폼이 실제로 쓰는 표기 + 방송인이 쓰는 줄임말.
   * 플랫폼 표기는 치지직·CIME·SOOP 카테고리 API 를 직접 조회해 확인했고,
   * 트위치는 공개 디렉터리 페이지의 표기를 확인했습니다.
   *
   * 트위치는 한국어로 현지화해 보여줍니다(발로란트, Apex 레전드 …).
   * 다만 API 가 영어 정식 명칭을 주는 경우도 있어 양쪽을 함께 넣습니다.
   */
  '리그 오브 레전드': ['League of Legends', 'LoL', '롤', '리그오브레전드'],
  발로란트: ['VALORANT', 'Valorant', '발로', 'valo'],
  오버워치: ['Overwatch', 'Overwatch 2', '오버워치 2', '옵치'],
  'PUBG: 배틀그라운드': ['PUBG', 'PUBG: BATTLEGROUNDS', '배틀그라운드', '배그', '펍지'],
  마인크래프트: ['Minecraft', '마크', '마인'],
  로스트아크: ['Lost Ark', '로아'],
  메이플스토리: ['MapleStory', '메이플'],
  던전앤파이터: ['Dungeon Fighter Online', 'DNF', '던파'],
  스타크래프트: ['StarCraft', '스타크래프트: 리마스터', '브루드워', '스타1', '스타'],
  원신: ['Genshin Impact'],
  '이터널 리턴': ['Eternal Return', '이터널리턴'],
  '카트라이더: 드리프트': ['KartRider: Drift', '카트라이더', '카트'],
  서든어택: ['Sudden Attack', '서든'],
  팰월드: ['Palworld'],
  '엘든 링': ['Elden Ring', '엘든링', '엘링'],
  '헬다이버즈 2': ['HELLDIVERS 2', '헬다이버즈', '헬다'],
  '발더스 게이트 3': ["Baldur's Gate 3", '발더스 게이트', '발더스', 'BG3'],
  '사이버펑크 2077': ['Cyberpunk 2077', '사펑'],
  포트나이트: ['Fortnite', '포나'],
  '에이펙스 레전드': ['Apex Legends', 'Apex 레전드', '에이펙스', '에펙'],
  '톰 클랜시의 레인보우 식스 시즈': [
    "Tom Clancy's Rainbow Six Siege",
    // 세 플랫폼 모두 최신판을 "시즈 X" 로 올려두었습니다. 이게 없으면 못 찾습니다.
    '톰 클랜시의 레인보우 식스 시즈 X',
    '레인보우 식스 시즈 X',
    '레인보우 식스 시즈',
    '레인보우 식스',
    '레식',
    'R6'
  ],
  '카운터 스트라이크 2': ['Counter-Strike 2', 'CS2', '카스', '카운터 스트라이크'],
  '데드 바이 데이라이트': ['Dead by Daylight', 'DBD', '데바데'],
  하스스톤: ['Hearthstone', '하스'],
  '디아블로 IV': ['Diablo IV', '디아블로 4', '디아4', '디아'],
  '몬스터 헌터 와일즈': ['Monster Hunter Wilds', '몬스터헌터 와일즈', '몬헌 와일즈', '몬헌'],
  '비트 세이버': ['Beat Saber', '비트세이버', 'beatsaber'],
  VRChat: ['VRchat', 'vrchat', '브이알챗', '브챗'],
  // SOOP 만 음차해서 '그랜드 테프트 오토 V' 로 씁니다.
  'GTA 5': ['Grand Theft Auto V', '그랜드 테프트 오토 V', 'GTA5', 'GTA'],
  림월드: ['RimWorld'],
  '이스케이프 프롬 타르코프': ['Escape from Tarkov', '타르코프', 'EFT'],
  '패스 오브 엑자일': ['Path of Exile', '패스 오브 엑자일 2', 'PoE', '포이'],
  '스타듀 밸리': ['Stardew Valley', '스타듀밸리', '스듀'],
  '리썰 컴퍼니': ['Lethal Company', '리썰'],
  테라리아: ['Terraria'],
  마비노기: ['Mabinogi', '마비'],

  /* ── 게임이 아닌 카테고리 ───────────────────────────────────
   * 이름이 가장 많이 갈리는 곳이라 별칭의 값어치가 가장 큽니다.
   * 아래 플랫폼 표기는 전부 실제 조회로 확인한 것입니다.
   *
   * 'IRL' 은 트위치에 따로 존재하는 다른 카테고리라 일부러 넣지 않았습니다 —
   * 같이 묶으면 둘 다 정확 일치가 되어 어느 쪽이 뽑힐지 알 수 없게 됩니다.
   */
  토크: [
    'talk', // 치지직
    'Just Chatting', // 트위치
    '저스트 채팅', // CIME
    '토크/캠방', // SOOP
    '저챗',
    '수다',
    '잡담',
    '캠방',
    '소통'
  ],
  음악: ['음악/노래', 'Music', '노래', '뮤직', '노래방송'],
  먹방: ['먹방/쿡방', 'Food & Drink', '쿡방', '음식'],
  ASMR: ['asmr'],
  여행: ['Travel & Outdoors', '여행/아웃도어', '아웃도어'],
  스포츠: ['Sports', '스포츠일반'],
  그림: ['Art', '아트', '그림방송'],
  운동: ['운동/건강', 'Fitness & Health', '헬스', '건강'],
  // 'Virtual' 은 뺐습니다 — 치지직에 버추얼 카테고리가 없어서
  // '버추얼 파이터' 같은 게임만 끌어옵니다.
  버추얼: ['버츄얼', '버튜버', 'VTuber']
}
