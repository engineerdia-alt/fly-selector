import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { DestinationCard } from '@/components/DestinationCard';
import { VerdictBanner } from '@/components/VerdictBanner';
import { useSubscription } from '@/context/SubscriptionContext';
import { fetchNearestGauge, fetchWeather } from '@/lib/api';
import { destinationId, destinationsNear } from '@/lib/destinations';
import { evaluateGoNoGo, type GoNoGoResult } from '@/lib/goNoGo';
import { colors, radii, spacing } from '@/lib/theme';

export default function TodayScreen() {
  const router = useRouter();
  const { isPro } = useSubscription();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [placeLabel, setPlaceLabel] = useState('Near you');
  const [verdict, setVerdict] = useState<GoNoGoResult | null>(null);
  const [nearby, setNearby] = useState<ReturnType<typeof destinationsNear>>([]);
  const [meta, setMeta] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      let lat = 44.66;
      let lon = -84.62;
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({});
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
        setPlaceLabel('Near your location');
      } else {
        setPlaceLabel('Demo: Au Sable country (enable location for local)');
      }

      const [weather, gauge] = await Promise.all([
        fetchWeather(lat, lon),
        fetchNearestGauge(lat, lon),
      ]);

      const result = evaluateGoNoGo({
        species: 'trout',
        waterTempF: gauge?.waterTempF ?? null,
        flowTrend: gauge?.trend ?? null,
        trendPct: gauge?.trendPct ?? null,
        precipIn24h: weather.precipIn24h,
        windMph: weather.windMph,
      });
      setVerdict(result);

      const bits = [
        weather.tempF != null ? `${Math.round(weather.tempF)}°F air` : null,
        weather.windMph != null ? `${Math.round(weather.windMph)} mph wind` : null,
        gauge?.flowCfs != null ? `${Math.round(gauge.flowCfs)} cfs` : null,
        gauge?.waterTempF != null ? `${gauge.waterTempF}°F water` : null,
        gauge?.trend ? `flow ${gauge.trend}` : null,
      ].filter(Boolean);
      setMeta(bits.join(' · '));
      setNearby(destinationsNear(lat, lon, 5));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load conditions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.river, colors.riverLight, colors.parchment]}
        locations={[0, 0.35, 0.35]}
        style={StyleSheet.absoluteFill}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.parchment} />}>
        <Text style={styles.brand}>Fly Finder</Text>
        <Text style={styles.headline}>Should you go?</Text>
        <Text style={styles.sub}>{placeLabel}</Text>

        {loading && !verdict ? (
          <ActivityIndicator color={colors.parchment} style={{ marginTop: 24 }} />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {verdict ? <VerdictBanner result={verdict} /> : null}
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}

        {!isPro ? (
          <Link href="/paywall" asChild>
            <Pressable style={styles.upsell}>
              <Text style={styles.upsellTitle}>Unlock Pro</Text>
              <Text style={styles.upsellBody}>
                AI guide, Ask planner, and unlimited condition refreshes — the layer map apps
                don&apos;t have.
              </Text>
            </Pressable>
          </Link>
        ) : null}

        <Text style={styles.section}>Closest curated waters</Text>
        <View style={styles.list}>
          {nearby.map((d) => (
            <DestinationCard
              key={destinationId(d)}
              destination={d}
              miles={d.miles}
              onPress={() => router.push(`/spot/${destinationId(d)}`)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.parchment },
  content: { padding: spacing.lg, paddingBottom: 48, gap: spacing.md },
  brand: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 34,
    color: colors.parchment,
    marginTop: spacing.sm,
  },
  headline: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 17,
    color: colors.parchmentDim,
    marginTop: -8,
  },
  sub: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 14,
    color: colors.parchmentDim,
    marginBottom: spacing.sm,
  },
  meta: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 13,
    color: colors.inkSoft,
  },
  error: { color: colors.noGo, fontFamily: 'SourceSans3_400Regular' },
  upsell: {
    backgroundColor: colors.river,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
  },
  upsellTitle: {
    fontFamily: 'Fraunces_600SemiBold',
    color: colors.parchment,
    fontSize: 18,
  },
  upsellBody: {
    fontFamily: 'SourceSans3_400Regular',
    color: colors.parchmentDim,
    fontSize: 14,
    lineHeight: 20,
  },
  section: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 20,
    color: colors.river,
    marginTop: spacing.sm,
  },
  list: { gap: spacing.sm },
});
