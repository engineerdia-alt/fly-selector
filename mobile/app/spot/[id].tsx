import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { VerdictBanner } from '@/components/VerdictBanner';
import { useSubscription } from '@/context/SubscriptionContext';
import { fetchNearestGauge, fetchWeather } from '@/lib/api';
import { findDestination } from '@/lib/destinations';
import { evaluateGoNoGo, type GoNoGoResult } from '@/lib/goNoGo';
import { colors, radii, spacing } from '@/lib/theme';

export default function SpotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { canUseAi } = useSubscription();
  const destination = id ? findDestination(String(id)) : undefined;
  const [loading, setLoading] = useState(true);
  const [verdict, setVerdict] = useState<GoNoGoResult | null>(null);
  const [meta, setMeta] = useState('');

  useEffect(() => {
    if (!destination) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [weather, gauge] = await Promise.all([
          fetchWeather(destination.lat, destination.lon),
          fetchNearestGauge(destination.lat, destination.lon),
        ]);
        if (cancelled) return;
        setVerdict(
          evaluateGoNoGo({
            species: destination.species[0],
            waterTempF: gauge?.waterTempF ?? null,
            flowTrend: gauge?.trend ?? null,
            trendPct: gauge?.trendPct ?? null,
            precipIn24h: weather.precipIn24h,
            windMph: weather.windMph,
          })
        );
        setMeta(
          [
            gauge?.siteName ? `Gauge: ${gauge.siteName}` : null,
            gauge?.flowCfs != null ? `${Math.round(gauge.flowCfs)} cfs` : null,
            gauge?.waterTempF != null ? `${gauge.waterTempF}°F water` : null,
            weather.tempF != null ? `${Math.round(weather.tempF)}°F air` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [destination]);

  if (!destination) {
    return (
      <View style={styles.root}>
        <Text style={styles.body}>Water not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.name}>{destination.name}</Text>
      <Text style={styles.metaLine}>
        {destination.state} · {destination.species.join(', ')}
      </Text>
      <Text style={styles.hook}>{destination.hook}</Text>

      {loading ? <ActivityIndicator color={colors.river} /> : null}
      {verdict ? <VerdictBanner result={verdict} /> : null}
      {meta ? <Text style={styles.live}>{meta}</Text> : null}

      <View style={styles.block}>
        <Text style={styles.label}>Hatches & timing</Text>
        <Text style={styles.body}>{destination.hatches}</Text>
      </View>
      <View style={styles.block}>
        <Text style={styles.label}>Where to focus</Text>
        <Text style={styles.body}>{destination.stretches}</Text>
      </View>
      <View style={styles.block}>
        <Text style={styles.label}>Regulations</Text>
        <Text style={styles.body}>
          {destination.regs} Always verify with the state agency before you go.
        </Text>
      </View>

      <Pressable
        style={styles.cta}
        onPress={() => router.push(canUseAi ? '/(tabs)/guide' : '/paywall')}>
        <Text style={styles.ctaText}>
          {canUseAi ? 'Ask the guide about this water' : 'Unlock guide for this water'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.parchment },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  name: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 28,
    color: colors.river,
  },
  metaLine: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 14,
    color: colors.brassDark,
    marginTop: -8,
  },
  hook: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 16,
    color: colors.ink,
    lineHeight: 24,
  },
  live: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 13,
    color: colors.inkSoft,
  },
  block: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.parchmentDim,
    padding: spacing.md,
    gap: 6,
  },
  label: {
    fontFamily: 'SourceSans3_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.brassDark,
  },
  body: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 15,
    color: colors.ink,
    lineHeight: 22,
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
    fontSize: 15,
  },
});
