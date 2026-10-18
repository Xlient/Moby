import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, Text, TextInput } from 'react-native-paper';
import { useMutation } from '@tanstack/react-query';
import { api, ApiRequestError } from '@/api/client';
import type { AskAnswer } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { env } from '@/config/env';
import { EmergencyNumbers } from '@/components/EmergencyNumbers';
import {
  AnswerSurface,
  CitedText,
  Footnote,
  MobyMessage,
  QuestionBubble,
  SourceList,
  ThinkingBubble,
} from '@/components/AskMessage';
import { countryAt } from '@/data/emergencyNumbers';
import { useUserCenter } from '@/location/UserLocationContext';
import { phoneLanguage } from '@/lib/language';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, typography } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useGuidance } from '@/guidance/guidanceStore';
import type { LocalAnswer } from '@/ondevice/answer';
import { NANO_MODEL } from '@/ondevice/model';
import type { LocalSource } from '@/ondevice/retrieve';
import { askOnDevice, warmUp } from '@/ondevice/runtime';
import { useModelState } from '@/ondevice/useModel';

const SUGGESTIONS = [
  'What should I do if the road ahead is flooded?',
  'Where should I go during an earthquake if I’m indoors?',
  'What do I do when a tornado warning is issued?',
];

type Turn = {
  question: string;
  answer?: AskAnswer;
  error?: string;
  /** Answered on the phone (no signal): the saved cards it used, then the checked answer. */
  local?: { sources: LocalSource[]; answer?: LocalAnswer };
};

/**
 * Ask Moby (POST /v1/ask): answers only from official alerts, Moby's safety guidance and
 * official websites, always with sources. When it can't ground an answer it says so
 * instead of guessing. Emergency numbers stay on screen the whole time.
 */
export function AssistantScreen() {
  const { theme } = useTheme();
  const r = useResponsive();
  const { user } = useAuth();
  const center = useUserCenter();
  const country = countryAt(center.lat, center.lon);
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const scroll = useRef<ScrollView>(null);
  const isOnline = useOnlineStatus();
  // Offline answers use the local agencies' cards first (only from a real fix, never the demo city).
  const { cards } = useGuidance(center.source === 'device' ? country : undefined);
  const model = useModelState();
  const canAnswerOffline = model.kind === 'ready';

  // Offline with the model downloaded: load it now, so the first answer is quicker.
  useEffect(() => {
    if (!isOnline && canAnswerOffline) warmUp().catch(() => {});
  }, [isOnline, canAnswerOffline]);

  function askLocally(question: string) {
    const run = askOnDevice(question, cards);
    update(question, { local: { sources: run.sources }, error: undefined });
    void run.result.then((answer) => update(question, { local: { sources: run.sources, answer } }));
  }

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
    onError: (err, question) => {
      // Couldn't reach Moby (not a "too many questions"): answer on the phone if we can.
      if (canAnswerOffline && !(err instanceof ApiRequestError && err.status === 429)) return askLocally(question);
      update(question, {
        error:
          err instanceof ApiRequestError && err.status === 429
            ? /today/i.test(JSON.stringify(err.body ?? ''))
              ? 'Ask Moby has answered all it can for today. Safety guidance still works, even offline.'
              : 'You’ve asked a lot of questions this hour. Please try again later.'
            : 'Couldn’t reach Moby. Check your connection and try again.',
      });
    },
  });

  function update(question: string, patch: Partial<Turn>) {
    setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 && t.question === question ? { ...t, ...patch } : t)));
  }

  function send(text: string) {
    const question = text.trim();
    if (question.length < 3 || ask.isPending) return;
    setTurns((ts) => [...ts, { question }]);
    setDraft('');
    if (isOnline) {
      ask.mutate(question);
    } else if (canAnswerOffline) {
      askLocally(question);
    } else {
      setTimeout(
        () =>
          update(question, {
            error:
              'You’re offline. Saved safety guidance still works (Home → Safety guidance). To get answers with no signal, download offline answers in Settings while you have Wi-Fi.',
          }),
        0,
      );
    }
  }

  if (!user && !env.useMock && !(canAnswerOffline && !isOnline)) {
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
      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={{ padding: r.gutter, gap: spacing.scale[3] }}
        // Follow the conversation: scroll once the new question, the thinking bubble or the answer has laid out.
        onContentSizeChange={() => turns.length > 0 && scroll.current?.scrollToEnd({ animated: true })}
      >
        <Text accessibilityRole="header" style={[r.heading, { color: theme.text.primary }]}>Ask Moby</Text>
        <Text style={[typography.body, { color: theme.text.secondary }]}>
          Answers come only from official alerts, Moby’s safety guidance and official websites, and always show their
          sources. If Moby can’t find an answer there, it says so instead of guessing.
        </Text>
        {!isOnline && (
          <Text style={[typography.meta, { color: theme.text.secondary }]}>
            {canAnswerOffline
              ? `You’re offline: answering on your phone with ${NANO_MODEL.name}, from saved safety guidance only.`
              : 'You’re offline.'}
          </Text>
        )}
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
            <QuestionBubble text={t.question} />
            {t.local ? (
              <LocalAnswerCard sources={t.local.sources} answer={t.local.answer} />
            ) : t.answer ? (
              <AnswerCard answer={t.answer} />
            ) : t.error ? (
              <MobyMessage via="couldn’t answer">
                <AnswerSurface quiet>
                  <Text style={[typography.body, { color: theme.text.secondary }]}>{t.error}</Text>
                </AnswerSurface>
              </MobyMessage>
            ) : (
              <MobyMessage via="official sources">
                <ThinkingBubble status="Checking official sources…" />
              </MobyMessage>
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
      <MobyMessage via="official sources">
        <AnswerSurface quiet>
          <Text style={[typography.body, { color: theme.text.primary }]}>
            I couldn’t find an answer to that in official alerts or safety guidance, so I won’t guess. Try asking about
            what to do in a specific hazard, or check the Safety guidance section.
          </Text>
        </AnswerSurface>
      </MobyMessage>
    );
  }
  return (
    <MobyMessage via="NVIDIA Nemotron" label="Moby's answer">
      <AnswerSurface>
        <CitedText text={answer.answer} />
        <SourceList
          sources={answer.sources.map((s) => ({
            n: s.n,
            title: s.title,
            publisher: s.publisher,
            url: s.url,
            note: s.kind === 'alert' ? 'active alert' : undefined,
          }))}
        />
        <Footnote>
          {answer.searched_web ? 'Official websites searched with Tavily. ' : ''}Follow official instructions if they
          differ.
        </Footnote>
      </AnswerSurface>
    </MobyMessage>
  );
}

