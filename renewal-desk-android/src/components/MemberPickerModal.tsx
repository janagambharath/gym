import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';
import { SearchBar } from './SearchBar';

export type PickerPerson = { id: number; full_name: string };

type MemberPickerModalProps = {
  visible: boolean;
  title: string;
  /** Client-side list (legacy). Ignored when serverSearch is provided. */
  people?: PickerPerson[];
  onSelect: (person: PickerPerson) => void;
  onClose: () => void;
  /** Server-side search: typing queries the backend (q=) instead of
   * filtering a preloaded list — a member outside the first 100 can be
   * picked. Called with '' on open for the first page. */
  serverSearch?: (query: string) => Promise<PickerPerson[]>;
};

export function MemberPickerModal({ visible, title, people = [], onSelect, onClose, serverSearch }: MemberPickerModalProps) {
  const [query, setQuery] = useState('');
  const [serverResults, setServerResults] = useState<PickerPerson[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Server search: ONE fetch per open / per debounced query change.
  // (Previously two effects fired on open — the open effect AND the query
  // effect with the initial '' — and the query effect's `cancelled` flag
  // lived inside the setTimeout callback, so an in-flight request could
  // never actually be cancelled and a stale response overwrote newer
  // results.) The sequence guard drops any response that is no longer the
  // latest request.
  const searchSeqRef = useRef(0);

  useEffect(() => {
    if (!visible || !serverSearch) return;
    setServerResults(null);
    setSearching(true);
    const seq = ++searchSeqRef.current;
    // First page loads immediately on open; keystrokes debounce 400ms.
    const delay = query.trim() ? 400 : 0;
    const timer = setTimeout(() => {
      void serverSearch(query.trim()).then((results) => {
        if (seq !== searchSeqRef.current) return;
        setServerResults(results);
        setSearching(false);
      }).catch(() => {
        if (seq === searchSeqRef.current) setSearching(false);
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [visible, query, serverSearch]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => p.full_name.toLowerCase().includes(q));
  }, [people, query]);

  const list = serverSearch ? (serverResults ?? []) : filtered;

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
            data={list}
            keyExtractor={(item) => String(item.id)}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              searching ? (
                <Text style={styles.empty}>Searching…</Text>
              ) : (
                <Text style={styles.empty}>No members match “{query}”.</Text>
              )
            }
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
