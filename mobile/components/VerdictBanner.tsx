import { StyleSheet, Text, View } from 'react-native';

import type { GoNoGoResult } from '@/lib/goNoGo';
import { colors, radii, spacing } from '@/lib/theme';

const tone = {
  go: { bg: '#DCEADF', fg: colors.go },
  caution: { bg: '#F3E6C8', fg: colors.caution },
  'no-go': { bg: '#F3D9D0', fg: colors.noGo },
};

export function VerdictBanner({ result }: { result: GoNoGoResult }) {
  const t = tone[result.verdict];
  return (
    <View style={[styles.wrap, { backgroundColor: t.bg, borderColor: t.fg }]}>
      <Text style={[styles.eyebrow, { color: t.fg }]}>{"Today's call"}</Text>
      <Text style={[styles.label, { color: t.fg }]}>{result.label}</Text>
      {result.reasons.slice(0, 3).map((r) => (
        <Text key={r} style={styles.reason}>
          · {r}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1.5,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 4,
  },
  eyebrow: {
    fontFamily: 'SourceSans3_600SemiBold',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  label: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 26,
    marginBottom: 4,
  },
  reason: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 14,
    color: colors.inkSoft,
    lineHeight: 20,
  },
});
