import { Surface, Chip, Text } from 'react-native-paper';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { SeverityIndicator } from './SeverityIndicator';
import type { Alert, VerificationLabel } from '@/api/types';

interface AlertCardProps {
  alert: Alert;
  distanceKm?: number;
  onPress?: () => void;
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getTrustText(alert: Alert): string {
  switch (alert.verification_label) {
    case 'official_confirmed':
      return alert.source_attribution ?? 'Official source';
    case 'corroborated_report':
      return alert.source_attribution ?? 'Confirmed by 4 nearby';
    case 'unverified_report':
      return 'Unverified \u2014 single report';
  }
}

function getSurfaceConfig(
  verification: VerificationLabel,
  theme: ReturnType<typeof useTheme>['theme'],
): { elevation: 0 | 1; backgroundColor: string; borderWidth: number; borderColor: string } {
  if (verification === 'unverified_report') {
    return {
      elevation: 0,
      backgroundColor: theme.bg.recessed,
      borderWidth: 1,
      borderColor: theme.line.hairline,
    };
  }
  return {
    elevation: 1,
    backgroundColor: theme.bg.raised,
    borderWidth: 0,
    borderColor: 'transparent',
  };
}

function hasLeftEdge(verification: VerificationLabel): boolean {
  return verification !== 'unverified_report';
}

function getLeftEdgeOpacity(verification: VerificationLabel): number {
  return verification === 'corroborated_report' ? 0.5 : 1;
}

function TrustDisplay({
  verification,
  alert,
  theme,
}: {
  verification: VerificationLabel;
  alert: Alert;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  const trustText = getTrustText(alert);

  if (verification === 'official_confirmed') {
    return (
      <Chip
        mode="flat"
        style={{
          backgroundColor: theme.text.primary,
          borderRadius: radius.pill,
        }}
        textStyle={{
          color: theme.bg.raised,
          fontSize: typography.label.fontSize,
          lineHeight: typography.label.lineHeight,
          fontWeight: String(typography.label.fontWeight) as '500',
          fontVariant: ['tabular-nums'],
        }}
        compact
      >
        {trustText}
      </Chip>
    );
  }

  if (verification === 'corroborated_report') {
    return (
      <Chip
        mode="outlined"
        style={{
          backgroundColor: 'transparent',
          borderColor: theme.text.secondary,
          borderRadius: radius.pill,
        }}
        textStyle={{
          color: theme.text.secondary,
          fontSize: typography.label.fontSize,
          lineHeight: typography.label.lineHeight,
          fontWeight: String(typography.label.fontWeight) as '500',
          fontVariant: ['tabular-nums'],
        }}
        compact
      >
        {trustText}
      </Chip>
    );
  }

  return (
    <Text
      style={{
        color: theme.text.secondary,
        fontSize: typography.label.fontSize,
        lineHeight: typography.label.lineHeight,
        fontWeight: String(typography.label.fontWeight) as '500',
      }}
    >
      {trustText}
    </Text>
  );
}

export function AlertCard({ alert, distanceKm }: AlertCardProps) {
  const { theme } = useTheme();
  const severityColor = theme.severity[alert.severity];
  const surfaceConfig = getSurfaceConfig(alert.verification_label, theme);
  const showLeftEdge = hasLeftEdge(alert.verification_label);
  const leftEdgeOpacity = getLeftEdgeOpacity(alert.verification_label);

  return (
    <Surface
      elevation={surfaceConfig.elevation}
      style={[
        styles.surface,
        {
          backgroundColor: surfaceConfig.backgroundColor,
          borderWidth: surfaceConfig.borderWidth,
          borderColor: surfaceConfig.borderColor,
          borderRadius: radius.card,
        },
      ]}
    >
      {showLeftEdge && (
        <View
          style={[
            styles.leftEdge,
            {
              backgroundColor: severityColor,
              opacity: leftEdgeOpacity,
              borderTopLeftRadius: radius.card,
              borderBottomLeftRadius: radius.card,
            },
          ]}
        />
      )}

      <View
        style={[
          styles.content,
          { paddingLeft: showLeftEdge ? spacing.scale[3] + 3 : spacing.scale[3] },
        ]}
      >
        <SeverityIndicator severity={alert.severity} />

        <Text
          style={{
            color: theme.text.primary,
            fontSize: typography.heading.fontSize,
            lineHeight: typography.heading.lineHeight,
            fontWeight: String(typography.heading.fontWeight) as '600',
            marginTop: spacing.scale[1],
          }}
          numberOfLines={3}
        >
          {alert.headline}
        </Text>

        <View style={styles.metaRow}>
          {alert.source_attribution && (
            <Text
              style={{
                color: theme.text.secondary,
                fontSize: typography.meta.fontSize,
                lineHeight: typography.meta.lineHeight,
                fontVariant: ['tabular-nums'],
              }}
            >
              {alert.source_attribution}
            </Text>
          )}
          {distanceKm !== undefined && (
            <Text
              style={{
                color: theme.text.secondary,
                fontSize: typography.meta.fontSize,
                lineHeight: typography.meta.lineHeight,
                fontVariant: ['tabular-nums'],
              }}
            >
              {distanceKm.toFixed(1)} km
            </Text>
          )}
          <Text
            style={{
              color: theme.text.secondary,
              fontSize: typography.meta.fontSize,
              lineHeight: typography.meta.lineHeight,
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatTimeAgo(alert.issued_at)}
          </Text>
        </View>

        <View style={styles.trustRow}>
          <TrustDisplay
            verification={alert.verification_label}
            alert={alert}
            theme={theme}
          />
        </View>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
    position: 'relative',
  },
  leftEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  content: {
    padding: spacing.scale[2],
    paddingRight: spacing.scale[3],
    paddingBottom: spacing.scale[3],
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.scale[2],
    marginTop: spacing.scale[2],
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.scale[2],
  },
});
