import { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { SeverityIndicator } from '@/components/SeverityIndicator';
import { ScreenHeader } from '@/components/ScreenHeader';
import type { HazardType, Severity } from '@/api/types';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

interface ReportScreenProps {
  onBack: () => void;
}

type Step = 'hazard' | 'severity' | 'confirm' | 'note' | 'submitted';

const HAZARD_OPTIONS: { value: HazardType; label: string }[] = [
  { value: 'flood', label: 'Flood' },
  { value: 'fire', label: 'Fire' },
  { value: 'earthquake', label: 'Earthquake' },
  { value: 'storm', label: 'Storm' },
  { value: 'landslide', label: 'Landslide' },
  { value: 'other', label: 'Other' },
];

const SEVERITY_OPTIONS: Severity[] = ['low', 'medium', 'high', 'critical'];

export function ReportScreen({ onBack }: ReportScreenProps) {
  const { theme } = useTheme();
  const isOnline = useOnlineStatus();
  const r = useResponsive();

  const [step, setStep] = useState<Step>('hazard');
  const [, setHazard] = useState<HazardType | null>(null);
  const [, setSeverity] = useState<Severity | null>(null);
  const [note, setNote] = useState('');

  const handleHazardSelect = useCallback((h: HazardType) => {
    setHazard(h);
    setStep('severity');
  }, []);

  const handleSeveritySelect = useCallback((s: Severity) => {
    setSeverity(s);
    setStep('confirm');
  }, []);

  const handleConfirm = useCallback(() => {
    setStep('note');
  }, []);

  const handleSubmit = useCallback(() => {
    setStep('submitted');
  }, []);

  const stepTitle = [r.title, styles.stepTitle, { color: theme.text.primary }];
  const optionBtn = [
    styles.optionBtn,
    {
      paddingHorizontal: r.cardPadding,
      backgroundColor: theme.bg.raised,
      borderColor: theme.line.hairline,
    },
  ];
  const submitBtn = [styles.submitBtn, { backgroundColor: theme.text.primary }];
  const submitText = [styles.submitText, { color: theme.bg.base }];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Report a hazard" onBack={onBack} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { padding: r.gutter }]}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'hazard' && (
          <>
            <Text accessibilityRole="header" style={stepTitle}>
              What are you seeing?
            </Text>
            {HAZARD_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={optionBtn}
                onPress={() => handleHazardSelect(opt.value)}
                accessibilityRole="button"
                accessibilityLabel={`Report ${opt.label}`}
              >
                <Text style={[typography.body, { color: theme.text.primary }]}>{opt.label}</Text>
              </Pressable>
            ))}
          </>
        )}

        {step === 'severity' && (
          <>
            <Text accessibilityRole="header" style={stepTitle}>
              How severe?
            </Text>
            {SEVERITY_OPTIONS.map((s) => (
              <Pressable
                key={s}
                style={optionBtn}
                onPress={() => handleSeveritySelect(s)}
                accessibilityRole="button"
                accessibilityLabel={`Severity: ${s}`}
              >
                <SeverityIndicator severity={s} />
              </Pressable>
            ))}
          </>
        )}

        {step === 'confirm' && (
          <>
            <Text accessibilityRole="header" style={stepTitle}>
              Confirm your location
            </Text>
            <Text style={[typography.body, styles.confirmText, { color: theme.text.secondary }]}>
              Your current location will be included with this report to help others nearby.
            </Text>
            <Pressable style={submitBtn} onPress={handleConfirm} accessibilityRole="button">
              <Text style={submitText}>Confirm location</Text>
            </Pressable>
          </>
        )}

        {step === 'note' && (
          <>
            <Text accessibilityRole="header" style={stepTitle}>
              Add a note
            </Text>
            <TextInput
              style={[
                typography.body,
                styles.textarea,
                {
                  padding: r.cardPadding,
                  backgroundColor: theme.bg.raised,
                  borderColor: theme.line.hairline,
                  color: theme.text.primary,
                },
              ]}
              value={note}
              onChangeText={setNote}
              placeholder="Describe what you see (optional)"
              placeholderTextColor={theme.text.faint}
              maxLength={1000}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Optional note about the hazard"
            />
            <Text style={[typography.meta, styles.noteHint, { color: theme.text.faint }]}>
              {note.length}/1000
            </Text>
            <Pressable style={submitBtn} onPress={handleSubmit} accessibilityRole="button">
              <Text style={submitText}>Submit report</Text>
            </Pressable>
            <Pressable style={styles.skipBtn} onPress={handleSubmit} accessibilityRole="button">
              <Text style={[styles.skipText, { color: theme.text.secondary }]}>
                Skip and submit
              </Text>
            </Pressable>
          </>
        )}

        {step === 'submitted' && (
          <View style={[styles.successContainer, { padding: r.sectionGap }]}>
            <Svg width={64} height={64} viewBox="0 0 64 64" fill="none">
              <Circle cx="32" cy="32" r="28" stroke={theme.accent.calm} strokeWidth={3} fill="none" />
              <Path
                d="M22 33l7 7 13-13"
                stroke={theme.accent.calm}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
            <Text
              accessibilityRole="header"
              style={[r.heading, styles.successTitle, { color: theme.text.primary }]}
            >
              {isOnline ? 'Report submitted' : 'Report queued'}
            </Text>
            <Text
              style={[typography.body, styles.successBody, { color: theme.text.secondary }]}
            >
              {isOnline
                ? 'Your report has been received and will be reviewed.'
                : 'Queued — will send when you have signal.'}
            </Text>
            <Pressable
              style={[submitBtn, styles.alignStretch, { marginTop: r.sectionGap }]}
              onPress={onBack}
              accessibilityRole="button"
            >
              <Text style={submitText}>Done</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  stepTitle: {
    marginBottom: spacing.scale[4],
  },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: spacing.minTapTarget + 8,
    paddingVertical: spacing.scale[2],
    borderWidth: 1,
    borderRadius: radius.card,
    marginBottom: spacing.scale[2],
  },
  textarea: {
    minHeight: 120,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  submitBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: spacing.minTapTarget + 8,
    marginTop: spacing.scale[4],
    borderRadius: radius.card,
  },
  submitText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alignStretch: {
    alignSelf: 'stretch',
  },
  successTitle: {
    marginTop: spacing.scale[3],
    textAlign: 'center',
  },
  successBody: {
    marginTop: spacing.scale[2],
    maxWidth: 360,
    textAlign: 'center',
  },
  skipBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: spacing.minTapTarget,
    marginTop: spacing.scale[2],
  },
  skipText: {
    fontSize: 15,
  },
  confirmText: {
    marginBottom: spacing.scale[4],
  },
  noteHint: {
    marginTop: spacing.scale[1],
  },
});
