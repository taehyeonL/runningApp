import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { genderOptions, getMatchPreferences, matchOptions, saveMatchPreferences, type MatchPreferences } from '../features/account/match-preferences';
import { errorMessage } from '../lib/errors';
import { Card, Notice, PrimaryButton, Section } from '../ui/components';
import { styles } from '../ui/styles';

export function MatchPreferenceFields({ value, onChange, disabled = false }: {
  value: MatchPreferences; onChange: (value: MatchPreferences) => void; disabled?: boolean;
}) {
  return <>
    <Section title="나의 성별">
      <View style={styles.choiceGroup}>
        {genderOptions.map((item) => <Pressable key={item.key} accessibilityRole="radio" accessibilityState={{ checked: value.gender === item.key, disabled }} disabled={disabled}
          style={[styles.chip, value.gender === item.key && styles.chipSelected]} onPress={() => onChange({ ...value, gender: item.key })}>
          <Text style={[styles.chipText, value.gender === item.key && styles.chipTextSelected]}>{item.label}</Text>
        </Pressable>)}
      </View>
      <Text style={styles.caption}>매칭 조건에만 사용하며 카드에는 표시하지 않아요. 설정하지 않으면 ‘상관없음’을 선택한 상대와만 연결 후보가 돼요.</Text>
    </Section>
    <Section title="어떤 러닝 메이트를 찾나요?">
      <View style={styles.choiceGroup}>
        {matchOptions.map((item) => <Pressable key={item.key} accessibilityRole="radio" accessibilityState={{ checked: value.preference === item.key, disabled }} disabled={disabled}
          style={[styles.chip, value.preference === item.key && styles.chipSelected]} onPress={() => onChange({ ...value, preference: item.key })}>
          <Text style={[styles.chipText, value.preference === item.key && styles.chipTextSelected]}>{item.label}</Text>
        </Pressable>)}
      </View>
      <Text style={styles.caption}>서로의 조건이 맞는 러너만 발견해요. 설정은 언제든 바꿀 수 있고, 변경 후 조건에 맞지 않는 대기 요청은 취소돼요.</Text>
      {value.preference === 'hidden' ? <Notice text="새 매칭 후보에서 서로 보이지 않으며 대기 요청은 취소돼요. 기존 친구·대화와 러닝 기록은 유지됩니다." /> : null}
    </Section>
  </>;
}

export function MatchPreferencesSettings() {
  const [saved, setSaved] = useState<MatchPreferences | null>(null);
  const [draft, setDraft] = useState<MatchPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    setError(null);
    void getMatchPreferences().then((value) => { if (active) { setSaved(value); setDraft(value); } })
      .catch((reason) => { if (active) setError(errorMessage(reason, '매칭 설정을 불러오지 못했어요. 서버 업데이트 여부와 연결을 확인해 주세요.')); });
    return () => { active = false; };
  }, [retry]);
  const save = async () => {
    if (!draft || sending.current) return;
    sending.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      await saveMatchPreferences(draft);
      const value = await getMatchPreferences();
      setSaved(value); setDraft(value);
      setNotice('매칭 설정을 저장했어요. 조건에 맞지 않는 대기 요청은 취소되며, 기존 친구·대화는 유지돼요.');
    } catch (reason) { setError(errorMessage(reason, '저장하지 못했어요. 다시 시도해 주세요.')); }
    finally { sending.current = false; setBusy(false); }
  };
  return <Card>
    <Text style={styles.listTitle}>러닝 메이트 설정</Text>
    <Text style={styles.caption}>발견 노출과 프로필 공개가 켜져 있어야 새 매칭에 참여해요. 여기서 조건을 바꿔도 기존 공개 설정은 자동으로 켜지지 않아요.</Text>
    {!draft && !error ? <Notice text="매칭 설정을 불러오고 있어요…" /> : null}
    {draft ? <MatchPreferenceFields value={draft} disabled={busy} onChange={(value) => { setDraft(value); setNotice(null); }} /> : null}
    {error ? <Notice text={error} /> : null}
    {notice ? <Notice text={notice} /> : null}
    {!draft && error ? <PrimaryButton label="매칭 설정 다시 불러오기" onPress={() => setRetry((value) => value + 1)} /> : null}
    {draft ? <PrimaryButton label={busy ? '저장 중…' : '매칭 설정 저장'} disabled={busy || (saved?.gender === draft.gender && saved?.preference === draft.preference)} onPress={() => void save()} /> : null}
  </Card>;
}
