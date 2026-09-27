import { useEffect, useState } from 'react';
import { AppState, Text } from 'react-native';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { Card, Notice, PrimaryButton } from '../ui/components';
import { styles } from '../ui/styles';

type TestRunner = { id: string; nickname: string; connected: boolean };
type TestDirectory = { enabled: boolean; runners: TestRunner[] };

export function DevFriendsPanel({ onConnected, onOpenChat }: { onConnected: () => void; onOpenChat: () => void }) {
  const [directory, setDirectory] = useState<TestDirectory | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!__DEV__ || !supabase) return;
    let active = true; let generation = 0;
    const read = async () => {
      const ticket = ++generation;
      setDirectory(null);
      const { data, error } = await supabase!.rpc('list_dev_test_runners');
      if (active && ticket === generation) setDirectory(error ? null : data as TestDirectory);
    };
    void read();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void read(); }, 15000);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void read(); else { ++generation; setDirectory(null); }
    });
    return () => { active = false; clearInterval(timer); listener.remove(); };
  }, [refresh]);
  if (!__DEV__ || !directory?.enabled) return null;
  return <Card tone="yellow">
    <Text style={styles.listTitle}>개발 테스트 · 친구 바로 연결</Text>
    <Text style={styles.cardText}>운영자가 지정한 테스트 계정끼리만 사용해요. 러닝·반복 교차·요청 한도 없이 연결됩니다. 실제 성인 인증을 검증한 상태는 아니에요.</Text>
    {notice ? <Notice text={notice} /> : null}
    {directory.runners.length === 0 ? <Text style={styles.caption}>연결 가능한 테스트 계정이 없어요.</Text> : directory.runners.map(runner => <PrimaryButton
      key={runner.id} disabled={busy} label={runner.connected ? `${runner.nickname} · 친구 연결됨 · 대화 보기` : `${runner.nickname} 친구 추가`}
      onPress={() => {
        if (runner.connected) { onOpenChat(); return; }
        if (!supabase || busy) return;
        setBusy(true); setNotice('');
        void Promise.resolve(supabase.rpc('connect_dev_test_friend', { p_other: runner.id })).then(({ error }) => {
          if (error) throw error;
          setNotice('테스트 친구로 연결했어요.'); onConnected(); setRefresh(value => value + 1);
        }).catch(reason => setNotice(errorMessage(reason, '친구를 연결하지 못했어요.'))).finally(() => setBusy(false));
      }} />)}
  </Card>;
}
