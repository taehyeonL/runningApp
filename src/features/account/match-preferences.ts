import { supabase } from '../../lib/supabase';

export type MatchPreferences = {
  gender: 'male' | 'female' | 'unspecified';
  preference: 'male' | 'female' | 'any' | 'hidden';
};

export const genderOptions = [
  { key: 'male', label: '남자' },
  { key: 'female', label: '여자' },
  { key: 'unspecified', label: '설정하지 않음' },
] as const;
export const matchOptions = [
  { key: 'male', label: '남자만' },
  { key: 'female', label: '여자만' },
  { key: 'any', label: '상관없음' },
  { key: 'hidden', label: '노출되지 않았으면 함' },
] as const;

export async function getMatchPreferences(): Promise<MatchPreferences> {
  if (!supabase) throw new Error('로그인이 필요해요.');
  const { data, error } = await supabase.rpc('get_match_preferences').single();
  if (error?.code === 'PGRST202' || error?.code === '42883') throw new Error('매칭 설정은 서버 업데이트 후 사용할 수 있어요.');
  if (error) throw error;
  if (!data) throw new Error('매칭 설정을 불러오지 못했어요.');
  return data as MatchPreferences;
}

export async function saveMatchPreferences(input: MatchPreferences) {
  if (!supabase) throw new Error('로그인이 필요해요.');
  const { data, error } = await supabase.rpc('set_match_preferences', {
    p_gender: input.gender, p_preference: input.preference,
  });
  if (error) throw error;
  if (data !== true) throw new Error('프로필을 찾지 못해 매칭 설정을 저장하지 못했어요.');
}
