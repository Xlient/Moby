import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useDeviceLocation } from '@/hooks/useDeviceLocation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RouteMap } from '@/components/route/RouteMap';
import { api, ApiRequestError } from '@/api/client';
import type { CheckedRoute, Place, RouteCheck, RouteHazard } from '@/api/types';
import { kv } from '@/lib/storage';
import { env } from '@/config/env';
import { useUserCenterPassive } from '@/location/UserLocationContext';
import { formatTimeAgo } from '@/lib/alerts';
import { distanceKm } from '@/lib/geo';
import {
  LIMITS, alternativeProblemCopy, cannotAvoidCopy, detourCost, formatDistance, formatDuration, googleMapsUrl,
  hazardLine, headlineFor, verdict,
} from '@/lib/routeCheck';

interface RouteCheckScreenProps {
  onBack: () => void;
  onAlertPress: (alertId: string) => void;
}

type Profile = RouteCheck['profile'];

interface Saved {
  check: RouteCheck;
  destination: Place;
  origin: { lat: number; lon: number };
  checkedAt: string;
}

const SAVED_KEY = 'last-route-check-v1';

function readSaved(): Saved | null {
  try {
    const raw = kv.get(SAVED_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function errorCopy(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const detail = (err.body as { detail?: string } | undefined)?.detail;
    if (err.status === 503) return 'Route checks aren’t available on this server yet.';
    if (err.status === 429) return 'Moby has reached today’s limit for route checks. Try again tomorrow.';
    if (detail === 'point_not_routable') return 'One of the points isn’t near a road or path.';
    if (detail === 'no_route') return 'Couldn’t find a road or path between these places.';
    if (detail === 'over_limits') return 'That trip is too long to check.';
  }
  return 'Couldn’t check the route. Check your connection and try again.';
}

/**
 * Check a route: does the way to somewhere cross a hazard Moby knows about? If it does,
 * a way around, from OpenRouteService with those areas avoided. Moby never says a route
 * is safe, only what it crosses among what Moby knows, and what that leaves out.
 */
export function RouteCheckScreen({ onBack, onAlertPress }: RouteCheckScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const online = useOnlineStatus();
  const { fix, status: locStatus } = useDeviceLocation(true);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [profile, setProfile] = useState<Profile>('driving-car');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(readSaved);

  // No fix yet: the last place the phone was seen (or the demo city with demo data).
  const lastSeen = useUserCenterPassive();
  const origin = fix
    ? { lat: fix.lat, lon: fix.lon }
    : lastSeen.source === 'device' || env.useMock
      ? { lat: lastSeen.lat, lon: lastSeen.lon }
      : null;

  async function search() {
    if (query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      setPlaces(await api.searchPlaces(query.trim(), origin ?? undefined));
    } catch (err) {
      setError(errorCopy(err));
    }
    setBusy(false);
  }

  async function check(to: Place, mode: Profile) {
    if (!origin) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.checkRoute({ origin, destination: { lat: to.lat, lon: to.lon }, profile: mode });
      const next = { check: result, destination: to, origin, checkedAt: new Date().toISOString() };
      setSaved(next);
      try {
        kv.set(SAVED_KEY, JSON.stringify(next));
      } catch {
        /* storage full: the result still shows */
      }
    } catch (err) {
      setError(errorCopy(err));
    }
    setBusy(false);
  }

  function pick(place: Place) {
    setDestination(place);
    setPlaces(null);
    setQuery(place.label);
    void check(place, profile);
  }

  function changeProfile(next: string) {
    setProfile(next as Profile);
    if (destination) void check(destination, next as Profile);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.bg.base }]}>
      <ScreenHeader title="Check a route" onBack={onBack} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: r.gutter, gap: spacing.scale[3], paddingBottom: spacing.scale[7] }}
      >
        <Text variant="bodyLarge" style={{ color: theme.text.secondary }}>
          See whether the way from here crosses an official warning area or a hazard people reported, and find a way around it.
        </Text>

        <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
          From:{' '}
          {fix
            ? 'where you are now'
            : origin
              ? 'where you were last seen'
              : locStatus === 'denied'
              ? 'Moby needs your location to check a route.'
              : 'finding where you are…'}
        </Text>

        <TextInput
          mode="outlined"
          label="Where to?"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void search()}
          returnKeyType="search"
          disabled={!online}
          right={<TextInput.Icon icon="magnify" onPress={() => void search()} accessibilityLabel="Search" />}
        />
        <SegmentedButtons
          value={profile}
          onValueChange={changeProfile}
          buttons={[
            { value: 'driving-car', label: 'Drive', icon: 'car' },
            { value: 'foot-hiking', label: 'Walk or hike', icon: 'hiking' },
          ]}
        />

        {!online && (
          <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
            Checking a route needs a connection. Your last check is below.
          </Text>
        )}
        {busy && <ActivityIndicator accessibilityLabel="Checking" />}
        {error && <Text variant="bodyMedium" style={{ color: theme.severity.high }}>{error}</Text>}

        {places && (
          <View style={[styles.box, { backgroundColor: theme.bg.raised }]}>
            {places.length === 0 ? (
              <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>No places found.</Text>
            ) : (
              places.map((p) => (
                <Pressable
                  key={`${p.lat},${p.lon}`}
                  onPress={() => pick(p)}
                  disabled={!origin}
                  accessibilityRole="button"
                  style={styles.place}
                >
                  <Text variant="bodyLarge" style={{ color: theme.text.primary }}>{p.label}</Text>
                  {origin && (
                    // Two places with the same name are told apart by how far they are.
                    <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
                      {formatDistance(distanceKm(origin.lat, origin.lon, p.lat, p.lon) * 1000)} away
                    </Text>
                  )}
                </Pressable>
              ))
            )}
          </View>
        )}

        {saved && !places && (
          <Result saved={saved} onAlertPress={onAlertPress} stale={!busy && !!destination && saved.destination.label !== destination.label} />
        )}

        <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
          Routes from OpenRouteService (© OpenStreetMap contributors). Only your search and the start and end points are sent to it.
        </Text>
      </ScrollView>
    </View>
  );
}

