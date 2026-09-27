import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GARDEN_DROP_INTERVAL_METERS, GARDEN_EXPANSION_INTERVAL_METERS } from '../features/garden/garden-rules';
import { placeGardenDecoration, type GardenPlacement } from '../features/garden/garden-layout';
import { errorMessage } from '../lib/errors';
import { Back, Card, ChoiceGroup, Kicker, Notice, PrimaryButton } from '../ui/components';
import { styles } from '../ui/styles';
import { SeedGardenPreview } from './seed-garden-preview';

// Explicit sample inventory. Never mixed into actual reward balances or other users' profiles.
const previewItems = [
  { instanceId: 'preview-flower', itemId: 'flower', name: '햇살 꽃', icon: '🌼', rarity: '일반' },
  { instanceId: 'preview-tree', itemId: 'tree', name: '작은 나무', icon: '🌳', rarity: '일반' },
  { instanceId: 'preview-rock', itemId: 'rock', name: '동글 돌', icon: '🪨', rarity: '일반' },
  { instanceId: 'preview-mushroom', itemId: 'mushroom', name: '달빛 버섯', icon: '🍄', rarity: '희귀' },
  { instanceId: 'preview-fountain', itemId: 'fountain', name: '별빛 분수', icon: '⛲', rarity: '희귀' },
] as const;
const startingLayout: GardenPlacement[] = [
  { cell: 2, instanceId: 'preview-tree' }, { cell: 8, instanceId: 'preview-flower' },
  { cell: 13, instanceId: 'preview-rock' },
];
const previewCellCount = 16;

