import { useState, useCallback, type CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { SeverityIndicator } from '@/components/SeverityIndicator';
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

  const styles: Record<string, CSSProperties> = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      padding: `${spacing.scale[2]}px ${r.gutter}px`,
      borderBottom: `1px solid ${theme.line.hairline}`,
      backgroundColor: theme.bg.raised,
      minHeight: spacing.minTapTarget + 8,
    },
    backBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: spacing.minTapTarget,
      minHeight: spacing.minTapTarget,
      background: 'none',
      border: 'none',
      color: theme.text.primary,
      cursor: 'pointer',
      padding: 0,
      marginRight: spacing.scale[2],
    },
    headerTitle: {
      ...r.heading,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    content: {
      flex: 1,
      overflowY: 'auto',
      padding: r.gutter,
    },
    stepTitle: {
      ...r.title,
      color: theme.text.primary,
      margin: `0 0 ${spacing.scale[4]}px 0`,
      fontVariantNumeric: undefined,
    },
    optionBtn: {
      display: 'flex',
      alignItems: 'center',
      width: '100%',
      minHeight: spacing.minTapTarget + 8,
      padding: `${spacing.scale[2]}px ${r.cardPadding}px`,
      backgroundColor: theme.bg.raised,
      border: `1px solid ${theme.line.hairline}`,
      borderRadius: radius.card,
      marginBottom: spacing.scale[2],
      cursor: 'pointer',
      color: theme.text.primary,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.body.fontSize,
      fontWeight: 400,
      textAlign: 'left',
    },
    textarea: {
      width: '100%',
      minHeight: 120,
      padding: r.cardPadding,
      backgroundColor: theme.bg.raised,
      border: `1px solid ${theme.line.hairline}`,
      borderRadius: radius.card,
      color: theme.text.primary,
      fontFamily: typography.body.fontFamily,
      fontSize: Number(typography.body.fontSize),
      lineHeight: '25px',
      resize: 'vertical',
      outline: 'none',
      boxSizing: 'border-box',
    },
    submitBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      minHeight: spacing.minTapTarget + 8,
      marginTop: spacing.scale[4],
      backgroundColor: theme.text.primary,
      color: theme.bg.base,
      border: 'none',
      borderRadius: radius.card,
      fontFamily: typography.body.fontFamily,
      fontSize: 17,
      fontWeight: 600,
      cursor: 'pointer',
    },
    successContainer: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      textAlign: 'center',
      padding: r.sectionGap,
    },
    successTitle: {
      ...r.heading,
      color: theme.text.primary,
      margin: `${spacing.scale[3]}px 0 0 0`,
      fontVariantNumeric: undefined,
    },
    successBody: {
      ...typography.body,
      color: theme.text.secondary,
      margin: `${spacing.scale[2]}px 0 0 0`,
      maxWidth: '40ch',
      fontVariantNumeric: undefined,
    },
    skipBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      minHeight: spacing.minTapTarget,
      marginTop: spacing.scale[2],
      background: 'none',
      color: theme.text.secondary,
      border: 'none',
      fontFamily: typography.body.fontFamily,
      fontSize: 15,
      cursor: 'pointer',
    },
    confirmText: {
      ...typography.body,
      color: theme.text.secondary,
      margin: `0 0 ${spacing.scale[4]}px 0`,
      fontVariantNumeric: undefined,
    },
    noteHint: {
      ...typography.meta,
      color: theme.text.faint,
      margin: `${spacing.scale[1]}px 0 0 0`,
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack} aria-label="Go back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke={theme.text.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h2 style={styles.headerTitle}>Report a hazard</h2>
      </div>

      <div style={styles.content}>
        {step === 'hazard' && (
          <>
            <h3 style={styles.stepTitle}>What are you seeing?</h3>
            {HAZARD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                style={styles.optionBtn}
                onClick={() => handleHazardSelect(opt.value)}
                aria-label={`Report ${opt.label}`}
              >
                {opt.label}
              </button>
            ))}
          </>
        )}

        {step === 'severity' && (
          <>
            <h3 style={styles.stepTitle}>How severe?</h3>
            {SEVERITY_OPTIONS.map((s) => (
              <button
                key={s}
                style={styles.optionBtn}
                onClick={() => handleSeveritySelect(s)}
                aria-label={`Severity: ${s}`}
              >
                <SeverityIndicator severity={s} />
              </button>
            ))}
          </>
        )}

        {step === 'confirm' && (
          <>
            <h3 style={styles.stepTitle}>Confirm your location</h3>
            <p style={styles.confirmText}>
              Your current location will be included with this report to help others nearby.
            </p>
            <button style={styles.submitBtn} onClick={handleConfirm}>
              Confirm location
            </button>
          </>
        )}

        {step === 'note' && (
          <>
            <h3 style={styles.stepTitle}>Add a note</h3>
            <textarea
              style={styles.textarea}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe what you see (optional)"
              maxLength={1000}
              aria-label="Optional note about the hazard"
            />
            <p style={styles.noteHint}>{note.length}/1000</p>
            <button style={styles.submitBtn} onClick={handleSubmit}>
              Submit report
            </button>
            <button style={styles.skipBtn} onClick={handleSubmit}>
              Skip and submit
            </button>
          </>
        )}

        {step === 'submitted' && (
          <div style={styles.successContainer}>
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <circle cx="32" cy="32" r="28" stroke={theme.accent.calm} strokeWidth="3" fill="none" />
              <path d="M22 33l7 7 13-13" stroke={theme.accent.calm} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            <h3 style={styles.successTitle}>
              {isOnline ? 'Report submitted' : 'Report queued'}
            </h3>
            <p style={styles.successBody}>
              {isOnline
                ? 'Your report has been received and will be reviewed.'
                : 'Queued \u2014 will send when you have signal.'}
            </p>
            <button style={{ ...styles.submitBtn, marginTop: r.sectionGap }} onClick={onBack}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
