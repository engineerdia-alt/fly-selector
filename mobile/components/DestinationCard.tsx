import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Destination } from '@/lib/destinations';
import { colors, radii, spacing } from '@/lib/theme';

export function DestinationCard({
  destination,
  miles,
  onPress,
}: {
  destination: Destination;
  miles?: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.row}>
        <Text style={styles.name}>{destination.name}</Text>
        {miles != null ? <Text style={styles.miles}>{miles} mi</Text> : null}
      </View>
      <Text style={styles.meta}>
        {destination.state} · {destination.species.join(', ')}
      </Text>
      <Text style={styles.hook} numberOfLines={2}>
        {destination.hook}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.parchmentDim,
    padding: spacing.md,
    gap: 4,
  },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: {
    flex: 1,
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 18,
    color: colors.river,
  },
  miles: {
    fontFamily: 'SourceSans3_600SemiBold',
    fontSize: 13,
    color: colors.brassDark,
  },
  meta: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 13,
    color: colors.inkSoft,
  },
  hook: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 14,
    color: colors.ink,
    lineHeight: 20,
    marginTop: 2,
  },
});
