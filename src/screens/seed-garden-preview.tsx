import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Garden } from '../features/garden/garden-api';
import { growthIcon, growthStage } from '../features/garden/garden-presentation';
import { Card, Notice, PrimaryButton } from '../ui/components';
import { styles } from '../ui/styles';
import { GardenInventory, type GardenSelection } from './garden-inventory';

// Explicitly fictional UI fixture. No API calls, real rewards, distance or session changes.
const sample: Garden = {
  ownerId: 'preview', nickname: '씨앗 체험', cellCount: 16, placements: [], plants: [],
  inventory: { sun_seed: 2, clover_seed: 1, moon_spore: 1, tree: 1 },
  collection: { sun_seed: 'discovered', clover_seed: 'discovered', moon_spore: 'discovered', tree: 'completed' },
  catalog: [
    { id: 'sun_seed', name: '해바라기 씨앗', icon: '🌰', rarity: 'common', weight: 0, kind: 'seed', mature_name: '해바라기', mature_icon: '🌻', growth_meters: 5000, description: '햇살형 · 낮 러닝을 좋아해요. 다른 시간에도 자라요.' },
    { id: 'clover_seed', name: '클로버 씨앗', icon: '🌰', rarity: 'common', weight: 0, kind: 'seed', mature_name: '클로버', mature_icon: '🍀', growth_meters: 3000, description: '꾸준형 · 서로 다른 날의 러닝을 좋아해요. 연속 출석은 필요 없어요.' },
    { id: 'moon_spore', name: '달빛 버섯 포자', icon: '✧', rarity: 'rare', weight: 0, kind: 'seed', mature_name: '달빛 버섯', mature_icon: '🍄', growth_meters: 5000, description: '달빛형 · 저녁 러닝과 완성된 나무 옆을 좋아해요. 심야 추가 보상은 없어요.' },
    { id: 'spring_seed', name: '봄맞이꽃 씨앗', icon: '🌰', rarity: 'common', weight: 0, kind: 'seed', mature_name: '봄맞이꽃', mature_icon: '🌸', growth_meters: 3000, description: '첫걸음형 · 쉬었다 돌아온 날을 반겨요.' },
    { id: 'tree', name: '작은 나무', icon: '🌳', rarity: 'common', weight: 0, kind: 'decoration', description: '완성 장식 · 자라는 식물 옆의 작은 쉼터예요.' },
  ],
};
export function SeedGardenPreview() {
  const [garden, setGarden] = useState(sample);
  const [selection, setSelection] = useState<GardenSelection>(null);
  const [visitor, setVisitor] = useState(false);
  const [message, setMessage] = useState('보관함의 씨앗을 누르고, 심기를 선택한 뒤 빈 칸에 놓아 보세요.');
  const place = (cell: number) => {
    const plant = garden.plants?.find(p => p.cell === cell);
    if (!selection) {
      if (plant) {
        setGarden({ ...garden, plants: garden.plants?.map(p => p.id === plant.id ? { ...p, cell: null } : p) });
        setMessage('체험 식물을 보관했어요. 성장률은 유지돼요.');
      } else setMessage('먼저 보관함에서 아이템을 골라주세요.');
      return;
    }
    if (plant || garden.placements.some(p => p.cell === cell)) { setMessage('빈 칸을 골라주세요.'); return; }
    if (selection.kind === 'plant') {
      setGarden({ ...garden, plants: garden.plants?.map(p => p.id === selection.id ? { ...p, cell } : p) });
    } else {
      const item = garden.catalog.find(i => i.id === selection.id);
      if (!item || (garden.inventory?.[item.id] ?? 0) < 1) { setSelection(null); return; }
      if (item.kind === 'seed') setGarden({ ...garden,
        inventory: { ...garden.inventory, [item.id]: (garden.inventory?.[item.id] ?? 0) - 1 },
        plants: [...garden.plants ?? [], { id: `preview-${garden.plants?.length ?? 0}`, itemId: item.id, cell, progress: 0 }],
      });
      else setGarden({ ...garden, placements: [...garden.placements.filter(p => p.itemId !== item.id), { cell, itemId: item.id }] });
    }
    setSelection(null); setMessage('체험 정원에 놓았어요. 성장 체험 버튼으로 모습을 확인해 보세요.');
  };
  return <>
    <Notice text="씨앗 성장 미리보기 · 예시 데이터이며 실제 계정·아이템·러닝 기록에는 영향을 주지 않아요. 나가면 초기화됩니다." />
    <Card tone="mint"><Text style={styles.sectionTitle}>작은 시작, 나만의 숲 🌱</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: 16 }, (_, cell) => {
          const plant = garden.plants?.find(p => p.cell === cell);
          const item = garden.catalog.find(i => i.id === (plant?.itemId ?? garden.placements.find(p => p.cell === cell)?.itemId));
          return <Pressable key={cell} disabled={visitor} onPress={() => place(cell)} accessibilityRole="button" accessibilityLabel={`체험 ${cell + 1}번째 칸, ${item?.mature_name ?? item?.name ?? '빈 칸'}`}
            style={{ width: '25%', aspectRatio: 1, borderWidth: 2, borderColor: '#EEF5DF', backgroundColor: '#D4E2BC', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 30 }}>{plant ? growthIcon(growthStage(plant.progress), item?.mature_icon ?? '🌿') : item?.icon ?? '+'}</Text>
            {!visitor && plant ? <Text style={styles.caption}>{plant.progress}%</Text> : null}
          </Pressable>;
        })}
      </View>
      <Text style={styles.caption}>{visitor ? '방문자는 모습만 봐요. 성장률·러닝 시간·도감은 보이지 않아요.' : message}</Text>
    </Card>
    <PrimaryButton label={visitor ? '내 체험 정원으로 돌아가기' : '방문자 모습 미리보기'} onPress={() => setVisitor(v => !v)} />
    {!visitor ? <>
      <PrimaryButton label="성장 모습 체험 +25% · 실제 보상 아님" disabled={!garden.plants?.some(p => p.cell !== null && p.progress < 100)} onPress={() => {
        const plants = garden.plants?.map(p => p.cell === null ? p : { ...p, progress: Math.min(100, p.progress + 25) });
        const collection = { ...garden.collection };
        plants?.filter(p => p.progress === 100).forEach(p => { collection[p.itemId] = 'completed'; });
        setGarden({ ...garden, plants, collection });
      }} />
      <Text style={styles.caption}>체험에서는 심은 식물을 누르면 보관해요. 실제 성장은 서버에서 검증된 러닝으로만 진행됩니다.</Text>
      {selection ? <PrimaryButton label="선택 취소" onPress={() => setSelection(null)} /> : null}
      <GardenInventory garden={garden} busy={false} onSelect={s => { setSelection(s); setMessage('정원의 빈 칸을 선택해 주세요.'); }} />
    </> : null}
  </>;
}
