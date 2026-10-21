import { useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Button, Icon, IconButton, Text } from 'react-native-paper';
import { useMutation } from '@tanstack/react-query';
import { api, ApiRequestError } from '@/api/client';
import type { GuidanceCard as GuidanceCardType, HazardType, TripBrief, TripClaim } from '@/api/types';
import { AlertCard } from '@/components/AlertCard';
import { EmergencyNumbers } from '@/components/EmergencyNumbers';
import { GuidanceCard } from '@/components/GuidanceCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { countryAt, emergencyFor } from '@/data/emergencyNumbers';
import { countryName, searchPlaces, type TripPlace } from '@/data/tripPlaces';
import { useGuidance } from '@/guidance/guidanceStore';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResponsive } from '@/hooks/useResponsive';
import { formatTimeAgo } from '@/lib/alerts';
import { distanceKm } from '@/lib/geo';
import { formatDistance } from '@/lib/routeCheck';
import { useUserCenter } from '@/location/UserLocationContext';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing, typography } from '@/theme/tokens';
import { deleteTripPack, saveTripPack, useTripPacks, type TripPack } from '@/trips/tripPacks';

// "Before you go" (POST /v1/trips/brief): pick a destination, get the official alerts and
// recent community reports there with Nemotron Ultra's cited explanation, and save it all
// on the phone with the emergency numbers and matching guidance, for when signal runs out.

const RADII = [10, 25, 50, 100] as const;
const MAX_STOPS = 8;
const MAX_DAYS = 30;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// The web build's map is a drawn diagram with no long-press.
const CAN_DROP_PIN = Platform.OS !== 'web';

interface Destination {
  lat: number;
  lon: number;
  label: string;
  /** Sent to the server only when it came from Moby's place list. */
  placeName?: string;
  country?: string;
}

/** One place, or a route through stops in order. */
type Trip = { kind: 'place'; dest: Destination } | { kind: 'route'; stops: Destination[] };

function tripLabel(t: Trip): string {
  return t.kind === 'place' ? t.dest.label : t.stops.map((s) => s.placeName ?? s.label).join(' → ');
}

interface TripBriefScreenProps {
  onBack: () => void;
  /** A point long-pressed on the map. */
  initialPoint?: { lat: number; lon: number };
  onAlertPress?: (alertId: string) => void;
}

// Dates by hand: Hermes' Intl support varies by Android build.
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function showDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function pinLabel(lat: number, lon: number): string {
  const country = countryName(countryAt(lat, lon));
  return country ? `Dropped pin in ${country}` : 'Dropped pin';
}

function placeLabel(p: TripPlace): string {
  return `${p.name}, ${countryName(p.country) ?? p.country}`;
}

/** Guidance for the hazards found; the critical essentials when nothing was found. */
function guidanceFor(cards: GuidanceCardType[], hazards: HazardType[]): GuidanceCardType[] {
  if (!hazards.length) return cards.filter((c) => c.is_critical_fallback).slice(0, 3);
  return hazards.flatMap((h) => cards.filter((c) => c.hazard_type === h).slice(0, 3));
}

