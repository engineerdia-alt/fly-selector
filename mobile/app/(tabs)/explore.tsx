import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

import { DestinationCard } from '@/components/DestinationCard';
import { destinationId, filterDestinations } from '@/lib/destinations';
import { colors, radii, spacing } from '@/lib/theme';

export default function ExploreScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => filterDestinations({ query }), [query]);

  return (
    <View style={styles.root}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: 39.8,
          longitude: -98.5,
          latitudeDelta: 35,
          longitudeDelta: 35,
        }}
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'terrain'}>
        {filtered.slice(0, 40).map((d) => (
          <Marker
            key={destinationId(d)}
            coordinate={{ latitude: d.lat, longitude: d.lon }}
            title={d.name}
            description={d.state}
            pinColor={colors.rust}
            onCalloutPress={() => router.push(`/spot/${destinationId(d)}`)}
          />
        ))}
      </MapView>

      <View style={styles.sheet}>
        <Text style={styles.title}>Explore destinations</Text>
        <Text style={styles.sub}>
          {filtered.length} curated waters — access depth grows from here; the win is knowing
          whether to go.
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search river, state, or vibe…"
          placeholderTextColor={colors.inkSoft}
          style={styles.input}
          autoCorrect={false}
        />
        <FlatList
          data={filtered}
          keyExtractor={(d) => destinationId(d)}
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <DestinationCard
              destination={item}
              onPress={() => router.push(`/spot/${destinationId(item)}`)}
            />
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.parchment },
  map: { height: '38%', width: '100%' },
  sheet: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  title: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 22,
    color: colors.river,
  },
  sub: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 13,
    color: colors.inkSoft,
    lineHeight: 18,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.parchmentDim,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 15,
    color: colors.ink,
  },
});
