import { useState } from 'react';
import { Linking, Modal, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { legalDocuments, legalDraftNotice, legalVersion, supportEmail, type LegalDocumentId } from '../lib/legal-documents';
import { errorMessage } from '../lib/errors';
import { Notice, PrimaryButton } from '../ui/components';
import { styles } from '../ui/styles';

export function LegalLinks() {
  const [opened, setOpened] = useState<LegalDocumentId | null>(null);
  const doc = opened ? legalDocuments[opened] : null;
  return <View style={{ gap: 8 }}>
    {(Object.keys(legalDocuments) as LegalDocumentId[]).map((key) => <Pressable key={key} accessibilityRole="button" style={styles.quietButton} onPress={() => setOpened(key)}><Text style={styles.caption}>{legalDocuments[key].title} · 전문 보기</Text></Pressable>)}
    <Modal visible={Boolean(doc)} animationType="slide" onRequestClose={() => setOpened(null)}>
      <SafeAreaView style={[styles.safe, { paddingTop: 24, paddingBottom: 16 }]}>
        <View style={{ paddingHorizontal: 22 }}><PrimaryButton label="닫기" onPress={() => setOpened(null)} /></View>
        <ScrollView key={opened} contentContainerStyle={styles.scroll}>
          <Text accessibilityRole="header" style={styles.pageTitle}>{doc?.title}</Text>
          <Text style={styles.caption}>{legalVersion} · 작성일 2026-09-24 · 정식 시행 전</Text>
          <Notice text={legalDraftNotice} />
          <Text style={styles.cardText}>{doc?.summary}</Text>
          {doc?.sections.map((section) => <View key={section.title} style={styles.section}><Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text><Text selectable style={styles.cardText}>{section.body}</Text></View>)}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </View>;
}

export function SupportContact() {
  const [error, setError] = useState('');
  const configured = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail);
  return <View style={styles.section}>
    <Text style={styles.listTitle}>문의·이의제기</Text>
    <Text style={styles.cardText}>계정·개인정보·신고 처리에 관해 문의할 수 있어요. 비밀번호·인증번호·원본 경로는 보내지 마세요. 긴급 상황은 112 또는 119로 직접 연락하세요.</Text>
    {configured ? <><Text selectable style={styles.caption}>{supportEmail}</Text><PrimaryButton label="이메일로 문의하기" onPress={() => { setError(''); void Linking.openURL(`mailto:${supportEmail}?subject=${encodeURIComponent('[같이뛰어] 문의')}`).catch(reason => setError(errorMessage(reason, '메일 앱을 열 수 없어요. 위 주소로 직접 문의해 주세요.'))); }} /></> : <Notice text="운영자 문의 연락처가 아직 등록되지 않았습니다. 공개 출시 전 등록이 필요합니다." />}
    {error ? <Notice text={error} /> : null}
  </View>;
}
