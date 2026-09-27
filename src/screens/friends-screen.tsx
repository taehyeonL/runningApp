import { useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { fetchChatThreads, type ChatThread } from '../features/chat/chat-api';
import { errorMessage } from '../lib/errors';
import { Card, Kicker, Notice, PrimaryButton } from '../ui/components';
import { styles } from '../ui/styles';

type Friend = Pick<ChatThread, 'partnerId' | 'partnerNickname' | 'unreadCount'>;

export function FriendsScreen({ userId, adultVerified, onDiscover, onAccount, onChat, onGarden }: {
  userId?: string;
  adultVerified: boolean;
  onDiscover: () => void;
  onAccount: () => void;
  onChat: (id: string) => void;
  onGarden: (id: string) => void;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    let generation = 0;
    setFriends([]);
    if (!userId || !adultVerified) { setLoading(false); return; }
    const read = async () => {
      const ticket = ++generation;
      setFriends([]); setLoading(true); setError('');
      try {
        // This RPC includes friendships without messages and centralizes contact permissions.
        const rows = await fetchChatThreads();
        if (active && ticket === generation) setFriends(rows.map(({ partnerId, partnerNickname, unreadCount }) => ({ partnerId, partnerNickname, unreadCount })));
      } catch (reason) {
        if (active && ticket === generation) setError(errorMessage(reason, '친구 목록을 불러오지 못했어요.'));
      } finally {
        if (active && ticket === generation) setLoading(false);
      }
    };
    if (AppState.currentState === 'active') void read();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void read(); }, 15000);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void read();
      else { ++generation; setFriends([]); setLoading(true); }
    });
    return () => { active = false; ++generation; clearInterval(timer); listener.remove(); };
  }, [userId, adultVerified, refresh]);

  return <>
    <Kicker>함께 달리는 사이</Kicker>
    <Text style={styles.pageTitle}>러닝 친구</Text>
    <Text style={styles.pageSub}>서로 수락한 메이트와 대화를 이어가요.</Text>
    {!userId || !adultVerified ? <Card>
      <Text style={styles.listTitle}>성인 확인 후 친구를 만나요</Text>
      <Text style={styles.cardText}>친구 목록과 대화는 로그인 및 성인 확인 후 이용할 수 있어요.</Text>
      <PrimaryButton label="계정 확인하기" onPress={onAccount} />
    </Card> : <>
      {error ? <Notice text={error} /> : null}
      {loading ? <Text style={styles.caption}>친구 목록을 확인하고 있어요…</Text> : null}
      {!loading && !error && friends.length === 0 ? <Card>
        <Text style={styles.listTitle}>함께 달릴 첫 친구를 만나보세요</Text>
        <Text style={styles.cardText}>발견에서 같이 뛰기 요청을 서로 수락하면 친구 목록에 나타나요.</Text>
        <PrimaryButton label="러너 발견하기" onPress={onDiscover} />
      </Card> : null}
      {friends.map(friend => <Card key={friend.partnerId}>
        <View style={styles.threadRow}>
          <View style={styles.avatar}><Text>{friend.partnerNickname.slice(0, 1)}</Text></View>
          <View style={styles.threadCopy}>
            <Text style={styles.listTitle}>{friend.partnerNickname}</Text>
            <Text style={styles.caption}>{friend.unreadCount > 0 ? `새 메시지 ${friend.unreadCount}개` : '함께 달리는 친구'}</Text>
          </View>
        </View>
        <PrimaryButton label="대화하기" onPress={() => onChat(friend.partnerId)} />
        <Pressable accessibilityRole="button" style={styles.quietButton} onPress={() => onGarden(friend.partnerId)}><Text style={styles.caption}>공개된 정원 구경하기 ↗</Text></Pressable>
      </Card>)}
      <PrimaryButton label="친구 목록 새로고침" disabled={loading} onPress={() => setRefresh(value => value + 1)} />
    </>}
  </>;
}
