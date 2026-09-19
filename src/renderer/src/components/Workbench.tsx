import { TitleField } from './TitleField'
import { CategoryField } from './CategoryField'
import { TagField } from './TagField'

/**
 * 방송 정보 작업대.
 *
 * 제목·카테고리·태그를 각각 다른 카드에 두면 셋이 따로 노는 것처럼 보이고
 * 화면도 길어집니다. 한 판 위에 줄로 쌓아 "여기서 방송 정보를 만든다" 는
 * 덩어리 하나로 읽히게 했습니다.
 *
 * 각 줄의 세부 구현은 그대로 두고 껍데기만 걷어냈습니다 — 행 사이 구분선과
 * 여백은 .wb-row 가 담당합니다.
 *
 * shrink-0 이 없으면 세로 flex 안에서 이 판이 눌려 줄어들고, 맨 아래 태그 줄이
 * 잘려 손이 닿지 않습니다. 내용만큼 자라고, 넘치는 건 바깥이 스크롤하게 둡니다.
 */
export function Workbench(): React.JSX.Element {
  return (
    <section className="panel shrink-0 rounded-2xl">
      <TitleField />
      <CategoryField />
      <TagField />
    </section>
  )
}
