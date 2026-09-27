import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CatalogItem, Garden, GardenPlant } from '../features/garden/garden-api';
import { growthIcon, growthStage, growthStageNames } from '../features/garden/garden-presentation';
import { Card, ChoiceGroup, PrimaryButton } from '../ui/components';
import { styles } from '../ui/styles';

export type GardenSelection = { kind: 'item'; id: string } | { kind: 'plant'; id: string } | null;
export function GardenInventory({ garden, busy, onSelect }: {
  garden: Garden; busy: boolean; onSelect: (selection: GardenSelection) => void;
}) {
  const [tab, setTab] = useState('보관함');
  const [detail, setDetail] = useState<{ item: CatalogItem; plant?: GardenPlant } | null>(null);
  const plants = garden.plants ?? [];
  const discovered = (item: CatalogItem) => Boolean(garden.collection?.[item.id] || garden.inventory?.[item.id] || plants.some(p => p.itemId === item.id));
  const completed = (item: CatalogItem) => garden.collection?.[item.id] === 'completed' || (item.kind !== 'seed' && discovered(item));
  const entries = garden.catalog.filter(item => tab === '도감' || (garden.inventory?.[item.id] ?? 0) > 0);
  const storedPlants = plants.filter(p => p.cell === null);
  return <>
    <Text style={styles.sectionTitle}>작은 보물 보관함</Text>
    <ChoiceGroup options={['보관함', '도감']} value={tab} onChange={setTab} />
    <Text style={styles.caption}>{tab === '도감' ? `발견 ${garden.catalog.filter(discovered).length}/${garden.catalog.length} · 완성 ${garden.catalog.filter(completed).length}종` : '아이템을 눌러 알아보고, 심거나 배치해 보세요.'}</Text>
    <View style={ui.grid}>
      {entries.map(item => {
        const known = discovered(item);
        const quantity = garden.inventory?.[item.id] ?? 0;
        return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={known ? `${item.name}, ${quantity}개, ${completed(item) ? '완성' : '발견'}` : '미발견 아이템'}
          disabled={busy || !known} onPress={() => setDetail({ item })} style={[ui.slot, item.rarity === 'rare' && known && ui.rare]}>
          <Text style={ui.icon}>{!known ? '◇' : tab === '도감' && completed(item) ? item.mature_icon ?? item.icon : item.icon}</Text>
          <Text style={ui.name} numberOfLines={2}>{known ? item.name : '???'}</Text>
          <Text style={ui.quantity}>{tab === '도감' ? completed(item) ? '완성 ✓' : known ? '발견' : '미발견' : `× ${quantity}`}</Text>
          {known && item.rarity === 'rare' ? <Text style={ui.rareLabel}>희귀</Text> : null}
        </Pressable>;
      })}
      {tab === '보관함' ? storedPlants.map(plant => {
        const item = garden.catalog.find(i => i.id === plant.itemId);
        if (!item) return null;
        return <Pressable key={plant.id} accessibilityRole="button" accessibilityLabel={`${item.mature_name}, 성장 ${plant.progress}%, 보관 중`} disabled={busy} onPress={() => setDetail({ item, plant })} style={ui.slot}>
          <Text style={ui.icon}>{growthIcon(growthStage(plant.progress), item.mature_icon ?? item.icon)}</Text>
          <Text style={ui.name} numberOfLines={2}>{item.mature_name}</Text><Text style={ui.quantity}>{plant.progress}% · 보관 중</Text>
        </Pressable>;
      }) : null}
    </View>
    {tab === '보관함' && entries.length + storedPlants.length === 0 ? <Card><Text style={styles.cardText}>보관함이 비었어요. 달리면서 새로운 씨앗을 만나보세요.</Text></Card> : null}
    <Modal visible={detail !== null} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
      <View style={ui.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="아이템 설명 닫기" onPress={() => setDetail(null)} style={StyleSheet.absoluteFill} />
        <View style={ui.sheet} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 24 }}>
            {detail ? <>
              <Text style={ui.hero}>{detail.plant ? growthIcon(growthStage(detail.plant.progress), detail.item.mature_icon ?? detail.item.icon) : detail.item.icon}</Text>
              <Text style={styles.sectionTitle}>{detail.plant ? detail.item.mature_name : detail.item.name}</Text>
              <Text style={styles.caption}>{detail.item.rarity === 'rare' ? '희귀' : '일반'} · {detail.plant ? `${detail.plant.progress}% · ${growthStageNames[growthStage(detail.plant.progress)]}` : `${garden.inventory?.[detail.item.id] ?? 0}개 보유`}</Text>
              {detail.item.kind !== 'seed' ? <Text style={styles.caption}>이 중 {garden.placements.filter(p => p.itemId === detail.item.id).length}개는 정원에 배치되어 있어요.</Text> : null}
              <Text style={styles.cardText}>{detail.item.description ?? '정원에 놓아 나만의 풍경을 만들어 보세요.'}</Text>
              {detail.item.kind === 'seed' ? <Text style={styles.cardText}>기본 성장 거리 {((detail.item.growth_meters ?? 0) / 1000).toFixed(1)}km · 조건이 달라도 기본 성장은 유지돼요. 보관 중에는 성장이 쉬어가고, 다시 심어도 자란 만큼은 그대로예요.</Text> : null}
              <PrimaryButton disabled={busy || (!detail.plant && (garden.inventory?.[detail.item.id] ?? 0) <= 0)}
                label={detail.plant ? '정원에 다시 놓기' : detail.item.kind === 'seed' ? '씨앗 심기 · 빈 칸 선택' : '배치하기 · 칸 선택'}
                onPress={() => { onSelect(detail.plant ? { kind: 'plant', id: detail.plant.id } : { kind: 'item', id: detail.item.id }); setDetail(null); }} />
            </> : null}
            <PrimaryButton label="닫기" onPress={() => setDetail(null)} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
const ui = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 4, backgroundColor: '#EDF2E8', borderRadius: 20 },
  slot: { width: '25%', minHeight: 112, borderWidth: 3, borderColor: '#EDF2E8', borderRadius: 14, padding: 5, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', gap: 4 },
  rare: { backgroundColor: '#F3EBFF' }, icon: { fontSize: 30 }, name: { fontSize: 11, textAlign: 'center', color: '#244536', fontWeight: '600' },
  quantity: { fontSize: 10, color: '#587062' }, rareLabel: { fontSize: 9, color: '#7C4C9C' },
  overlay: { flex: 1, backgroundColor: '#0007', justifyContent: 'flex-end' },
  sheet: { maxHeight: '80%', backgroundColor: '#F8FAF4', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24 },
  hero: { fontSize: 64, textAlign: 'center' },
});