export function GardenScreen({ onBack, onStartRun }: { onBack: () => void; onStartRun: () => void }) {
  const [tab, setTab] = useState('씨앗 체험');
  const [placements, setPlacements] = useState<GardenPlacement[]>(startingLayout);
  const [selected, setSelected] = useState<string | null>(previewItems[0].instanceId);
  const [visitorView, setVisitorView] = useState(false);
  const [notice, setNotice] = useState('');

  const place = (cell: number) => {
    try {
      setPlacements(placeGardenDecoration(placements, previewItems, previewCellCount, cell, selected));
      setNotice(selected ? '배치했어요. 다른 칸을 누르면 옮길 수 있어요.' : '보관함으로 돌려보냈어요.');
    } catch (error) {
      setNotice(errorMessage(error, '배치를 변경하지 못했어요.'));
    }
  };

  return <>
    <Back onPress={onBack} />
    <Kicker>RUN & GROW · 미리보기</Kicker>
    <Text style={styles.pageTitle}>달리는 만큼, 피어나는 정원.</Text>
    <Text style={styles.pageSub}>길에서 발견한 작은 보물로 나만의 풍경을 만들어요.</Text>
    <Notice text="꾸미기 체험입니다. 예시 아이템을 사용하며 실제 러닝 보상은 아직 지급되지 않아요. 화면을 나가면 배치가 초기화됩니다." />
    <ChoiceGroup options={['씨앗 체험', '꾸미기', '수집 안내']} value={tab} onChange={setTab} />
    {tab === '씨앗 체험' ? <SeedGardenPreview /> : tab === '꾸미기' ? <>
      <View style={gardenStyles.scene}>
        <View style={styles.sectionHeader}><Text style={gardenStyles.sceneTitle}>{visitorView ? '방문자가 보는 정원 · 예시' : '나의 작은 정원 · 예시'}</Text><Text style={gardenStyles.sun}>☀</Text></View>
        <Text style={styles.caption}>꽃과 나무가 머무는 작은 쉼터</Text>
        <View style={gardenStyles.board}>
          {Array.from({ length: previewCellCount }, (_, cell) => {
            const placement = placements.find((item) => item.cell === cell);
            const decoration = previewItems.find((item) => item.instanceId === placement?.instanceId);
            return <Pressable key={cell} disabled={visitorView} accessibilityRole={visitorView ? undefined : 'button'}
              accessibilityLabel={`${Math.floor(cell / 4) + 1}행 ${cell % 4 + 1}열, ${decoration?.name ?? '빈 칸'}${visitorView ? '' : ', 배치하기'}`}
              onPress={() => place(cell)} style={[gardenStyles.plot, cell % 2 === 0 && gardenStyles.plotLight]}>
              <Text style={gardenStyles.decoration}>{decoration?.icon ?? (visitorView ? '·' : '+')}</Text>
            </Pressable>;
          })}
        </View>
        <Text style={styles.caption}>{visitorView ? '꾸민 모습만 보여요. 획득 장소·날짜·경로는 보이지 않아요.' : '아이템을 고른 다음 놓을 칸을 눌러보세요.'}</Text>
      </View>
      <Pressable accessibilityRole="button" style={styles.quietButton} onPress={() => { setVisitorView(!visitorView); setNotice(''); }}><Text style={styles.secondaryText}>{visitorView ? '꾸미기로 돌아가기' : '방문자 화면 미리보기'}</Text></Pressable>
      {!visitorView ? <>
        <Text style={styles.sectionTitle}>작은 보물 보관함</Text>
        <View style={gardenStyles.inventory}>
          {previewItems.map((item) => <Pressable accessibilityRole="button" accessibilityState={{ selected: selected === item.instanceId }} key={item.instanceId}
            onPress={() => setSelected(item.instanceId)} style={[gardenStyles.item, selected === item.instanceId && gardenStyles.itemSelected]}>
            <Text style={gardenStyles.itemIcon}>{item.icon}</Text><Text style={styles.listTitle}>{item.name}</Text>
            <Text style={styles.caption}>{item.rarity} · {placements.some((placement) => placement.instanceId === item.instanceId) ? '배치 중' : '보관 중'}</Text>
          </Pressable>)}
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: selected === null }} onPress={() => setSelected(null)} style={styles.quietButton}><Text style={styles.secondaryText}>{selected === null ? '회수 모드 · 돌려보낼 칸을 누르세요' : '배치한 아이템 회수하기'}</Text></Pressable>
        {notice ? <Text accessibilityLiveRegion="polite" style={styles.caption}>{notice}</Text> : null}
      </> : null}
      <Card tone="mint"><Text style={styles.listTitle}>다음 풍경은 {GARDEN_EXPANSION_INTERVAL_METERS / 1000}km 뒤에</Text><Text style={styles.cardText}>여러 날 달린 거리를 모아 42km마다 정원이 넓어져요. 실제 누적 거리와 확장은 정식 보상 연결 후 표시됩니다.</Text></Card>
    </> : <>
      <Card tone="dark"><Text style={styles.heroEyebrow}>평소 달리던 길에서도</Text><Text style={[styles.runQuestion, styles.metricDark]}>{GARDEN_DROP_INTERVAL_METERS}m마다 작은 발견</Text><Text style={styles.heroCopy}>일반 아이템과 희귀 아이템 모두 확률로 만날 수 있어요. 달리는 중에는 자동으로 모으고, 완료한 뒤 함께 열어봐요.</Text></Card>
      <Card tone="yellow"><Text style={styles.listTitle}>오늘의 수집 구간</Text><Text style={styles.cardText}>안전 검토를 마친 공원·트랙·산책로 중에서 매일 고릅니다. 지정 구간을 달리면 희귀 아이템을 추가로 얻는 방식이에요.</Text><Text style={styles.caption}>아직 운영 중인 수집 구간이 없어요. 준비되지 않은 장소로 안내하지 않습니다.</Text></Card>
      <Card><Text style={styles.listTitle}>함께 구경하는 취향</Text><Text style={styles.cardText}>정원 방문 기능은 준비 중이에요. 공개를 허용한 정원을 매칭 카드나 친구 목록에서 구경할 수 있도록 연결할 예정입니다.</Text><Text style={styles.caption}>상대의 경로나 보물 획득 장소는 공유하지 않아요.</Text></Card>
      <PrimaryButton label="오늘의 러닝으로 돌아가기 →" onPress={onStartRun} />
    </>}
  </>;
}

const gardenStyles = StyleSheet.create({
  scene: { backgroundColor: '#EEF5DF', padding: 18, borderRadius: 26, gap: 12, borderWidth: 1, borderColor: '#DBE7C6' },
  sceneTitle: { color: '#284C35', fontSize: 16, fontWeight: '800', flex: 1 },
  sun: { color: '#AD7A19', fontSize: 28 },
  board: { flexDirection: 'row', flexWrap: 'wrap', padding: 6, borderRadius: 18, backgroundColor: '#BBCD9A', borderBottomWidth: 8, borderBottomColor: '#899E6E' },
  plot: { width: '25%', aspectRatio: 1, backgroundColor: '#CADBAE', borderWidth: 1, borderColor: '#BBCD9A', alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  plotLight: { backgroundColor: '#D4E2BC' },
  decoration: { fontSize: 28, color: '#768E59' },
  inventory: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  item: { flexGrow: 1, flexBasis: '45%', borderWidth: 2, borderColor: '#E4ECE9', backgroundColor: '#FFF', borderRadius: 18, padding: 14, gap: 7 },
  itemSelected: { borderColor: '#168A70', backgroundColor: '#E7F8F0' },
  itemIcon: { fontSize: 30 },
});
