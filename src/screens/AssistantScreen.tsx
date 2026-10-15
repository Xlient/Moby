import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, Text, TextInput } from 'react-native-paper';
import { useMutation } from '@tanstack/react-query';
import { api, ApiRequestError } from '@/api/client';
import type { AskAnswer } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { env } from '@/config/env';
import { EmergencyNumbers } from '@/components/EmergencyNumbers';
import { countryAt } from '@/data/emergencyNumbers';
import { useUserCenter } from '@/location/UserLocationContext';
import { languageName, phoneLanguage } from '@/lib/language';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing, typography } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';

const SUGGESTIONS = [
  'What should I do if the road ahead is flooded?',
  'Where should I go during an earthquake if I’m indoors?',
  'What do I do when a tornado warning is issued?',
];

type Turn = { question: string; answer?: AskAnswer; error?: string };

/**
 * Ask Moby (POST /v1/ask): answers only from official alerts, Moby's safety guidance and
 * official websites, always with sources. When it can't ground an answer it says so
 * instead of guessing. Emergency numbers stay on screen the whole time.
 */
export function AssistantScreen() {
  const { theme } = useTheme();
  const r = useResponsive();
  const { user, isConfigured: authConfigured } = useAuth();
  const center = useUserCenter();
  const country = countryAt(center.lat, center.lon);
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const scroll = useRef<ScrollView>(null);

  const ask = useMutation({
    mutationFn: (question: string) =>
      api.ask({
        question,
        // Only a real fix: never ask about the demo city as if it were "near you".
        ...(center.source === 'device' ? { lat: center.lat, lon: center.lon } : {}),
        ...(country ? { country } : {}),
        language: phoneLanguage(),
      }),
    onSuccess: (answer, question) => update(question, { answer }),
    onError: (err, question) =>
      update(question, {
        error:
          err instanceof ApiRequestError && err.status === 429
            ? /today/i.test(JSON.stringify(err.body ?? ''))
              ? 'Ask Moby has answered all it can for today. Safety guidance still works, even offline.'
              : 'You’ve asked a lot of questions this hour. Please try again later.'
            : 'Couldn’t reach Moby. Check your connection and try again.',
      }),
  });

  function update(question: string, patch: Partial<Turn>) {
    setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 && t.question === question ? { ...t, ...patch } : t)));
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  }

  function send(text: string) {
    const question = text.trim();
    if (question.length < 3 || ask.isPending) return;
    setTurns((ts) => [...ts, { question }]);
    setDraft('');
    ask.mutate(question);
  }

  // No Firebase (mock data, or a local backend with MOBY_AUTH_DISABLED): nothing to sign in to.
  if (!user && authConfigured && !env.useMock) {
    return (
      <View style={[styles.center, { padding: r.gutter }]}>
        <Text accessibilityRole="header" style={[r.heading, { color: theme.text.primary }]}>Ask Moby</Text>
        <Text style={[typography.body, styles.gap, { color: theme.text.secondary }]}>
          Sign in to ask safety questions. Answers come from official alerts and safety guidance, with sources.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={{ padding: r.gutter, gap: spacing.scale[3] }}>
        <Text accessibilityRole="header" style={[r.heading, { color: theme.text.primary }]}>Ask Moby</Text>
        <Text style={[typography.body, { color: theme.text.secondary }]}>
          Answers come only from official alerts, Moby’s safety guidance and official websites, and always show their
          sources. If Moby can’t find an answer there, it says so instead of guessing.
        </Text>
        <EmergencyNumbers country={country} />

        {turns.length === 0 && (
          <View style={styles.suggestions}>
            {SUGGESTIONS.map((s) => (
              <Chip key={s} onPress={() => send(s)} style={styles.alignStart}>
                {s}
              </Chip>
            ))}
          </View>
        )}

        {turns.map((t, i) => (
          <View key={i} style={{ gap: spacing.scale[2] }}>
            <View style={[styles.question, { backgroundColor: theme.bg.recessed }]}>
              <Text style={[typography.body, { color: theme.text.primary }]}>{t.question}</Text>
            </View>
            {t.answer ? (
              <AnswerCard answer={t.answer} />
            ) : t.error ? (
              <Text style={[typography.body, { color: theme.text.secondary }]}>{t.error}</Text>
            ) : (
              <Text style={[typography.meta, { color: theme.text.secondary }]}>Checking official sources…</Text>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.composer, { padding: r.gutter, borderTopColor: theme.line.hairline }]}>
        <TextInput
          mode="outlined"
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask a safety question"
          maxLength={500}
          multiline
          style={styles.flex}
          onSubmitEditing={() => send(draft)}
          accessibilityLabel="Your question"
        />
        <Button mode="contained" onPress={() => send(draft)} disabled={ask.isPending || draft.trim().length < 3}>
          Ask
        </Button>
      </View>
      <Text style={[typography.meta, styles.privacy, { color: theme.text.faint }]}>
        Please don’t include names or addresses. Questions aren’t stored.
      </Text>
    </KeyboardAvoidingView>
  );
}

function AnswerCard({ answer }: { answer: AskAnswer }) {
  const { theme } = useTheme();
  if (answer.abstained || !answer.answer) {
    return (
      <View style={[styles.answer, { backgroundColor: theme.bg.raised }]}>
        <Text style={[typography.body, { color: theme.text.primary }]}>
          I couldn’t find an answer to that in official alerts or safety guidance, so I won’t guess. Try asking about
          what to do in a specific hazard, or check the Safety guidance section.
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.answer, { backgroundColor: theme.bg.raised }]} accessibilityLabel="Moby's answer">
      <Text style={[typography.body, { color: theme.text.primary }]}>{answer.answer}</Text>
      <Text style={[typography.meta, styles.gap, { color: theme.text.secondary }]}>Sources</Text>
      {answer.sources.map((s) => (
        <Text
          key={s.n}
          style={[typography.meta, { color: s.url ? theme.text.primary : theme.text.secondary }]}
          onPress={s.url ? () => Linking.openURL(s.url!) : undefined}
          accessibilityRole={s.url ? 'link' : undefined}
        >
          [{s.n}] {s.title} · {s.publisher}
          {s.kind === 'alert' ? ' (active alert)' : ''}
        </Text>
      ))}
      <Text style={[typography.meta, styles.gap, { color: theme.text.faint }]}>
        Answered by Moby AI · NVIDIA Nemotron
        {languageName(answer.language) ? ` · translated into ${languageName(answer.language)}` : ''}
        {answer.searched_web ? ' · official websites searched with Tavily' : ''}. Follow official instructions if
        they differ.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'flex-start' },
  gap: { marginTop: spacing.scale[2] },
  suggestions: { gap: spacing.scale[2] },
  alignStart: { alignSelf: 'flex-start' },
  question: { alignSelf: 'flex-end', maxWidth: '85%', padding: spacing.scale[3], borderRadius: radius.card },
  answer: { padding: spacing.scale[4], borderRadius: radius.card, gap: spacing.scale[1] },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.scale[1],
  },
  privacy: { textAlign: 'center', paddingBottom: spacing.scale[2] },
});