/** An answer made on the phone. While the model writes, a thinking animation; then its
 *  short, checked answer, or (if it didn't pass the checks) the saved guidance it matched. */
function LocalAnswerCard({ sources, answer }: { sources: LocalSource[]; answer?: LocalAnswer }) {
  const { theme } = useTheme();
  const via = `on your phone · ${NANO_MODEL.name}`;
  if (sources.length === 0) {
    return (
      <MobyMessage via="on your phone">
        <AnswerSurface quiet>
          <Text style={[typography.body, { color: theme.text.primary }]}>
            There’s no saved safety guidance about that on your phone, so I won’t guess. Try asking about what to do in
            a flood, fire, earthquake, storm or landslide.
          </Text>
        </AnswerSurface>
      </MobyMessage>
    );
  }
  if (!answer) {
    return (
      <MobyMessage via={via}>
        <ThinkingBubble status="Thinking on your phone (about 10–20 seconds)…" />
      </MobyMessage>
    );
  }
  if (answer.answer) {
    return (
      <MobyMessage via={via} label="Moby's offline answer">
        <AnswerSurface>
          <CitedText text={answer.answer} />
          <SourceList sources={answer.sources} />
          <Footnote>From guidance saved on your phone. Follow official instructions if they differ.</Footnote>
        </AnswerSurface>
      </MobyMessage>
    );
  }
  return (
    <MobyMessage via={via} label="Saved guidance">
      <AnswerSurface quiet>
        <Text style={[typography.meta, { color: theme.text.secondary }]}>
          No short answer this time. Here’s the saved guidance that matches:
        </Text>
        {sources.map((s) => (
          <View key={s.id} style={[styles.card, { borderTopColor: theme.line.hairline }]}>
            <Text style={[typography.bodyStrong, { color: theme.text.primary }]}>{s.title}</Text>
            <Text style={[typography.body, { color: theme.text.primary }]}>{s.text}</Text>
            <Text style={[typography.meta, { color: theme.text.faint }]}>{s.publisher}</Text>
          </View>
        ))}
      </AnswerSurface>
    </MobyMessage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'flex-start' },
  gap: { marginTop: spacing.scale[2] },
  suggestions: { gap: spacing.scale[2] },
  alignStart: { alignSelf: 'flex-start' },
  card: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.scale[2], gap: spacing.scale[1] },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.scale[1],
  },
  privacy: { textAlign: 'center', paddingBottom: spacing.scale[2] },
});
