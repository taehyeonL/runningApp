import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, Text, View } from 'react-native';
import { gardenRpc, type Garden, type Plot, type RunReward } from '../features/garden/garden-api';
import { errorMessage } from '../lib/errors';
import { Back, Card, ChoiceGroup, Notice, PrimaryButton } from '../ui/components';
import { styles } from '../ui/styles';
import { GardenInventory, type GardenSelection } from './garden-inventory';
import { growthIcon, growthStage, growthStageNames } from '../features/garden/garden-presentation';
import { SeedGardenPreview } from './seed-garden-preview';

export function LiveGardenScreen({ userId, ownerId, onBack, onVisit }: {
  userId: string; ownerId: string; onBack: () => void; onVisit: (id: string) => void;
}) {
  const own = userId === ownerId;
  const [garden, setGarden] = useState<Garden | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<GardenSelection>(null);
  const [removeMode, setRemoveMode] = useState(false);
  const [showSeedPreview, setShowSeedPreview] = useState(false);
  const mutation = useRef(false);
  const [page, setPage] = useState(0);
  const [friends, setFriends] = useState<{ id: string; nickname: string }[]>([]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true; let generation = 0;
    const read = async () => {
      const ticket = ++generation;
      // Do not leave an old authorized snapshot visible while reauthorization hangs.
      if (!own) { setGarden(null); setLoading(true); }
      try {
        const data = await gardenRpc<Garden | null>('get_garden', { p_owner: ownerId });
        if (active && ticket === generation) { setGarden(data); setNotice(''); setLoading(false); }
      } catch (e) {
        if (active && ticket === generation) { setGarden(null); setNotice(errorMessage(e, '정원을 불러오지 못했어요.')); setLoading(false); }
      }
    };
    void read();
    // Visitor data is never persisted. Hide on background and re-authorize on return.
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void read();
      else { ++generation; if (!own) { setGarden(null); setLoading(true); } }
    });
    const timer = !own ? setInterval(() => { if (AppState.currentState === 'active') void read(); }, 10000) : null;
    return () => { active = false; listener.remove(); if (timer) clearInterval(timer); };
  }, [ownerId, own, refresh]);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const read = () => {
      const ticket = ++generation;
      setFriends([]);
      if (own) void gardenRpc<{ id: string; nickname: string }[]>('garden_friends').then(data => { if (active && ticket === generation) setFriends(data); }).catch(() => { if (active && ticket === generation) setFriends([]); });
    };
    read();
    const timer = setInterval(() => { if (AppState.currentState === 'active') read(); }, 10000);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') read(); else { ++generation; setFriends([]); }
    });
    return () => { active = false; clearInterval(timer); listener.remove(); };
  }, [own, refresh]);
  const save = async (placements: Plot[], visibility = garden?.visibility) => {
    if (!garden || !own || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      await gardenRpc('save_garden', { p_revision: garden.revision, p_placements: placements.filter(p => p.stage === undefined), p_visibility: visibility });
      setRefresh(x => x + 1);
      setNotice('정원을 저장했어요.');
    } catch (e) { setNotice(errorMessage(e, '저장하지 못했어요. 다시 시도해 주세요.')); }
    finally { mutation.current = false; setBusy(false); }
  };
  const changePlant = async (name: 'plant_garden_seed' | 'move_garden_plant', args: Record<string, unknown>) => {
    if (!garden || !own || mutation.current) return;
    mutation.current = true; setBusy(true);
    try {
      await gardenRpc(name, { ...args, p_revision: garden.revision });
      setSelected(null); setRefresh(x => x + 1); setNotice('정원에 반영했어요. 성장한 만큼은 그대로 유지돼요.');
    } catch (e) { setNotice(errorMessage(e, '변경하지 못했어요. 다시 불러온 뒤 시도해 주세요.')); }
    finally { mutation.current = false; setBusy(false); }
  };
  const place = (cell: number) => {
    if (!garden || busy) return;
    const plant = garden.plants?.find(p => p.cell === cell);
    const occupied = garden.placements.some(p => p.cell === cell);
    if (selected?.kind === 'plant') {
      if (occupied) { setNotice('빈 칸을 선택해 주세요.'); return; }
      void changePlant('move_garden_plant', { p_plant: selected.id, p_cell: cell }); return;
    }
    const seed = selected?.kind === 'item' && garden.catalog.find(i => i.id === selected.id && i.kind === 'seed');
    if (seed) {
      if (occupied) { setNotice('씨앗은 빈 칸에 심어 주세요.'); return; }
      void changePlant('plant_garden_seed', { p_item: seed.id, p_cell: cell }); return;
    }
    if (plant) {
      if (selected) { setNotice('식물을 먼저 옮기거나 보관해 주세요.'); return; }
      const item = garden.catalog.find(i => i.id === plant.itemId);
      Alert.alert(item?.mature_name ?? '자라는 식물', `${plant.progress}% · ${growthStageNames[growthStage(plant.progress)]}\n${item?.description ?? ''}`, [
        { text: '닫기', style: 'cancel' },
        { text: '옮기기', onPress: () => { setSelected({ kind: 'plant', id: plant.id }); setNotice('옮길 빈 칸을 선택해 주세요.'); } },
        { text: '보관하기', onPress: () => { void changePlant('move_garden_plant', { p_plant: plant.id, p_cell: null }); } },
      ]); return;
    }
    if (!selected && !removeMode) { setNotice('보관함에서 아이템을 선택하거나 회수 모드를 켜주세요.'); return; }
    const rest = garden.placements.filter(p => p.cell !== cell);
    if (selected && rest.filter(p => p.itemId === selected.id).length >= (garden.inventory?.[selected.id] ?? 0)) {
      setNotice('모두 배치한 아이템이에요. 기존 칸에서 회수한 다음 옮겨주세요.'); return;
    }
    void save(selected ? [...rest, { cell, itemId: selected.id }] : rest);
  };
  if (own && showSeedPreview) return <><Back onPress={() => setShowSeedPreview(false)} /><SeedGardenPreview /></>;
  return <>
    <Back onPress={onBack} /><Text style={styles.pageTitle}>{own ? '나의 러닝 정원' : '러너의 정원'}</Text>
    {own && !garden?.plants ? <PrimaryButton label="씨앗 성장 미리보기 · 예시" onPress={() => setShowSeedPreview(true)} /> : null}
    {notice ? <Notice text={notice} /> : null}
    {loading ? <Notice text="정원을 불러오고 있어요…" /> : garden ? <>
      <Card tone="mint"><Text style={styles.sectionTitle}>{garden.nickname}의 작은 쉼터 🌿</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#BBCD9A', padding: 6, borderRadius: 18 }}>
          {Array.from({ length: Math.min(32, garden.cellCount - page * 32) }, (_, i) => {
            const cell = page * 32 + i;
            const plot = garden.placements.find(p => p.cell === cell);
            const item = garden.catalog.find(x => x.id === plot?.itemId);
            const plant = own ? garden.plants?.find(p => p.cell === cell) : undefined;
            const stage = plot?.stage;
            return <Pressable key={cell} disabled={!own || busy} onPress={() => place(cell)} accessibilityRole="button"
              accessibilityLabel={`${cell + 1}번째 칸, ${stage !== undefined ? item?.mature_name : item?.name ?? '빈 칸'}${plant ? `, 성장 ${plant.progress}%` : ''}`}
              style={{ width: '25%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#D4E2BC', borderWidth: 1, borderColor: '#BBCD9A', borderRadius: 8 }}>
              <Text style={{ fontSize: 30 }}>{stage !== undefined ? growthIcon(stage, item?.mature_icon ?? '🌿') : item?.icon ?? '·'}</Text>
              {plant ? <Text style={{ fontSize: 11, color: '#345B38' }}>{plant.progress}%</Text> : null}</Pressable>;
          })}
        </View>
        <Text style={styles.caption}>{garden.cellCount}칸 · {own ? selected ? '선택했어요. 놓을 칸을 눌러주세요.' : '식물을 누르면 성장 설명·이동·보관을 선택해요.' : '꾸민 모습만 공유해요. 획득 장소·시각·경로는 비공개예요.'}</Text>
        {garden.cellCount > 32 ? <View style={styles.sectionHeader}>
          <Pressable disabled={page === 0} onPress={() => setPage(page - 1)}><Text>← 이전</Text></Pressable>
          <Text>{page + 1} / {Math.ceil(garden.cellCount / 32)}</Text>
          <Pressable disabled={(page + 1) * 32 >= garden.cellCount} onPress={() => setPage(page + 1)}><Text>다음 →</Text></Pressable>
        </View> : null}
      </Card>
      {own && garden.policy ? <>
        {selected ? <PrimaryButton label="선택 취소" onPress={() => setSelected(null)} /> : null}
        <GardenInventory garden={garden} busy={busy} onSelect={selection => { setSelected(selection); setRemoveMode(false); setNotice('정원의 칸을 선택해 주세요. 씨앗과 식물은 빈 칸에 놓아요.'); }} />
        <PrimaryButton label={removeMode ? '장식 회수 모드 끄기' : '장식 회수 모드'} onPress={() => { setSelected(null); setRemoveMode(v => !v); }} />
        {garden.plants ? <Card tone="mint"><Text style={styles.listTitle}>내 페이스대로 자라는 식물</Text><Text style={styles.cardText}>심은 식물은 모두 함께 자라요. 쉬어도 시들지 않고, 조건이 달라도 기본 성장은 유지돼요. 심거나 옮긴 뒤 새로 시작한 검증 러닝부터 반영돼요.</Text>
          <PrimaryButton disabled={busy} label="처음 만나는 씨앗 받기 · 1회" onPress={() => {
            if (mutation.current) return; mutation.current = true; setBusy(true);
            void gardenRpc('start_garden').then(() => setRefresh(x => x + 1)).catch(e => setNotice(errorMessage(e))).finally(() => { mutation.current = false; setBusy(false); });
          }} /></Card> : <Notice text="씨앗 성장 기능은 서버 037 업데이트 후 열려요. 기존 장식은 계속 꾸밀 수 있어요." />}
        <Card><Text style={styles.listTitle}>다음 발견까지 {Math.ceil(garden.policy.dropMeters - (garden.meters ?? 0) % garden.policy.dropMeters)}m</Text>
          <Text style={styles.cardText}>정원 시작 이후 유효 거리 {((garden.meters ?? 0) / 1000).toFixed(2)}km · 다음 {garden.policy.growthCells}칸 확장까지 {((garden.policy.expansionMeters - (garden.meters ?? 0) % garden.policy.expansionMeters) / 1000).toFixed(2)}km</Text>
          <Text style={styles.caption}>{garden.policy.dropMeters}m당 {(['common', 'rare'] as const).map(rarity => `${rarity === 'common' ? '일반' : '희귀'} ${(garden.catalog.filter(i => i.rarity === rarity).reduce((sum, i) => sum + i.weight, 0) / (garden.catalog.reduce((sum, i) => sum + i.weight, 0) + garden.policy!.noDropWeight) * 100).toFixed(1)}%`).join(' · ')}. 나머지는 미획득이에요. 일일 수집 구간은 아직 운영하지 않아요.</Text></Card>
        <Text style={styles.caption}>{garden.collecting ? '거리 기반 아이템 수집에 참여 중이에요.' : '아이템 수집을 중단했어요. 기존 정원은 계속 꾸밀 수 있어요.'}</Text>
        <PrimaryButton label={garden.collecting ? '수집 참여 중단' : '수집에 다시 참여'} onPress={() => {
          if (busy) return; setBusy(true);
          void gardenRpc('set_garden_collecting', { p_collecting: !garden.collecting }).then(() => setRefresh(x => x + 1)).catch(e => setNotice(errorMessage(e, '참여 설정을 바꾸지 못했어요.'))).finally(() => setBusy(false));
        }} />
        <Text style={styles.sectionTitle}>정원 공개 범위</Text>
        <Text style={styles.caption}>방문자는 배치만 볼 수 있어요. 공개해도 채팅 자격은 생기지 않아요.</Text>
        <ChoiceGroup options={['나만', '친구', '친구와 매칭 후보']} value={garden.visibility === 'matching' ? '친구와 매칭 후보' : garden.visibility === 'friends' ? '친구' : '나만'}
          onChange={value => { if (!busy) void save(garden.placements, value === '나만' ? 'private' : value === '친구' ? 'friends' : 'matching'); }} />
        <Text style={styles.sectionTitle}>친구 정원 산책</Text>
        <Text style={styles.caption}>상호 수락으로 연결된 친구 중 방문을 허용한 정원이에요.</Text>
        {friends.length ? friends.map(friend => <PrimaryButton key={friend.id} label={`${friend.nickname}의 정원 구경 →`} onPress={() => onVisit(friend.id)} />) : <Text style={styles.caption}>아직 방문할 수 있는 친구 정원이 없어요.</Text>}
      </> : null}
    </> : !notice && own ? <Card tone="mint">
      <Text style={styles.listTitle}>달리는 만큼, 피어나는 정원.</Text>
      <Text style={styles.cardText}>참여 이후 새로 기록한 러닝의 서버 검증 거리로 아이템을 모아요. 이전 기록은 소급 지급하지 않아요. 시작 선물은 꽃·나무·돌 각 1개, 정원은 16칸이에요.</Text>
      <Text style={styles.caption}>선택 참여예요. 별도 위치 추적은 하지 않으며, 공개는 기본 비공개예요. 기록을 삭제해도 이미 얻은 아이템은 유지되고, 계정 파기 시 정원과 지급 원장도 삭제돼요.</Text>
      <PrimaryButton label={busy ? '정원 준비 중…' : '거리 기반 수집에 참여하고 정원 시작'} onPress={() => {
        if (busy) return; setBusy(true);
        void gardenRpc('start_garden').then(() => setRefresh(x => x + 1)).catch(e => setNotice(errorMessage(e, '정원을 시작하지 못했어요.'))).finally(() => setBusy(false));
      }} />
    </Card> : null}
    <PrimaryButton label="다시 불러오기" onPress={() => { if (!busy) setRefresh(x => x + 1); }} />
  </>;
}

