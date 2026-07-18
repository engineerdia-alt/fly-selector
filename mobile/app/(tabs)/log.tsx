import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, radii, spacing } from '@/lib/theme';

type Trip = {
  id: string;
  spot: string;
  note: string;
  when: string;
};

const KEY = 'ff.trips.v1';

export default function LogScreen() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [spot, setSpot] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem(KEY);
    setTrips(raw ? JSON.parse(raw) : []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function save() {
    if (!spot.trim()) return;
    const next: Trip[] = [
      {
        id: String(Date.now()),
        spot: spot.trim(),
        note: note.trim(),
        when: new Date().toISOString(),
      },
      ...trips,
    ];
    setTrips(next);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    setSpot('');
    setNote('');
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Trip log</Text>
      <Text style={styles.sub}>Quick notes after the session — what ate, what didn’t.</Text>

      <TextInput
        style={styles.input}
        placeholder="Water / stretch"
        placeholderTextColor={colors.inkSoft}
        value={spot}
        onChangeText={setSpot}
      />
      <TextInput
        style={[styles.input, styles.note]}
        placeholder="How did it fish?"
        placeholderTextColor={colors.inkSoft}
        value={note}
        onChangeText={setNote}
        multiline
      />
      <Pressable style={styles.btn} onPress={save}>
        <Text style={styles.btnText}>Save trip</Text>
      </Pressable>

      <FlatList
        data={trips}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}
        ListEmptyComponent={
          <Text style={styles.empty}>No trips yet. Log one after your next outing.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.spot}</Text>
            <Text style={styles.cardWhen}>{new Date(item.when).toLocaleString()}</Text>
            {item.note ? <Text style={styles.cardNote}>{item.note}</Text> : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.parchment, padding: spacing.md },
  title: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 26,
    color: colors.river,
  },
  sub: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 14,
    color: colors.inkSoft,
    marginBottom: spacing.md,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.parchmentDim,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 15,
    color: colors.ink,
    marginBottom: 8,
  },
  note: { minHeight: 72, textAlignVertical: 'top' },
  btn: {
    backgroundColor: colors.river,
    borderRadius: radii.sm,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnText: {
    fontFamily: 'SourceSans3_600SemiBold',
    color: colors.parchment,
  },
  empty: {
    fontFamily: 'SourceSans3_400Regular',
    color: colors.inkSoft,
    textAlign: 'center',
    marginTop: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.parchmentDim,
    padding: spacing.md,
    gap: 4,
  },
  cardTitle: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 17,
    color: colors.river,
  },
  cardWhen: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 12,
    color: colors.brassDark,
  },
  cardNote: {
    fontFamily: 'SourceSans3_400Regular',
    fontSize: 14,
    color: colors.ink,
    marginTop: 4,
  },
});
