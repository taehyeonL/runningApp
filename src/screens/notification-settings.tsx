import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { Card, Notice, PrimaryButton } from '../ui/components';
import { styles } from '../ui/styles';
import { errorMessage } from '../lib/errors';

export function NotificationSettings({ status, busy, onEnable }: { status: string; busy: boolean; onEnable: () => void }) {
  const [error, setError] = useState('');
  return <Card>
    <Text style={styles.listTitle}>메시지 알림</Text>
    <Text style={styles.cardText}>상호 수락한 러너의 새 메시지만 안내해요. 잠금 화면에는 대화 내용이나 위치를 보내지 않아요.</Text>
    <Notice text={status || '알림을 켜면 앱을 닫아도 새 메시지를 알아볼 수 있어요.'} />
    <PrimaryButton label={busy ? '알림 설정 확인 중…' : '알림 켜기 / 다시 확인'} disabled={busy} onPress={onEnable} />
    <PrimaryButton label="기기 알림 설정 열기" onPress={() => { setError(''); void Linking.openSettings().catch(reason => setError(errorMessage(reason, '기기 설정에서 알림 권한을 확인해 주세요.'))); }} />
    {error ? <Notice text={error} /> : null}
  </Card>;
}
