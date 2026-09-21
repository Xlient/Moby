import { Surface, Chip, Text } from 'react-native-paper';
import { View, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, radius } from '@/theme/tokens';
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
      return alert.source_attribution ?? 'Confirmed by nearby reports';
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
          backgroundColor: theme.bg.recessed,
          borderRadius: radius.pill,
        }}
        textStyle={{
          color: theme.text.primary,
          fontWeight: '500',
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
          borderColor: theme.line.hairline,
          borderRadius: radius.pill,
        }}
        textStyle={{
          color: theme.text.secondary,
          fontWeight: '500',
        }}
        compact
      >
        {trustText}
      </Chip>
    );
  }

  return (
    <Text
      variant="labelSmall"
      style={{ color: theme.text.secondary }}
    >
      {trustText}
    </Text>
  );
}

export function AlertCard({ alert, distanceKm, onPress }: AlertCardProps) {
  const { theme } = useTheme();
  const severityColor = theme.severity[alert.severity];
  const surfaceConfig = getSurfaceConfig(alert.verification_label, theme);
  const isUnverified = alert.verification_label === 'unverified_report';
  const showLeftEdge = !isUnverified;
  const leftEdgeOpacity = alert.verification_label === 'corroborated_report' ? 0.5 : 1;

  const metaParts: string[] = [];
  if (alert.location_name) metaParts.push(alert.location_name);
  if (distanceKm !== undefined) metaParts.push(`${distanceKm.toFixed(1)} km`);
  metaParts.push(formatTimeAgo(alert.issued_at));
  const metaText = metaParts.join(' \u00b7 ');

  const card = (
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
        <SeverityIndicator severity={alert.severity} neutral={isUnverified} />

        <Text
          variant="titleMedium"
          style={{
            color: theme.text.primary,
            marginTop: spacing.scale[1],
          }}
          numberOfLines={2}
        >
          {alert.headline}
        </Text>

        <Text
          variant="bodyMedium"
          style={{
            color: theme.text.secondary,
            fontVariant: ['tabular-nums'],
            marginTop: spacing.scale[1],
          }}
          numberOfLines={1}
        >
          {metaText}
        </Text>

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

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${alert.headline}, ${alert.severity} severity`}
      >
        {card}
      </Pressable>
    );
  }

  return card;
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
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.scale[2],
  },
});
