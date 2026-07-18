import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useSubscription } from '@/context/SubscriptionContext';
import { askGuide, planTrip, type ChatMessage } from '@/lib/api';
import { colors, radii, spacing } from '@/lib/theme';

type Mode = 'ask' | 'plan';

export default function GuideScreen() {
  const { canUseAi } = useSubscription();
  const [mode, setMode] = useState<Mode>('plan');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  if (!canUseAi) {
    return (
      <View style={styles.locked}>
        <Text style={styles.brand}>Ask the guide</Text>
        <Text style={styles.lockBody}>
          This is the edge TroutRoutes and DIY don&apos;t have: a conditions-grounded answer on
          whether to go, what to tie on, and which access to try — not just a pin on a map.
        </Text>
        <Link href="/paywall" asChild>
          <Pressable style={styles.cta}>
            <Text style={styles.ctaText}>Start Pro trial</Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    const next = [...messages, { role: 'user' as const, content: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      if (mode === 'plan') {
        const plan = await planTrip(next);
        const bits = [plan.reply];
        if (plan.ready && plan.place) {
          bits.push(`Place locked: ${plan.place}${plan.species ? ` · ${plan.species}` : ''}`);
        }
        setMessages([...next, { role: 'assistant', content: bits.join('\n\n') }]);
      } else {
        const res = await askGuide(next, {
          note: 'Mobile app session — angler has not opened a specific spot card yet.',
        });
        setMessages([...next, { role: 'assistant', content: res.answer || 'No answer came back.' }]);
      }
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setMessages(messages);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}>
      <View style={styles.modes}>
        {(['plan', 'ask'] as Mode[]).map((m) => (
          <Pressable
            key={m}
            onPress={() => {
              setMode(m);
              setMessages([]);
              setError(null);
            }}
            style={[styles.modeBtn, mode === m && styles.modeOn]}>
            <Text style={[styles.modeText, mode === m && styles.modeTextOn]}>
              {m === 'plan' ? 'Plan a trip' : 'Guide chat'}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        {mode === 'plan'
          ? 'Try: “smallmouth near Ann Arbor this weekend”'
          : 'Ask tactics, flies, or whether today’s conditions are worth it.'}
      </Text>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.thread}
        ListEmptyComponent={
          <Text style={styles.empty}>Your conversation with the guide shows up here.</Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.user : styles.bot]}>
            <Text style={[styles.bubbleText, item.role === 'user' && styles.userText]}>
              {item.content}
            </Text>
          </View>
        )}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={mode === 'plan' ? 'Where and what are you after?' : 'Ask the guide…'}
          placeholderTextColor={colors.inkSoft}
          editable={!busy}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable style={styles.send} onPress={send} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.parchment} />
          ) : (
            <Text style={styles.sendText}>Send</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.parchment },
  locked: {
    flex: 1,
    backgroundColor: colors.parchment,
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.md,
  },
  brand: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 32,
    color: colors.river,
  },
  lockBody: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 16,
    color: colors.inkSoft,
    lineHeight: 24,
  },
  cta: {
    backgroundColor: colors.rust,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaText: {
    fontFamily: 'SourceSans3_600SemiBold',
    color: colors.parchment,
    fontSize: 16,
  },
  modes: {
    flexDirection: 'row',
    gap: 8,
    padding: spacing.md,
    paddingBottom: 0,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.parchmentDim,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  modeOn: { backgroundColor: colors.river, borderColor: colors.river },
  modeText: { fontFamily: 'SourceSans3_600SemiBold', color: colors.inkSoft },
  modeTextOn: { color: colors.parchment },
  hint: {
    paddingHorizontal: spacing.md,
    paddingTop: 8,
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 13,
    color: colors.inkSoft,
  },
  thread: { padding: spacing.md, gap: 10, paddingBottom: 24 },
  empty: {
    fontFamily: 'SourceSans3_400Regular',
    color: colors.inkSoft,
    textAlign: 'center',
    marginTop: 40,
  },
  bubble: {
    maxWidth: '88%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  bot: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.parchmentDim,
    borderBottomLeftRadius: 4,
  },
  user: {
    alignSelf: 'flex-end',
    backgroundColor: colors.river,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 15,
    color: colors.ink,
    lineHeight: 21,
  },
  userText: { color: colors.parchment },
  error: {
    color: colors.noGo,
    paddingHorizontal: spacing.md,
    fontFamily: 'SourceSans3_400Regular',
  },
  composer: {
    flexDirection: 'row',
    gap: 8,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.parchmentDim,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 15,
    color: colors.ink,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.parchment,
    borderRadius: radii.sm,
  },
  send: {
    backgroundColor: colors.rust,
    borderRadius: radii.sm,
    paddingHorizontal: 16,
    justifyContent: 'center',
    minWidth: 72,
    alignItems: 'center',
  },
  sendText: {
    fontFamily: 'SourceSans3_600SemiBold',
    color: colors.parchment,
  },
});
