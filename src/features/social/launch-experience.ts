import { supabase } from '../../lib/supabase';

export async function socialRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('로그인이 필요해요.');
  const { data, error } = await supabase.rpc(name, args);
  if (error?.code === 'PGRST202' || error?.code === '42883') throw new Error('이 기능은 서버 업데이트 후 사용할 수 있어요. 기존 러닝 기록은 계속 이용할 수 있어요.');
  if (error) throw error;
  return data as T;
}
export const conversationOptions = { any: '상관없어요', chatty: '이야기하며 달려요', quiet: '러닝에 집중해요' };
export const distanceOptions = { any: '유연하게 맞춰요', short: '가볍게 3km 안팎', '5k': '5km 정도', '10k': '10km 정도' };
export type RunnerIntroduction = { bio: string | null; conversation_preference: keyof typeof conversationOptions; preferred_distance: keyof typeof distanceOptions };
export type RunningAppointment = { id: string; proposer_id: string; period: 'this_week' | 'next_week'; time_band: 'morning' | 'daytime' | 'evening'; distance: 'short' | '5k' | '10k'; week_start: string; status: 'proposed' | 'confirmed' | 'declined' | 'cancelled' | 'completed' };
export const discoveryGuidance: Record<string, { title: string; body: string; settings?: boolean }> = {
  verification_required: { title: '성인 인증이 필요해요', body: '실제 인증 연동을 준비하고 있어요. 그동안 개인 러닝 기록과 목표를 이용할 수 있어요.', settings: true },
  profile_required: { title: '가입 설정을 확인해 주세요', body: '프로필과 필수 동의를 완료해야 발견에 참여할 수 있어요.', settings: true },
  consent_required: { title: '필수 동의를 확인해 주세요', body: '필수 동의가 꺼져 있어요. 계정과 데이터에서 현재 상태를 확인해 주세요.', settings: true },
  hidden: { title: '지금은 발견 참여가 꺼져 있어요', body: '매칭 노출과 프로필 공개 설정을 확인해 주세요. 원할 때 다시 참여하면 돼요.', settings: true },
  processing: { title: '완료한 러닝을 확인하고 있어요', body: '서버 처리 후 다시 확인해 주세요. 같은 기록을 반복 전송할 필요는 없어요.' },
  first_run: { title: '첫 러닝부터 시작해 볼까요?', body: '완료한 러닝으로 나와 리듬이 맞는 메이트를 찾아요. 당장 상대가 없어도 기록과 업적은 남아요.' },
  searching: { title: '아직 리듬이 맞는 메이트가 없어요', body: '러닝 품질·반복 교차·서로의 조건이 맞아야 나타나요. 이용자가 적은 지역에서는 시간이 걸릴 수 있고, 러닝마다 발견되는 것은 아니에요.' },
  ready: { title: '발견 결과가 갱신됐어요', body: '새로고침해서 현재 후보를 확인해 주세요.' },
};
