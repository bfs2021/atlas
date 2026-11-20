import { ref } from 'vue';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useToast } from './useToast';

export interface SavedComparisonCity {
  slot: number;
  state: string;
  city: string;
  city_name: string;
}

export interface SavedComparison {
  id: string;
  user_id: string;
  created_at: string;
  cities: SavedComparisonCity[];
}

const savedComparisons = ref<SavedComparison[]>([]);
const loaded = ref(false);

export function toSavedComparison(row: any): SavedComparison {
  return {
    id: row.id,
    user_id: row.user_id,
    created_at: row.created_at,
    cities: [...(row.saved_comparison_cities ?? [])].sort((a, b) => a.slot - b.slot),
  };
}

export function useComparisons() {
  const { user } = useAuth();
  const { show: showToast } = useToast();

  async function fetchComparisons() {
    if (!user.value) {
      savedComparisons.value = [];
      loaded.value = true;
      return;
    }
    const { data, error } = await supabase
      .from('saved_comparisons')
      .select('id, user_id, created_at, saved_comparison_cities(slot, state, city, city_name)')
      .eq('user_id', user.value.id)
      .order('created_at', { ascending: false });
    if (!error && data) {
      savedComparisons.value = data.map(toSavedComparison);
    }
    loaded.value = true;
  }

  // Resolves true once the comparison is saved (or already was), false if it couldn't be.
  async function addComparison(cities: { state: string; city: string; cityName: string }[]): Promise<boolean> {
    if (!user.value || cities.length < 2) return false;
    if (isComparisonSaved(cities)) return true;

    const { data: comparison, error } = await supabase
      .from('saved_comparisons')
      .insert({ user_id: user.value.id })
      .select()
      .single();
    if (error || !comparison) {
      showToast("Couldn't save this comparison. Try again.");
      return false;
    }

    const rows = cities.map((c, i) => ({ slot: i + 1, state: c.state, city: c.city, city_name: c.cityName }));
    const { error: citiesError } = await supabase
      .from('saved_comparison_cities')
      .insert(rows.map((r) => ({ comparison_id: comparison.id, ...r })));
    if (citiesError) {
      await supabase.from('saved_comparisons').delete().eq('id', comparison.id);
      showToast("Couldn't save this comparison. Try again.");
      return false;
    }

    savedComparisons.value.unshift({
      id: comparison.id,
      user_id: comparison.user_id,
      created_at: comparison.created_at,
      cities: rows,
    });
    return true;
  }

  // A saved comparison is the set of cities, not their order: dragging columns around on the
  // compare page (or picking a new baseline) shouldn't make it look unsaved or allow a duplicate.
  function matches(saved: SavedComparisonCity[], cities: { state: string; city: string }[]) {
    if (saved.length !== cities.length) return false;
    const key = (c: { state: string; city: string }) => `${c.state.toLowerCase()}-${c.city}`;
    const savedKeys = new Set(saved.map(key));
    return cities.every((c) => savedKeys.has(key(c)));
  }

  async function removeComparisonById(id: string): Promise<boolean> {
    if (!user.value) return false;
    const { error } = await supabase.from('saved_comparisons').delete().eq('id', id);
    if (error) {
      showToast("Couldn't delete this comparison. Try again.");
      return false;
    }
    savedComparisons.value = savedComparisons.value.filter((c) => c.id !== id);
    return true;
  }

  async function removeComparison(cities: { state: string; city: string }[]): Promise<boolean> {
    const target = savedComparisons.value.find((c) => matches(c.cities, cities));
    if (!target) return false;
    return removeComparisonById(target.id);
  }

  function isComparisonSaved(cities: { state: string; city: string }[]) {
    return savedComparisons.value.some((c) => matches(c.cities, cities));
  }

  return { savedComparisons, loaded, fetchComparisons, addComparison, removeComparison, removeComparisonById, isComparisonSaved };
}
