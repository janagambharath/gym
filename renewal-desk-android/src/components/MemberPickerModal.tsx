import { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';
import { SearchBar } from './SearchBar';

export type PickerPerson = { id: number; full_name: string };

type MemberPickerModalProps = {
  visible: boolean;
  title: string;
  people: PickerPerson[];
  onSelect: (person: PickerPerson) => void;
  onClose: () => void;
};

export function MemberPickerModal({ visible, title, people, onSelect, onClose }: MemberPickerModalProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => p.full_name.toLowerCase().includes(q));
  }, [people, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <SearchBar placeholder="Search member by name" value={query} onChangeText={setQuery} />
          <FlatList
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  setQuery('');
                  onSelect(item);
                }}
              >
                <Text style={styles.name}>{item.full_name}</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No members match “{query}”.</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, maxHeight: '80%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  close: { color: colors.muted, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  list: { marginTop: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderColor: colors.borderLight },
  name: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  chevron: { color: colors.muted, fontSize: fontSize.xl },
  empty: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing.lg },
});
