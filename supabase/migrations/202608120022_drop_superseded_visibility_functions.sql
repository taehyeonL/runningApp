-- 노출 판정 함수의 남은 복사본을 제거한다.
--
-- 202608120003이 is_pair_visible / can_send_message / is_request_eligible를
-- private 스키마로 옮기면서 정책·뷰·함수는 모두 private 쪽을 보도록 바꿨지만,
-- public 쪽 원본은 지우지 않고 남겨 두었다. 그 뒤로 두 벌이 나란히 존재했다.
--
-- 실제로 남은 세 함수는 서로만 참조하는 닫힌 덩어리다.
--   public.is_request_eligible -> public.is_pair_visible -> (없음)
--   public.can_send_message    -> (없음)
-- 살아있는 정책 2개, 뷰 1개, 함수 4개는 전부 private 쪽을 쓴다.
--
-- 단순한 정리가 아니다. 이 저장소에서 반복해서 나온 사고가 전부 "같은 판정이
-- 여러 벌 있고 한쪽만 고쳐졌다"였다(제재 안내 뷰 2개, 차단 판정 2벌, 동의 질의
-- 4벌). 남겨 두면 public 스키마 쪽이 더 눈에 띄어 새 정책이 실수로 낡은 사본에
-- 연결되기 쉽고, 그때는 조용히 어긋난다. 실제로 202608120021에서 동의 정렬을
-- 고칠 때 이미 죽어 있던 public.is_pair_visible까지 함께 고쳐야 했다.
begin;

-- 참조하는 쪽부터 지운다.
drop function if exists public.is_request_eligible(uuid);
drop function if exists public.is_pair_visible(uuid);
drop function if exists public.can_send_message(uuid);

commit;
