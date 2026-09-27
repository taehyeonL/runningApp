import { supabase } from '../../lib/supabase';

export type CatalogItem = { id: string; name: string; icon: string; rarity: 'common' | 'rare'; weight: number;
  kind?: 'decoration' | 'seed'; mature_name?: string; mature_icon?: string; growth_meters?: number;
  trait?: 'none' | 'day' | 'evening' | 'steady' | 'comeback'; tree_neighbor?: boolean; description?: string };
export type Plot = { cell: number; itemId: string; stage?: number };
export type GardenPlant = { id: string; itemId: string; cell: number | null; progress: number };
export type Garden = {
  ownerId: string; nickname: string; cellCount: number; placements: Plot[]; catalog: CatalogItem[];
  inventory?: Record<string, number>; meters?: number; revision?: number; collecting?: boolean;
  plants?: GardenPlant[]; collection?: Record<string, 'discovered' | 'completed'>;
  visibility?: 'private' | 'friends' | 'matching';
  policy?: { version: number; dropMeters: number; expansionMeters: number; growthCells: number; noDropWeight: number };
};
export type RunReward = { status: 'processing' | 'credited' | 'not_credited'; opportunities: number | null;
  rewards: Record<string, number>; expansions: number; catalog: CatalogItem[] };
export async function gardenRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('서버 연결 설정이 필요해요.');
  const { data, error } = await supabase.rpc(name, args);
  if (error?.code === 'PGRST202' || error?.code === '42883') {
    throw new Error('정원 서버 기능이 아직 적용되지 않았어요. 서버 업데이트 후 다시 이용해 주세요. 러닝 기록은 계속 사용할 수 있어요.');
  }
  if (error) throw error;
  return data as T;
}
