import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { fetchRunRoute, type RunRoute } from '../features/running/run-route';
import { errorMessage } from '../lib/errors';
import { styles } from './styles';

// expo-maps는 최상위에서 import하지 않는다. 네이티브 뷰가 없는 환경(Expo Go, 웹)
// 에서는 불러오는 것만으로 예외가 나므로, 아래의 "쓸 수 있는 환경인가" 판정이
// 실행되기 전에 화면 전체가 죽는다. expo-notifications에서 겪은 것과 같은 문제라
// 같은 방식으로 다룬다.
type MapsModule = typeof import('expo-maps');

let mapsModule: MapsModule | null = null;

async function loadMaps(): Promise<MapsModule> {
  if (mapsModule) return mapsModule;
  mapsModule = await import('expo-maps');
  return mapsModule;
}

type MapAvailability = { usable: true } | { usable: false; reason: string };

function mapAvailability(): MapAvailability {
  if (Platform.OS === 'web') {
    return { usable: false, reason: '웹에서는 경로 지도를 표시하지 않아요.' };
  }
  if (Constants.appOwnership === 'expo') {
    return {
      usable: false,
      reason: 'Expo Go에서는 지도를 표시할 수 없어요. 개발 빌드에서 확인해 주세요.',
    };
  }
  // Apple Maps는 추가 설정이 필요 없지만 Android의 Google Maps는 API 키가 있어야
  // 한다. 키 없이 렌더링하면 빈 회색 사각형이 나올 뿐 원인을 알 수 없으므로,
  // 지도 대신 이유를 보여준다.
  if (Platform.OS === 'android') {
    const key = Constants.expoConfig?.android?.config?.googleMaps?.apiKey;
    if (!key) {
      return {
        usable: false,
        reason: 'Android 지도를 보려면 Google Maps API 키 설정이 필요해요.',
      };
    }
  }
  return { usable: true };
}

function Fallback({ text }: { text: string }) {
  return (
    <View style={styles.routeMapFallback}>
      <Text style={styles.routeMapFallbackText}>{text}</Text>
    </View>
  );
}

const purgeMessages: Record<'retention' | 'consent_withdrawn', string> = {
  retention: '보관 기한이 지나 원본 경로를 파기했어요. 거리·시간·페이스 기록은 그대로 남아 있어요.',
  consent_withdrawn: '위치 이용 동의를 철회하면서 원본 경로를 삭제했어요. 거리·시간·페이스 기록은 그대로 남아 있어요.',
};

/**
 * 내가 달린 경로를 지도 위에 그린다.
 *
 * 이 화면은 본인의 기록에서만 연다. 원본 좌표는 사용자 간에 어떤 형태로도
 * 노출하지 않으므로, 다른 사람의 기록이나 발견·프로필 화면에 이 컴포넌트를
 * 가져다 쓰면 안 된다.
 */
export function RunRouteMap({ sessionId }: { sessionId: string }) {
  const [route, setRoute] = useState<RunRoute | null>(null);
  const [maps, setMaps] = useState<MapsModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const availability = mapAvailability();

  useEffect(() => {
    let mounted = true;
    setRoute(null);
    setError(null);
    void fetchRunRoute(sessionId)
      .then((result) => { if (mounted) setRoute(result); })
      .catch((reason) => {
        if (mounted) setError(errorMessage(reason));
      });
    return () => { mounted = false; };
  }, [sessionId]);

  useEffect(() => {
    if (!availability.usable) return;
    let mounted = true;
    void loadMaps()
      .then((module) => { if (mounted) setMaps(module); })
      .catch((reason) => {
        if (mounted) setError(errorMessage(reason));
      });
    return () => { mounted = false; };
  }, [availability.usable]);

  if (error) return <Fallback text={`경로를 불러오지 못했어요. ${error}`} />;
  if (!route) return <Fallback text="경로를 불러오는 중…" />;
  if (route.status === 'purged') return <Fallback text={purgeMessages[route.reason]} />;
  if (route.status === 'empty') {
    return <Fallback text="이 러닝에는 지도에 그릴 만큼의 위치 기록이 없어요." />;
  }
  if (!availability.usable) return <Fallback text={availability.reason} />;
  if (!maps) return <Fallback text="지도를 준비하는 중…" />;

  const polyline = { coordinates: route.points, color: '#168A70', width: 5 };
  const cameraPosition = { coordinates: route.center, zoom: route.zoom };

  return (
    <View style={styles.routeMap}>
      {Platform.OS === 'ios' ? (
        <maps.AppleMaps.View
          style={{ flex: 1 }}
          cameraPosition={cameraPosition}
          polylines={[polyline]}
          uiSettings={{ myLocationButtonEnabled: false }}
        />
      ) : (
        <maps.GoogleMaps.View
          style={{ flex: 1 }}
          cameraPosition={cameraPosition}
          polylines={[polyline]}
          uiSettings={{ myLocationButtonEnabled: false }}
        />
      )}
    </View>
  );
}