function Result({ saved, onAlertPress, stale }: { saved: Saved; onAlertPress: (id: string) => void; stale: boolean }) {
  const { theme } = useTheme();
  const { check } = saved;
  const v = verdict(check);
  const follow: CheckedRoute | null = v === 'around' ? check.alternative ?? null : v === 'clear' ? check.route : null;
  const tone = v === 'clear' ? theme.accent.calm : v === 'around' ? theme.severity.medium : theme.severity.high;
  const problem = alternativeProblemCopy(check.alternative_problem);

  return (
    <View style={{ gap: spacing.scale[3], opacity: stale ? 0.5 : 1 }}>
      <View style={[styles.verdict, { backgroundColor: theme.bg.raised, borderLeftColor: tone }]} accessibilityLiveRegion="polite">
        <Text variant="titleLarge" style={{ color: theme.text.primary }}>{headlineFor(v, check.route.hazards.length)}</Text>
        <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
          To {saved.destination.label} · checked {formatTimeAgo(saved.checkedAt)}
        </Text>
      </View>

      <RouteMap check={check} />

      <RouteSummary label={check.alternative ? 'Usual route' : 'Route'} route={check.route} />
      {check.route.hazards.map((h) => (
        <HazardRow key={h.event_id} hazard={h} onPress={() => onAlertPress(h.alert_id)} />
      ))}

      {check.alternative && (
        <>
          <RouteSummary label="Way around" route={check.alternative} extra={detourCost(check.route, check.alternative)} />
          {check.alternative.hazards.length > 0 ? (
            <>
              <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>The way around still crosses:</Text>
              {check.alternative.hazards.map((h) => (
                <HazardRow key={h.event_id} hazard={h} onPress={() => onAlertPress(h.alert_id)} />
              ))}
            </>
          ) : (
            <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>It crosses no hazard Moby knows about.</Text>
          )}
        </>
      )}
      {problem && <Text variant="bodyMedium" style={{ color: theme.text.primary }}>{problem}</Text>}

      {follow && (
        <View style={{ gap: spacing.scale[1] }}>
          <Button
            mode="contained"
            icon="navigation-variant"
            onPress={() => Linking.openURL(googleMapsUrl(follow, saved.origin, saved.destination, check.profile)).catch(() => {})}
          >
            {v === 'around' ? 'Navigate the way around' : 'Navigate'}
          </Button>
          <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
            Opens Google Maps with points along this route. Between them, Google picks its own roads.
          </Text>
        </View>
      )}

      <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>{LIMITS}</Text>
    </View>
  );
}

function RouteSummary({ label, route, extra }: { label: string; route: CheckedRoute; extra?: string }) {
  const { theme } = useTheme();
  return (
    <Text variant="titleMedium" style={{ color: theme.text.primary }}>
      {label}: {formatDistance(route.distance_m)}, {formatDuration(route.duration_s)}
      {extra ? <Text variant="bodyMedium" style={{ color: theme.text.secondary }}> ({extra})</Text> : null}
    </Text>
  );
}

function HazardRow({ hazard, onPress }: { hazard: RouteHazard; onPress: () => void }) {
  const { theme } = useTheme();
  const trust = hazard.verification === 'official' ? theme.trust.official : theme.trust.unverified;
  const cannot = cannotAvoidCopy(hazard);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Opens the alert"
      style={[styles.hazard, { backgroundColor: theme.bg.raised, borderLeftColor: theme.severity[hazard.severity] }]}
    >
      <Text variant="bodyLarge" style={{ color: theme.text.primary }}>{hazardLine(hazard)}</Text>
      <Text variant="bodySmall" style={{ color: trust.text }}>
        {hazard.verification === 'official' ? 'Official warning' : 'Unverified · reported by people nearby'}
      </Text>
      {cannot && <Text variant="bodySmall" style={{ color: theme.text.secondary }}>{cannot}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  box: { borderRadius: radius.card, paddingVertical: spacing.scale[1] },
  place: { paddingHorizontal: spacing.scale[3], paddingVertical: spacing.scale[3], minHeight: spacing.minTapTarget },
  verdict: { borderLeftWidth: 4, borderRadius: radius.card, padding: spacing.scale[3], gap: spacing.scale[1] },
  hazard: { borderLeftWidth: 4, borderRadius: radius.card, padding: spacing.scale[3], gap: 2 },
});
