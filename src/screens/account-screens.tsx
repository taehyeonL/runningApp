import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import type { PrivacyController } from '../hooks/use-privacy';
import { Back, Card, Kicker, Notice, PrimaryButton } from '../ui/components';
import { styles } from '../ui/styles';
import { LegalLinks, SupportContact } from './legal-center';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long' }).format(new Date(value));
}

const isValidNickname = (nickname: string) => /^[가-힣]{2,8}$/.test(nickname);

// 위치 동의 철회와 계정 삭제는 요금제와 무관한 기본 권리다. 되돌릴 수 없는
// 결과를 먼저 문장으로 알려주고, 확인을 거친 뒤에만 실행한다.
export function AccountScreen({ privacy, onBack }: {
  privacy: PrivacyController;
  onBack: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const status = privacy.status;
  const deletionPending = Boolean(status?.deletionPurgeAfter);

  useEffect(() => {
    if (status?.nickname) setNickname(status.nickname);
  }, [status?.nickname]);

  const confirmWithdrawLocation = () => Alert.alert(
    '위치 동의를 철회할까요?',
    '새 러닝 기록과 발견이 중단되고, 지금까지 저장된 원본 GPS는 파기 대상이 됩니다. 거리·시간·페이스 기록은 그대로 남아요.',
    [
      { text: '취소', style: 'cancel' },
      {
        text: '철회하기',
        style: 'destructive',
        onPress: () => void privacy.withdrawLocation().catch(() => undefined),
      },
    ],
  );

  const confirmDeletion = () => Alert.alert(
    '계정을 삭제할까요?',
    '신청 즉시 발견·요청·채팅에서 사라지고 원본 GPS가 파기됩니다. 30일 안에 다시 로그인하면 되돌릴 수 있고, 그 뒤에는 복구할 수 없어요.',
    [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제 신청',
        style: 'destructive',
        onPress: () => void privacy.requestDeletion(reason).catch(() => undefined),
      },
    ],
  );

  const changeNickname = () => {
    if (!isValidNickname(nickname.trim())) {
      setNicknameError('닉네임은 한글 2~8자로 입력해 주세요.');
      return;
    }
    setNicknameError(null);
    void privacy.changeNickname(nickname).catch(() => undefined);
  };

  return (
    <>
      <Back onPress={onBack} />
      <Kicker>계정과 데이터</Kicker>
      <Text style={styles.pageTitle}>내 데이터 통제</Text>
      <Text style={styles.pageSub}>동의 철회와 계정 삭제는 무료 사용자도 언제든 할 수 있어요.</Text>

      {privacy.isLoading ? <Notice text="설정을 불러오고 있어요…" /> : null}
      {privacy.notice ? <Notice text={privacy.notice} /> : null}
      {privacy.error ? <Notice text={privacy.error} /> : null}
      <LegalLinks />
      <SupportContact />

      {deletionPending && status ? (
        <Card tone="yellow">
          <Text style={styles.listTitle}>계정 삭제가 예약되어 있어요</Text>
          <Text style={styles.cardText}>
            {formatDate(status.deletionPurgeAfter!)}에 계정과 모든 러닝 기록이 삭제됩니다.
            그 전까지는 되돌릴 수 있어요.
          </Text>
          <PrimaryButton
            label={privacy.isBusy ? '처리 중…' : '삭제 신청 되돌리기'}
            disabled={privacy.isBusy}
            onPress={() => void privacy.cancelDeletion().catch(() => undefined)}
          />
        </Card>
      ) : null}

      <Text style={styles.sectionTitle}>닉네임</Text>
      <Card>
        <Text style={styles.listTitle}>프로필에 표시되는 이름</Text>
        <Text style={styles.cardText}>닉네임은 한글 2~8자로 설정하며, 변경 후 6개월 동안 다시 바꿀 수 없어요.</Text>
        <TextInput value={nickname} onChangeText={(value) => { setNickname(value); setNicknameError(null); }} maxLength={8} autoCapitalize="none" placeholder="한글 2~8자" style={styles.detailsInput} />
        {nicknameError ? <Notice text={nicknameError} /> : null}
        {status?.nicknameChangeAvailableAt ? <Text style={styles.caption}>다음 변경 가능: {formatDate(status.nicknameChangeAvailableAt)}</Text> : <Text style={styles.caption}>지금 한 번 변경할 수 있어요.</Text>}
        <PrimaryButton label={privacy.isBusy ? '저장 중…' : '닉네임 변경'} disabled={privacy.isBusy || nickname.trim() === status?.nickname} onPress={changeNickname} />
      </Card>

      <Text style={styles.sectionTitle}>개인위치정보</Text>
      <Card>
        <Text style={styles.listTitle}>
          위치 동의 {status?.locationConsentGranted ? '유효' : '철회됨'}
        </Text>
        <Text style={styles.cardText}>
          러닝 중 위치는 거리·페이스 기록과 서버의 동선 유사도 판정에만 사용해요.
          다른 사용자에게 원본 좌표나 정확한 시각을 제공하지 않습니다.
        </Text>
        {status?.locationConsentGranted ? (
          <Pressable disabled={privacy.isBusy} onPress={confirmWithdrawLocation}>
            <Text style={styles.destructiveText}>위치 동의 철회하고 원본 GPS 파기하기</Text>
          </Pressable>
        ) : (
          <Text style={styles.caption}>다시 러닝을 시작할 때 위치 동의를 새로 받습니다.</Text>
        )}
      </Card>

      {!deletionPending ? (
        <>
          <Text style={styles.sectionTitle}>계정 삭제</Text>
          <Card>
            <Text style={styles.cardText}>
              삭제를 신청하면 프로필·러닝 기록·요청·채팅이 30일 뒤 영구 삭제됩니다.
              안전 운영을 위해 중대 신고 이력은 개인을 식별할 수 없는 형태로만 남습니다.
            </Text>
            <Text style={styles.caption}>삭제 사유 (선택)</Text>
            <View style={styles.choiceGroup}>
              {['앱을 쓰지 않게 됐어요', '원하는 러너를 못 만났어요', '개인정보가 걱정돼요'].map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setReason(reason === option ? null : option)}
                  style={[styles.chip, reason === option && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, reason === option && styles.chipTextSelected]}>{option}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              disabled={privacy.isBusy}
              onPress={confirmDeletion}
              style={[styles.blockButton, privacy.isBusy && styles.buttonDisabled]}
            >
              <Text style={styles.blockText}>{privacy.isBusy ? '처리 중…' : '계정 삭제 신청'}</Text>
            </Pressable>
          </Card>
        </>
      ) : null}
    </>
  );
}