export function TripBriefScreen({ onBack, initialPoint, onAlertPress }: TripBriefScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const isOnline = useOnlineStatus();
  const center = useUserCenter();
  const packs = useTripPacks();
  const guidance = useGuidance();

  const [query, setQuery] = useState('');
  const [dest, setDest] = useState<Destination | null>(
    initialPoint
      ? { ...initialPoint, label: pinLabel(initialPoint.lat, initialPoint.lon), country: countryAt(initialPoint.lat, initialPoint.lon) }
      : null,
  );
  const [mode, setMode] = useState<'place' | 'route'>('place');
  const [stops, setStops] = useState<Destination[]>([]);
  const [radiusKm, setRadiusKm] = useState<(typeof RADII)[number]>(25);
  const today = useMemo(() => new Date(), []);
  const [startOffset, setStartOffset] = useState(0);
  const [days, setDays] = useState(3);
  const [openPack, setOpenPack] = useState<TripPack | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  const startDate = isoDay(addDays(today, startOffset));
  const endDate = isoDay(addDays(today, startOffset + days));
  const matches = useMemo(() => searchPlaces(query), [query]);
  const trip: Trip | null =
    mode === 'place' ? (dest ? { kind: 'place', dest } : null) : stops.length >= 2 ? { kind: 'route', stops } : null;
  const [asked, setAsked] = useState<Trip | null>(null);

  function pick(d: Destination) {
    setQuery('');
    if (mode === 'place') return setDest(d);
    // A route: append, but not the same place twice in a row.
    setStops((ss) => (ss.length && ss[ss.length - 1]!.lat === d.lat && ss[ss.length - 1]!.lon === d.lon ? ss : [...ss, d]));
  }

  const brief = useMutation({
    mutationFn: (t: Trip) => {
      setAsked(t);
      const when = { radius_km: radiusKm, start_date: startDate, end_date: endDate };
      if (t.kind === 'route') {
        const country = t.stops.find((s) => s.country)?.country;
        return api.tripBrief({
          ...when,
          stops: t.stops.map((s) => ({ lat: s.lat, lon: s.lon, ...(s.placeName ? { name: s.placeName } : {}) })),
          ...(country ? { country } : {}),
        });
      }
      const d = t.dest;
      return api.tripBrief({
        ...when,
        lat: d.lat,
        lon: d.lon,
        ...(d.country ? { country: d.country } : {}),
        ...(d.placeName ? { place_name: d.placeName } : {}),
      });
    },
    onSuccess: () => {
      setSavedId(null);
      scroll.current?.scrollTo({ y: 0, animated: false });
    },
  });

  const result = brief.data;

  const askedLabel = asked ? tripLabel(asked) : undefined;
  const askedCountry = asked?.kind === 'place' ? asked.dest.country : asked?.stops.find((s) => s.country)?.country;

  function save(b: TripBrief) {
    const country = b.destination.country ?? askedCountry;
    const pack = saveTripPack({
      label: askedLabel ?? b.destination.place_name ?? pinLabel(b.destination.lat, b.destination.lon),
      brief: b,
      emergency: emergencyFor(country),
      guidance: guidanceFor(guidance.cards, b.hazards),
    });
    setSavedId(pack.id);
  }

  // ── A saved pack (works with no signal) ─────────────────────────────
  if (openPack) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="Trip pack" onBack={() => setOpenPack(null)} />
        <ScrollView contentContainerStyle={{ padding: r.gutter, paddingBottom: r.sectionGap, gap: spacing.scale[4] }}>
          <View
            style={[styles.staleBanner, { backgroundColor: theme.bg.recessed, borderColor: theme.line.hairline }]}
            accessibilityRole="alert"
          >
            <Icon source="clock-alert-outline" size={20} color={theme.text.primary} />
            <Text variant="bodyMedium" style={[styles.flex, { color: theme.text.primary }]}>
              Saved {formatTimeAgo(openPack.savedAt)} · may be out of date.{' '}
              {isOnline ? 'Get a fresh briefing before you set off.' : 'You’re offline: this can’t show anything newer.'}
            </Text>
          </View>
          <BriefView
            brief={openPack.brief}
            label={openPack.label}
            emergency={openPack.emergency}
            guidance={openPack.guidance}
            onAlertPress={isOnline ? onAlertPress : undefined}
            isOnline={isOnline}
          />
          <Button
            mode="text"
            icon="delete-outline"
            textColor={theme.text.secondary}
            onPress={() => {
              deleteTripPack(openPack.id);
              setOpenPack(null);
            }}
            contentStyle={styles.tapTarget}
          >
            Delete this pack
          </Button>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Before you go" onBack={onBack} />
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ padding: r.gutter, paddingBottom: r.sectionGap, gap: spacing.scale[4] }}
        keyboardShouldPersistTaps="handled"
      >
        {!result && (
          <>
            <Text variant="bodyLarge" style={{ color: theme.text.secondary }}>
              Check a destination while you still have signal. Moby lists the official alerts and recent reports
              there, explains why they matter for your trip, and saves it on your phone with the emergency numbers
              and safety guidance.
            </Text>

            {!isOnline && (
              <Text variant="bodyMedium" style={{ color: theme.text.primary }} accessibilityRole="alert">
                You’re offline. A new briefing needs a connection; your saved trip packs below still open.
              </Text>
            )}

            <Section title="Where are you going?">
              <Options
                label="Trip type"
                options={['place', 'route'] as const}
                selected={mode}
                format={(m) => (m === 'place' ? 'One place' : 'A route')}
                onSelect={setMode}
              />
              {mode === 'place' && dest ? (
                <View style={[styles.picked, { backgroundColor: theme.bg.raised }]}>
                  <Icon source="map-marker-outline" size={22} color={theme.text.primary} />
                  <View style={styles.flex}>
                    <Text variant="titleMedium" style={{ color: theme.text.primary }}>{dest.label}</Text>
                    <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
                      Point used: {dest.lat.toFixed(2)}, {dest.lon.toFixed(2)}
                    </Text>
                  </View>
                  <Button mode="text" onPress={() => setDest(null)} contentStyle={styles.tapTarget}>
                    Change
                  </Button>
                </View>
              ) : (
                <>
                  {mode === 'route' && (
                    <>
                      <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
                        Add the places you’ll pass, in order (at least 2). Moby checks straight lines between them,
                        so add stops where the trail bends.
                      </Text>
                      {stops.map((st, i) => (
                        <View key={`${i}-${st.lat}-${st.lon}`} style={[styles.picked, { backgroundColor: theme.bg.raised }]}>
                          <Text variant="titleSmall" style={[styles.stopNo, { color: theme.text.secondary }]}>{i + 1}</Text>
                          <Text variant="titleMedium" style={[styles.flex, { color: theme.text.primary }]}>{st.label}</Text>
                          <IconButton
                            icon="close"
                            onPress={() => setStops((ss) => ss.filter((_, j) => j !== i))}
                            accessibilityLabel={`Remove stop ${i + 1}, ${st.label}`}
                          />
                        </View>
                      ))}
                    </>
                  )}
                  {(mode === 'place' || stops.length < MAX_STOPS) && (
                    <PlaceSearch
                      query={query}
                      setQuery={setQuery}
                      matches={matches}
                      onPick={pick}
                      label={mode === 'route' ? (stops.length ? 'Add the next stop' : 'Add the first stop') : undefined}
                      here={
                        center.source === 'device'
                          ? { lat: center.lat, lon: center.lon, label: 'Where you are now', country: countryAt(center.lat, center.lon) }
                          : undefined
                      }
                      near={{ lat: center.lat, lon: center.lon }}
                      tip={mode === 'place' && CAN_DROP_PIN}
                    />
                  )}
                </>
              )}
            </Section>

            <Section title={mode === 'route' ? 'How far either side of the route?' : 'How far around it?'}>
              <Options
                label="Radius"
                options={RADII}
                selected={radiusKm}
                format={(km) => `${km} km`}
                onSelect={setRadiusKm}
              />
            </Section>

            <Section title="When?">
              <Stepper
                label="Starts"
                value={showDay(startDate)}
                onMinus={startOffset > 0 ? () => setStartOffset((n) => n - 1) : undefined}
                onPlus={startOffset < 365 ? () => setStartOffset((n) => n + 1) : undefined}
              />
              <Stepper
                label="For"
                value={`${days} day${days === 1 ? '' : 's'} (until ${showDay(endDate)})`}
                onMinus={days > 0 ? () => setDays((n) => n - 1) : undefined}
                onPlus={days < MAX_DAYS ? () => setDays((n) => n + 1) : undefined}
              />
            </Section>

            <Button
              mode="contained"
              icon="shield-search"
              disabled={!trip || !isOnline || brief.isPending}
              loading={brief.isPending}
              onPress={() => trip && brief.mutate(trip)}
              contentStyle={styles.tapTarget}
            >
              Get briefing
            </Button>
            {brief.isPending && (
              <Text variant="bodyMedium" style={{ color: theme.text.secondary }} accessibilityLiveRegion="polite">
                Checking official alerts and reports {trip?.kind === 'route' ? 'along' : 'around'} {trip && tripLabel(trip)}. Nemotron Ultra can take up to a minute to
                explain them.
              </Text>
            )}
            {brief.isError && (
              <Text variant="bodyMedium" style={{ color: theme.text.primary }} accessibilityRole="alert">
                {brief.error instanceof ApiRequestError && brief.error.status === 429
                  ? 'You’ve asked for a lot of briefings this hour. Please try again later.'
                  : brief.error instanceof ApiRequestError && brief.error.status === 401
                    ? 'Sign in to get a briefing.'
                    : 'Couldn’t reach Moby. Check your connection and try again.'}
              </Text>
            )}

            <Section title="Saved trip packs">
              {packs.length === 0 ? (
                <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
                  Packs you save open here with no signal, with the emergency numbers and safety guidance.
                </Text>
              ) : (
                packs.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => setOpenPack(p)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open trip pack ${p.label}, saved ${formatTimeAgo(p.savedAt)}, may be out of date`}
                    style={[styles.match, styles.packRow, { backgroundColor: theme.bg.raised }]}
                  >
                    <Icon source="bag-personal-outline" size={22} color={theme.text.primary} />
                    <View style={styles.flex}>
                      <Text variant="titleSmall" style={{ color: theme.text.primary }}>{p.label}</Text>
                      <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
                        {showDay(p.brief.trip.start_date)} to {showDay(p.brief.trip.end_date)} · Saved{' '}
                        {formatTimeAgo(p.savedAt)} · may be out of date
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
            </Section>
          </>
        )}

        {result && (
          <>
            <BriefView
              brief={result}
              label={askedLabel ?? result.destination.place_name ?? 'Your destination'}
              emergency={emergencyFor(result.destination.country ?? askedCountry)}
              guidance={guidanceFor(guidance.cards, result.hazards)}
              onAlertPress={onAlertPress}
              isOnline={isOnline}
            />
            <View style={styles.actions}>
              <Button
                mode="contained"
                icon={savedId ? 'check' : 'download-outline'}
                onPress={() => save(result)}
                disabled={!!savedId}
                contentStyle={styles.tapTarget}
              >
                {savedId ? 'Saved for offline' : 'Save for offline'}
              </Button>
              <Button mode="text" onPress={() => brief.reset()} contentStyle={styles.tapTarget}>
                Brief another place
              </Button>
            </View>
            {savedId && (
              <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
                Saved on this phone. Open it from Before you go, even with no signal. It won’t update itself.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── The briefing (fresh or saved) ─────────────────────────────────────

const AI_FALLBACK: Record<string, string> = {
  over_cap: 'Moby has written all the AI explanations it can for today. Everything below is the plain list from '
    + 'official feeds and reports, not written by AI.',
  unavailable: 'Moby’s AI explanation isn’t available right now. Everything below is the plain list from official '
    + 'feeds and reports, not written by AI.',
  withheld: 'Moby’s AI explanation was withheld because it couldn’t be checked against the sources. The list below '
    + 'is complete.',
  nothing_to_explain: 'Nothing to explain: Moby found no active official alerts or recent reports in this area.',
};

function BriefView({
  brief,
  label,
  emergency,
  guidance,
  onAlertPress,
  isOnline,
}: {
  brief: TripBrief;
  label: string;
  emergency: ReturnType<typeof emergencyFor>;
  guidance: GuidanceCardType[];
  onAlertPress?: (alertId: string) => void;
  isOnline: boolean;
}) {
  const { theme } = useTheme();
  const { destination: d, trip } = brief;
  const titles: Record<string, string> = {};
  brief.official_alerts.forEach((a) => (titles[a.cite_id] = a.headline));
  brief.community_reports.forEach((a) => (titles[a.cite_id] = a.headline));
  brief.web_sources.forEach((w) => (titles[w.cite_id] = w.title));

  return (
    <View style={{ gap: spacing.scale[4] }}>
      <View>
        <Text variant="headlineSmall" accessibilityRole="header" style={{ color: theme.text.primary }}>{label}</Text>
        <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
          {brief.route ? `Within ${d.radius_km} km of the route (${brief.route.length_km} km)` : `Within ${d.radius_km} km`}
          {' · '}{showDay(trip.start_date)} to {showDay(trip.end_date)} · checked{' '}
          {formatTimeAgo(brief.generated_at)}
        </Text>
      </View>

      <Section title="Why it matters for your trip">
        <View style={[styles.card, { backgroundColor: theme.bg.raised }]}>
          {brief.explanation ? (
            <>
              {brief.explanation.claims.map((c, i) => (
                <ClaimRow key={i} claim={c} titles={titles} />
              ))}
              <Text variant="bodySmall" style={{ color: theme.text.faint }}>
                Explained by Moby AI · NVIDIA Nemotron Ultra. Each statement was checked against the sources it
                cites{brief.ai_status === 'partial' ? '; some that weren’t backed by them were removed' : ''}
                {brief.searched_web ? '. Official websites searched with Tavily' : ''}. Follow official instructions
                if they differ.
              </Text>
            </>
          ) : (
            <Text variant="bodyMedium" style={{ color: theme.text.primary }}>
              {AI_FALLBACK[brief.ai_status] ?? AI_FALLBACK.unavailable}
            </Text>
          )}
        </View>
      </Section>

      <Section title={`Official alerts (${brief.official_alerts.length})`}>
        {brief.official_alerts.length === 0 ? (
          <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
            No active official alerts within {d.radius_km} km right now.
          </Text>
        ) : (
          brief.official_alerts.map((a) => (
            <View key={a.alert_id} style={{ gap: spacing.scale[1] }}>
              <Text variant="labelMedium" style={{ color: theme.text.secondary }}>
                {a.cite_id}
                {a.near_stop ? ` · near ${a.near_stop}` : ''}
                {a.ends_before_trip ? ' · ends before your trip starts' : ''}
              </Text>
              <AlertCard
                alert={a}
                distanceKm={a.distance_km}
                onPress={onAlertPress ? () => onAlertPress(a.alert_id) : undefined}
              />
            </View>
          ))
        )}
      </Section>

      <Section title={`Reports from people nearby (${brief.community_reports.length})`}>
        <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
          Unverified: no official source has confirmed these. Last 72 hours.
        </Text>
        {brief.community_reports.length === 0 ? (
          <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
            No recent reports from people within {d.radius_km} km.
          </Text>
        ) : (
          brief.community_reports.map((a) => (
            <View key={a.alert_id} style={{ gap: spacing.scale[1] }}>
              <Text variant="labelMedium" style={{ color: theme.text.secondary }}>
                {a.cite_id}{a.near_stop ? ` · near ${a.near_stop}` : ''} · {a.reporter_count}{' '}
                {a.reporter_count === 1 ? 'person' : 'people'} · last report{' '}
                {formatTimeAgo(a.last_report_at)}
              </Text>
              <AlertCard alert={a} distanceKm={a.distance_km} />
            </View>
          ))
        )}
      </Section>

      {brief.web_sources.length > 0 && (
        <Section title="Official websites">
          {brief.web_sources.map((w) => (
            <Text
              key={w.cite_id}
              variant="bodyMedium"
              style={{ color: isOnline ? theme.text.primary : theme.text.secondary }}
              onPress={isOnline ? () => Linking.openURL(w.url) : undefined}
              accessibilityRole={isOnline ? 'link' : undefined}
            >
              {w.cite_id} · {w.title} · {w.publisher}
            </Text>
          ))}
        </Section>
      )}

      <Section title="What this can’t tell you">
        <View style={[styles.card, { backgroundColor: theme.bg.recessed }]}>
          {brief.uncertainty.map((u, i) => (
            <View key={i} style={styles.bullet}>
              <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>•</Text>
              <Text variant="bodyMedium" style={[styles.flex, { color: theme.text.primary }]}>{u}</Text>
            </View>
          ))}
        </View>
      </Section>

      <EmergencyNumbers country={d.country} numbers={emergency} />

      {guidance.length > 0 && (
        <Section title="Safety guidance">
          {guidance.map((c) => (
            <GuidanceCard key={c.card_id} card={c} compact />
          ))}
        </Section>
      )}
    </View>
  );
}

function ClaimRow({ claim, titles }: { claim: TripClaim; titles: Record<string, string> }) {
  const { theme } = useTheme();
  const community = claim.basis === 'community';
  const c = community ? theme.trust.unverified : theme.trust.official;
  return (
    <View style={{ gap: spacing.scale[1] }}>
      {community && (
        // A statement resting on community reports is never shown as an agency's.
        <View style={[styles.basis, { backgroundColor: c.bg, borderColor: c.border }]}>
          <Icon source="help-circle-outline" size={14} color={c.text} />
          <Text variant="labelSmall" style={{ color: c.text, fontWeight: '600' }}>From unverified reports</Text>
        </View>
      )}
      <Text variant="bodyMedium" style={{ color: theme.text.primary }}>{claim.text}</Text>
      <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
        Source: {claim.cites.map((id) => `${id} ${titles[id] ?? ''}`.trim()).join('; ')}
      </Text>
    </View>
  );
}

// ── Small pieces ──────────────────────────────────────────────────────

/**
 * Search Moby's bundled place list (no geocoder sees the text), or use where the phone is.
 * Only when the list has nothing, and the person asks, the text goes to the same place
 * search Check a route uses (OpenRouteService).
 */
function PlaceSearch({
  query,
  setQuery,
  matches,
  onPick,
  label,
  here,
  near,
  tip,
}: {
  query: string;
  setQuery: (q: string) => void;
  matches: TripPlace[];
  onPick: (d: Destination) => void;
  label?: string;
  here?: Destination;
  /** Where to rank online results around. */
  near: { lat: number; lon: number };
  tip: boolean;
}) {
  const { theme } = useTheme();
  const isOnline = useOnlineStatus();
  const online = useMutation({ mutationFn: (q: string) => api.searchPlaces(q, near) });
  const onlineFor = online.variables === query.trim() ? online : null;
  const notListed = query.trim().length >= 2 && matches.length === 0;
  return (
    <>
      {label && <Text variant="labelLarge" style={{ color: theme.text.primary }}>{label}</Text>}
      <TextInput
        style={[
          typography.body,
          styles.input,
          { backgroundColor: theme.bg.recessed, borderColor: theme.line.hairline, color: theme.text.primary },
        ]}
        placeholder="Search a place, e.g. Phakding or Pokhara"
        placeholderTextColor={theme.text.faint}
        value={query}
        onChangeText={setQuery}
        accessibilityLabel={label ?? 'Search a destination'}
        autoCorrect={false}
        maxLength={60}
      />
      {matches.map((p) => (
        <Pressable
          key={`${p.name}-${p.country}`}
          onPress={() => onPick({ lat: p.lat, lon: p.lon, label: placeLabel(p), placeName: p.name, country: p.country })}
          accessibilityRole="button"
          accessibilityLabel={`${p.name}, ${p.area}, ${countryName(p.country)}`}
          style={[styles.match, { backgroundColor: theme.bg.raised }]}
        >
          <Text variant="titleSmall" style={{ color: theme.text.primary }}>{p.name}</Text>
          <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
            {p.area}, {countryName(p.country)}
          </Text>
        </Pressable>
      ))}
      {notListed && (
        <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
          Not in Moby’s list of destinations.{' '}
          {CAN_DROP_PIN ? 'Use your location, or long-press the map to drop a pin.' : 'Try a nearby town, or use your location.'}
        </Text>
      )}
      {notListed && isOnline && !onlineFor?.data && (
        <>
          <Button
            mode="outlined"
            icon="magnify"
            onPress={() => online.mutate(query.trim())}
            loading={onlineFor?.isPending}
            disabled={onlineFor?.isPending}
            style={styles.alignStart}
            contentStyle={styles.tapTarget}
          >
            Search online
          </Button>
          <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
            {onlineFor?.isError
              ? 'Couldn’t search just now. Try again, or use your location.'
              : 'Sends only what you typed to OpenRouteService (© OpenStreetMap contributors).'}
          </Text>
        </>
      )}
      {notListed && onlineFor?.data?.length === 0 && (
        <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>No places found online either.</Text>
      )}
      {notListed &&
        onlineFor?.data?.map((p) => (
          <Pressable
            key={`${p.lat},${p.lon}`}
            onPress={() =>
              onPick({
                lat: p.lat,
                lon: p.lon,
                label: p.label,
                placeName: p.label.split(',')[0]!.trim(),
                country: countryAt(p.lat, p.lon),
              })
            }
            accessibilityRole="button"
            accessibilityLabel={p.label}
            style={[styles.match, { backgroundColor: theme.bg.raised }]}
          >
            <Text variant="titleSmall" style={{ color: theme.text.primary }}>{p.label}</Text>
            <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
              {formatDistance(distanceKm(near.lat, near.lon, p.lat, p.lon) * 1000)} away
            </Text>
          </Pressable>
        ))}
      {here && (
        <Button
          mode="outlined"
          icon="crosshairs-gps"
          onPress={() => onPick(here)}
          style={styles.alignStart}
          contentStyle={styles.tapTarget}
        >
          Use my location
        </Button>
      )}
      {tip && (
        <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
          Tip: long-press anywhere on the map to brief that spot.
        </Text>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: spacing.scale[2] }}>
      <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.text.primary }}>{title}</Text>
      {children}
    </View>
  );
}

function Options<T extends number | string>({
  label,
  options,
  selected,
  format,
  onSelect,
}: {
  label: string;
  options: readonly T[];
  selected: T;
  format: (o: T) => string;
  onSelect: (o: T) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o === selected;
        return (
          <Pressable
            key={o}
            onPress={() => onSelect(o)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            style={[
              styles.option,
              {
                backgroundColor: on ? theme.bg.recessed : 'transparent',
                borderColor: on ? theme.text.secondary : theme.line.hairline,
              },
            ]}
          >
            <Text
              variant="bodyMedium"
              style={{ color: on ? theme.text.primary : theme.text.secondary, fontWeight: on ? '600' : '400' }}
            >
              {format(o)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  value: string;
  onMinus?: () => void;
  onPlus?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.stepper}>
      <Text variant="bodyMedium" style={[styles.stepLabel, { color: theme.text.secondary }]}>{label}</Text>
      <IconButton icon="minus" onPress={onMinus} disabled={!onMinus} accessibilityLabel={`${label}: earlier or shorter`} />
      <Text variant="bodyLarge" style={[styles.flex, { color: theme.text.primary }]} accessibilityLiveRegion="polite">
        {value}
      </Text>
      <IconButton icon="plus" onPress={onPlus} disabled={!onPlus} accessibilityLabel={`${label}: later or longer`} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tapTarget: { minHeight: spacing.minTapTarget },
  alignStart: { alignSelf: 'flex-start' },
  input: {
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: spacing.scale[3],
    minHeight: spacing.minTapTarget,
  },
  match: {
    padding: spacing.scale[3],
    borderRadius: radius.card,
    minHeight: spacing.minTapTarget,
    justifyContent: 'center',
  },
  packRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[3] },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[2],
    padding: spacing.scale[3],
    borderRadius: radius.card,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.scale[2] },
  option: {
    borderWidth: 1,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.scale[3],
    minHeight: spacing.minTapTarget,
    justifyContent: 'center',
  },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepLabel: { width: 56 },
  stopNo: { width: 24, textAlign: 'center' },
  card: { padding: spacing.cardPadding, borderRadius: radius.card, gap: spacing.scale[3] },
  bullet: { flexDirection: 'row', gap: spacing.scale[2] },
  basis: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.scale[1],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.chip,
    paddingHorizontal: spacing.scale[2],
    paddingVertical: 2,
  },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[2],
    padding: spacing.scale[3],
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actions: { gap: spacing.scale[2] },
});
