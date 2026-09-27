import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { conversationOptions, discoveryGuidance, distanceOptions, socialRpc, type RunnerIntroduction, type RunningAppointment } from '../features/social/launch-experience';
import { errorMessage } from '../lib/errors';
import { Card, Notice, PrimaryButton } from '../ui/components';
import { styles } from '../ui/styles';

function Options<T extends string>({ options, value, onChange, disabled }: { options: Record<T, string>; value: T; onChange: (value: T) => void; disabled?: boolean }) {
  return <View style={styles.choiceGroup}>{(Object.keys(options) as T[]).map(key => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: key === value, disabled }} disabled={disabled} style={[styles.chip, key === value && styles.chipSelected]} onPress={() => onChange(key)}><Text style={[styles.chipText, key === value && styles.chipTextSelected]}>{options[key]}</Text></Pressable>)}</View>;
}

export function RunnerIntroductionSettings() {
  const [draft, setDraft] = useState<RunnerIntroduction | null>(null);
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    void socialRpc<RunnerIntroduction[]>('get_runner_introduction').then(rows => { if (active) { if (!rows[0]) throw new Error('프로필을 찾지 못했어요.'); setDraft(rows[0]); setMessage(''); } })
      .catch(reason => { if (active) setMessage(errorMessage(reason, '소개를 불러오지 못했어요. 서버 업데이트와 연결을 확인해 주세요.')); });
    return () => { active = false; };
  }, [retry]);
  const save = async () => {
    if (!draft || sending.current) return;
    sending.current = true; setBusy(true); setMessage('');
    try {
      const saved = await socialRpc<boolean>('set_runner_introduction', { p_bio: (draft.bio ?? '').trim(), p_conversation: draft.conversation_preference, p_distance: draft.preferred_distance });
      if (!saved) throw new Error('프로필을 찾지 못했어요.');
      setMessage('러닝 소개를 저장했어요. 나를 볼 수 있는 메이트에게만 보여요.');
    } catch (reason) { setMessage(errorMessage(reason)); }
    finally { sending.current = false; setBusy(false); }
  };
  return <Card><Text style={styles.listTitle}>함께 달릴 때의 나</Text><Text style={styles.caption}>선택 사항이에요. 집·직장·연락처·정확한 장소나 러닝 시각은 적지 마세요.</Text>
    {draft ? <><TextInput accessibilityLabel="러닝 소개" style={styles.detailsInput} multiline maxLength={300} editable={!busy} placeholder="예: 기록보다 꾸준함을 좋아해요. 천천히 함께 달려요." value={draft.bio ?? ''} onChangeText={bio => { setDraft({ ...draft, bio }); setMessage(''); }} /><Text style={styles.caption}>{draft.bio?.length ?? 0}/300</Text><Text style={styles.cardText}>대화 스타일</Text><Options options={conversationOptions} value={draft.conversation_preference} disabled={busy} onChange={conversation_preference => setDraft({ ...draft, conversation_preference })} /><Text style={styles.cardText}>편한 거리</Text><Options options={distanceOptions} value={draft.preferred_distance} disabled={busy} onChange={preferred_distance => setDraft({ ...draft, preferred_distance })} /><PrimaryButton label={busy ? '저장 중…' : '러닝 소개 저장'} disabled={busy} onPress={() => void save()} /></> : <PrimaryButton label="소개 다시 불러오기" onPress={() => setRetry(x => x + 1)} />}
    {message ? <Notice text={message} /> : null}</Card>;
}

export function DiscoveryEmptyState({ onSettings, onRun, onRefresh }: { onSettings: () => void; onRun: () => void; onRefresh: () => void }) {
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { let active = true; void socialRpc<string>('get_my_discovery_status').then(s => { if (active) setState(s); }).catch(reason => { if (active) setError(errorMessage(reason, '발견 상태를 확인하지 못했어요.')); }); return () => { active = false; }; }, []);
  const copy = discoveryGuidance[state];
  return <View style={styles.flatSection}><Text style={styles.runQuestion}>{copy?.title ?? (error ? '발견 상태를 확인하지 못했어요' : '발견 상태 확인 중…')}</Text><Text style={styles.cardText}>{copy?.body ?? '연결 상태와 서버 업데이트를 확인한 뒤 다시 시도해 주세요.'}</Text>{error ? <Notice text={error} /> : null}<PrimaryButton label={copy?.settings ? '내 설정 확인' : '나를 위한 러닝 계획'} onPress={copy?.settings ? onSettings : onRun} /><Pressable accessibilityRole="button" style={styles.quietButton} onPress={onRefresh}><Text style={styles.secondaryText}>새로고침</Text></Pressable></View>;
}