export function GardenRunReward({ sessionId, onGarden }: { sessionId: string; onGarden: () => void }) {
  const [reward, setReward] = useState<RunReward | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const data = await gardenRpc<RunReward>('run_garden_rewards', { p_session: sessionId });
        if (!active) return;
        setReward(data); setError('');
        if (data.status === 'processing') timer = setTimeout(read, 5000);
      } catch (e) { if (active) setError(errorMessage(e, '보상을 확인하지 못했어요. 정원에서 다시 확인해 주세요.')); }
    };
    setReward(null); void read();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [sessionId]);
  return <Card tone="mint"><Text style={styles.listTitle}>이번 러닝의 작은 발견 🌱</Text>
    <Text style={styles.cardText}>{error || (!reward || reward.status === 'processing' ? '서버 검증 후 보상을 확인해요. 기다리지 않고 나가도 자동 지급돼요.' : reward.status === 'not_credited' ? '정원 참여 전 기록이거나 거리·GPS 품질 조건을 충족하지 않아 보상이 없어요.' : `${reward.opportunities}번의 발견 기회 · ${Object.values(reward.rewards).reduce((a, b) => a + b, 0)}개 수집`)}</Text>
    {reward?.catalog.filter(item => reward.rewards[item.id]).map(item => <Text key={item.id} style={styles.listTitle}>{item.icon} {item.name} × {reward.rewards[item.id]}{item.rarity === 'rare' ? ' · 희귀!' : ''}</Text>)}
    {reward && reward.expansions > 0 ? <Text style={styles.cardText}>정원이 {reward.expansions}단계 넓어졌어요!</Text> : null}
    <PrimaryButton label="정원에서 꾸미기 →" onPress={onGarden} />
  </Card>;
}