const periods = { this_week: '이번 주', next_week: '다음 주' } as const;
const bands = { morning: '아침', daytime: '낮', evening: '저녁' } as const;
const distances = { short: '가볍게 3km 안팎', '5k': '5km 정도', '10k': '10km 정도' } as const;
const statuses = { proposed: '상대 확인 대기', confirmed: '서로 확인함', declined: '거절됨', cancelled: '취소됨', completed: '완료로 표시됨' } as const;
export function RunningAppointmentPanel({ partnerId, userId }: { partnerId: string; userId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<RunningAppointment[]>([]);
  const [period, setPeriod] = useState<RunningAppointment['period']>('this_week');
  const [band, setBand] = useState<RunningAppointment['time_band']>('daytime');
  const [distance, setDistance] = useState<RunningAppointment['distance']>('5k');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const sending = useRef(false);
  useEffect(() => {
    if (!expanded) return;
    let active = true; setLoaded(false); setError('');
    void socialRpc<RunningAppointment[]>('list_running_appointments', { p_partner: partnerId }).then(data => { if (active) { setRows(data); setLoaded(true); } }).catch(reason => { if (active) setError(errorMessage(reason, '약속을 불러오지 못했어요.')); });
    return () => { active = false; };
  }, [partnerId, expanded, retry]);
  const act = async (id?: string, status?: string) => {
    if (sending.current || !loaded) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const result = id ? await socialRpc<boolean>('respond_running_appointment', { p_id: id, p_status: status }) : await socialRpc<string>('propose_running_appointment', { p_partner: partnerId, p_period: period, p_time_band: band, p_distance: distance });
      if (!result) throw new Error('상태가 바뀌었거나 지금은 약속을 변경할 수 없어요.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { sending.current = false; setBusy(false); setLoaded(false);
      // Re-fetch after success and failure: another participant may have acted first.
      try { setRows(await socialRpc<RunningAppointment[]>('list_running_appointments', { p_partner: partnerId })); setLoaded(true); } catch (reason) { setError(errorMessage(reason)); }
    }
  };
  const active = rows.some(row => row.status === 'proposed' || row.status === 'confirmed');
  return <Card><Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}><Text style={styles.listTitle}>같이 뛸 계획 {expanded ? '접기 −' : '정하기 +'}</Text></Pressable>{expanded ? <>
    <Text style={styles.caption}>넓은 시간대와 거리만 제안해요. 상대가 확인해야 확정돼요. 14일 후 정리되며, 실제 러닝 인증·보상·안전 체크와는 별개예요.</Text>
    {error ? <Notice text={error} /> : null}
    {!loaded ? <PrimaryButton label="약속 상태 다시 확인" onPress={() => setRetry(x => x + 1)} /> : null}
    {loaded ? rows.map(row => <View key={row.id} style={styles.section}><Text style={styles.cardText}>{row.week_start} 시작 주 · {bands[row.time_band]} · {distances[row.distance]}</Text><Text style={styles.caption}>{statuses[row.status]}</Text>{row.status === 'proposed' && row.proposer_id !== userId ? <><PrimaryButton label="이 계획 좋아요" disabled={busy} onPress={() => void act(row.id, 'confirmed')} /><PrimaryButton label="이번에는 어려워요" disabled={busy} onPress={() => void act(row.id, 'declined')} /></> : null}{row.status === 'proposed' || row.status === 'confirmed' ? <PrimaryButton label="계획 취소하기" disabled={busy} onPress={() => void act(row.id, 'cancelled')} /> : null}{row.status === 'confirmed' ? <PrimaryButton label="완료로 표시" disabled={busy} onPress={() => void act(row.id, 'completed')} /> : null}</View>) : null}
    {loaded && !active ? <><Options options={periods} value={period} disabled={busy} onChange={setPeriod} /><Options options={bands} value={band} disabled={busy} onChange={setBand} /><Options options={distances} value={distance} disabled={busy} onChange={setDistance} /><PrimaryButton label={busy ? '처리 중…' : '이 계획으로 제안하기'} disabled={busy} onPress={() => void act()} /></> : null}
  </> : null}</Card>;
}
