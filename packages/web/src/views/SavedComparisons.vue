<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import DashboardHeader from '../components/DashboardHeader.vue';
import { useAuth } from '../composables/useAuth';
import { useFriends } from '../composables/useFriends';
import { useComparisons, toSavedComparison, type SavedComparison, type SavedComparisonCity } from '../composables/useComparisons';
import { useRecentSearches } from '../composables/useRecentSearches';
import { fetchCityPhoto } from '../lib/cityPhotos';
import { fetchCity } from '../api/cities';
import { buildCompareUrl } from '../lib/compare';
import { supabase } from '../lib/supabase';
import { canViewerAccessProfileContent, getProfileVisibilityNotice, type ProfileVisibility } from '../lib/profilePrivacy';

const props = defineProps<{ username?: string }>();

const router = useRouter();
const { recordRecentSearch } = useRecentSearches();

function onHeaderSearch(payload: { city: string; state: string }) {
  void recordRecentSearch(payload.city, payload.state);
  router.push(`/city/${payload.state}/${payload.city}`);
}

const { user } = useAuth();
const { getFriendshipStatus } = useFriends();
const { savedComparisons, fetchComparisons, removeComparisonById } = useComparisons();

const isOwnPage = computed(() => !props.username);

// ── Viewing another user's comparisons ────────────────────────
const viewingName  = ref('');
const viewingComps = ref<SavedComparison[]>([]);
const viewingAccessDenied = ref(false);
const viewingNotice = ref<{ title: string; description: string } | null>(null);

async function fetchViewingComps() {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, username, profile_visibility')
    .eq('username', props.username!)
    .maybeSingle();
  if (!profile) {
    viewingComps.value = [];
    viewingAccessDenied.value = false;
    viewingNotice.value = null;
    return;
  }
  viewingName.value = profile.display_name || profile.username;
  let isFriend = false;
  if (user.value) {
    const status = await getFriendshipStatus(profile.id);
    isFriend = status.status === 'accepted';
  }
  const canView = canViewerAccessProfileContent(
    profile.profile_visibility as ProfileVisibility,
    user.value?.id,
    profile.id,
    isFriend,
  );
  viewingAccessDenied.value = !canView;
  viewingNotice.value = canView ? null : getProfileVisibilityNotice(profile.profile_visibility as ProfileVisibility, !!user.value);
  if (!canView) {
    viewingComps.value = [];
    return;
  }
  const { data } = await supabase
    .from('saved_comparisons')
    .select('id, user_id, created_at, saved_comparison_cities(slot, state, city, city_name)')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false });
  viewingComps.value = (data ?? []).map(toSavedComparison);
}

const displayComparisons = computed(() => isOwnPage.value ? savedComparisons.value : viewingComps.value);
const pageTitle           = computed(() => isOwnPage.value ? 'Saved Comparisons' : `${viewingName.value}'s Comparisons`);

// ── Filter by comparison size ─────────────────────────────────
// Only offered once the list actually mixes sizes — a row of chips that all say "2 cities"
// is noise.
const sizeFilter = ref<number | null>(null);

const sizeCounts = computed(() => {
  const counts = new Map<number, number>();
  for (const c of displayComparisons.value) {
    counts.set(c.cities.length, (counts.get(c.cities.length) ?? 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => x[0] - y[0]).map(([size, count]) => ({ size, count }));
});

const visibleComparisons = computed(() =>
  sizeFilter.value == null
    ? displayComparisons.value
    : displayComparisons.value.filter((c) => c.cities.length === sizeFilter.value),
);

// Deleting the last comparison of the filtered size would otherwise strand an empty grid.
watch(sizeCounts, (counts) => {
  if (sizeFilter.value != null && !counts.some((c) => c.size === sizeFilter.value)) sizeFilter.value = null;
});

// ── Per-city photo + population ───────────────────────────────
// Keyed by city rather than by card: the same city tends to show up in several saved
// comparisons, and it only needs fetching once.
interface CityExtras {
  photo: string | null;
  population: number | null;
  loading: boolean;
}

const cityExtras = ref<Record<string, CityExtras>>({});

function cityKey(city: { state: string; city: string }) {
  return `${city.state.toLowerCase()}-${city.city}`;
}

function extras(city: SavedComparisonCity): CityExtras | undefined {
  return cityExtras.value[cityKey(city)];
}

async function loadCity(city: SavedComparisonCity) {
  const key = cityKey(city);
  if (cityExtras.value[key]) return;
  cityExtras.value[key] = { photo: null, population: null, loading: true };
  const [photo, cityInfo] = await Promise.all([
    fetchCityPhoto(city.state, city.city),
    fetchCity(city.state, city.city).catch(() => null),
  ]);
  cityExtras.value[key] = { photo, population: cityInfo?.population ?? null, loading: false };
}

function formatPop(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

function formatSaved(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function slotLetter(i: number) {
  return String.fromCharCode(65 + i);
}

// The photo mosaic changes shape with the number of cities: a diagonal head-to-head for 2,
// a slanted triptych for 3, a 2x2 block for 4. Anything else falls back to an even strip.
function mosaicLayout(count: number) {
  if (count === 2) return 'duo';
  if (count === 3) return 'trio';
  if (count === 4) return 'quad';
  return 'strip';
}

function cardLabel(c: SavedComparison) {
  return `Open comparison: ${c.cities.map((city) => city.city_name).join(' vs ')}`;
}

async function init() {
  sizeFilter.value = null;
  if (isOwnPage.value) {
    if (!user.value) return;
    await fetchComparisons();
  } else {
    await fetchViewingComps();
  }
  displayComparisons.value.forEach((c) => c.cities.forEach(loadCity));
}

watch(() => user.value?.id, init, { immediate: true });
watch(() => props.username, init);

function goToComparison(c: SavedComparison) {
  router.push(buildCompareUrl(c.cities.map((city) => ({ state: city.state, city: city.city }))));
}

const removingId = ref<string | null>(null);

async function handleRemove(c: SavedComparison) {
  if (removingId.value) return;
  removingId.value = c.id;
  await removeComparisonById(c.id);
  removingId.value = null;
}
</script>

<template>
  <div class="scmp-page">
    <div class="container container--header-only">
      <DashboardHeader page-label="Saved Comparisons" @logo-click="router.push({ name: 'search' })" @search="onHeaderSearch" />
    </div>

    <div class="scmp-page__heading">
      <h1 class="scmp-page__title">
        <span class="mdi mdi-bookmark-multiple scmp-page__title-icon"></span>
        {{ pageTitle }}
      </h1>
      <button class="breadcrumb" @click="router.back()">
        <span class="breadcrumb__arr breadcrumb__arr--1 mdi mdi-arrow-left"></span>
        <span class="breadcrumb__text">Back</span>
        <span class="breadcrumb__arr breadcrumb__arr--2 mdi mdi-arrow-left"></span>
        <span class="breadcrumb__circle"></span>
      </button>
    </div>

    <div v-if="isOwnPage && !user" class="scmp-empty">
      <span class="mdi mdi-account-lock-outline scmp-empty__icon"></span>
      <p class="scmp-empty__text">Sign in to see your saved comparisons</p>
    </div>

    <div v-else-if="!isOwnPage && viewingAccessDenied" class="scmp-empty">
      <span class="mdi mdi-lock-outline scmp-empty__icon"></span>
      <p class="scmp-empty__text">{{ viewingNotice?.title }}</p>
      <p class="scmp-empty__hint">{{ viewingNotice?.description }}</p>
    </div>

    <div v-else-if="displayComparisons.length === 0" class="scmp-empty">
      <span class="mdi mdi-bookmark-off-outline scmp-empty__icon"></span>
      <p class="scmp-empty__text">No saved comparisons yet</p>
      <template v-if="isOwnPage">
        <p class="scmp-empty__hint">Line up 2 to 4 cities and hit Save comparison to keep them here.</p>
        <button class="scmp-empty__cta" @click="router.push({ name: 'compare-empty' })">Compare cities</button>
      </template>
    </div>

    <template v-else>
      <div v-if="sizeCounts.length > 1" class="scmp-filters" role="group" aria-label="Filter by number of cities">
        <button
          class="scmp-filters__chip"
          :class="{ 'scmp-filters__chip--active': sizeFilter == null }"
          :aria-pressed="sizeFilter == null"
          @click="sizeFilter = null"
        >
          All <span class="scmp-filters__count">{{ displayComparisons.length }}</span>
        </button>
        <button
          v-for="s in sizeCounts"
          :key="s.size"
          class="scmp-filters__chip"
          :class="{ 'scmp-filters__chip--active': sizeFilter === s.size }"
          :aria-pressed="sizeFilter === s.size"
          @click="sizeFilter = s.size"
        >
          {{ s.size }} cities <span class="scmp-filters__count">{{ s.count }}</span>
        </button>
      </div>

      <div class="scmp-grid">
        <article
          v-for="c in visibleComparisons"
          :key="c.id"
          class="scmp-card"
          :class="{ 'scmp-card--removing': removingId === c.id }"
          role="link"
          tabindex="0"
          :aria-label="cardLabel(c)"
          @click="goToComparison(c)"
          @keydown.enter.self="goToComparison(c)"
        >
          <div class="scmp-mosaic" :class="`scmp-mosaic--${mosaicLayout(c.cities.length)}`" aria-hidden="true">
            <div
              v-for="(city, i) in c.cities"
              :key="cityKey(city)"
              class="scmp-mosaic__panel"
              :class="{ 'scmp-mosaic__panel--loading': extras(city)?.loading !== false }"
              :style="{ '--slot-color': `var(--compare-slot-${(i % 4) + 1})` }"
            >
              <div
                class="scmp-mosaic__photo"
                :style="extras(city)?.photo ? { backgroundImage: `url(${extras(city)!.photo})` } : undefined"
              ></div>
              <span class="scmp-mosaic__letter">{{ slotLetter(i) }}</span>
            </div>
            <span v-if="c.cities.length === 2" class="scmp-mosaic__vs">vs</span>
          </div>

          <ul class="scmp-card__cities" :style="{ '--city-count': c.cities.length }">
            <li
              v-for="(city, i) in c.cities"
              :key="cityKey(city)"
              class="scmp-card__city"
              :style="{ '--slot-color': `var(--compare-slot-${(i % 4) + 1})` }"
            >
              <span class="scmp-card__city-name">{{ city.city_name }}</span>
              <span class="scmp-card__city-sub">
                {{ city.state.toUpperCase() }}<template v-if="extras(city)?.population"> · {{ formatPop(extras(city)!.population!) }}</template>
              </span>
            </li>
          </ul>

          <div class="scmp-card__footer">
            <span class="scmp-card__meta">{{ c.cities.length }} cities · Saved {{ formatSaved(c.created_at) }}</span>
            <button
              v-if="isOwnPage"
              class="scmp-card__delete"
              :disabled="removingId === c.id"
              :aria-label="`Delete comparison: ${c.cities.map((city) => city.city_name).join(' vs ')}`"
              @click.stop="handleRemove(c)"
            >
              <span class="mdi mdi-trash-can-outline"></span>
              <span class="scmp-card__delete-text">Delete</span>
            </button>
          </div>
        </article>
      </div>
    </template>

    <button class="scmp-page__mobile-back" aria-label="Back" @click="router.back()">
      <span class="mdi mdi-arrow-left"></span>
    </button>
  </div>
</template>

<style scoped>
:deep(.site-header) {
  margin-bottom: 0;
  padding-bottom: 8px;
}

.scmp-page {
  min-height: 100vh;
  padding: 0 0 60px;
}

.scmp-page__mobile-back {
  position: fixed;
  right: 18px;
  bottom: 18px;
  width: 54px;
  height: 54px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border-card));
  border-radius: 18px;
  background: color-mix(in srgb, var(--bg-card) 94%, transparent);
  color: var(--accent);
  display: none;
  align-items: center;
  justify-content: center;
  box-shadow: var(--card-shadow);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  z-index: 30;
}

.scmp-page__mobile-back .mdi {
  font-size: 1.2rem;
}

/* ── Heading ─────────────────────────────────────────── */
.scmp-page__heading {
  padding: 4px 32px 16px;
  max-width: 1440px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.scmp-page__title {
  font-size: 1.8rem;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.03em;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
}

.scmp-page__title-icon {
  color: var(--accent);
  font-size: 1.5rem;
}

/* ── Empty states ────────────────────────────────────── */
.scmp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 60vh;
  padding: 0 24px;
  text-align: center;
}

.scmp-empty__icon {
  font-size: 3rem;
  color: var(--accent);
  opacity: 0.35;
}

.scmp-empty__text {
  margin: 0;
  font-size: 1rem;
  color: var(--text-secondary);
  font-weight: 600;
}

.scmp-empty__hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.scmp-empty__cta {
  margin-top: 6px;
  padding: 9px 20px;
  border: none;
  border-radius: 100px;
  background: var(--accent);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease;
}

.scmp-empty__cta:hover {
  background: var(--accent-hover);
}

/* ── Size filter ─────────────────────────────────────── */
.scmp-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 1440px;
  margin: 0 auto 18px;
  padding: 0 80px;
}

.scmp-filters__chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border: 1px solid var(--border-card);
  border-radius: 100px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.scmp-filters__chip:hover {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border-card));
  color: var(--text-primary);
}

.scmp-filters__chip--active,
.scmp-filters__chip--active:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.scmp-filters__count {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  opacity: 0.75;
}

/* ── Grid ────────────────────────────────────────────── */
.scmp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  padding: 0 80px;
  max-width: 1440px;
  margin: 0 auto;
}

/* ── Card ────────────────────────────────────────────── */
.scmp-card {
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 16px;
  cursor: pointer;
  transition: box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease;
}

.scmp-card:hover {
  box-shadow: var(--card-shadow-hover), 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent);
  transform: translateY(-2px);
}

.scmp-card:focus-visible,
.scmp-filters__chip:focus-visible,
.scmp-card__delete:focus-visible,
.scmp-empty__cta:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.scmp-card--removing {
  opacity: 0.45;
  pointer-events: none;
}

/* ── Photo mosaic ────────────────────────────────────── */
/* --seam is the gutter between photos (the card shows through it); --slant is how far a
   diagonal seam travels horizontally from top to bottom. Hovering the card pulls the photos
   apart slightly. */
.scmp-mosaic {
  --seam: 4px;
  --slant: 48px;
  position: relative;
  height: 232px;
  border-radius: 10px;
  overflow: hidden;
}

.scmp-card:hover .scmp-mosaic,
.scmp-card:focus-visible .scmp-mosaic {
  --seam: 10px;
}

.scmp-mosaic__panel {
  position: relative;
  min-width: 0;
  overflow: hidden;
  background: var(--slot-color);
}

.scmp-mosaic__photo {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
transition: transform 0.5s ease;
}

.scmp-card:hover .scmp-mosaic__photo {
  transform: scale(1.04);
}

/* Slot-colored wash rising from the bottom edge: ties each photo to its city's color in the
   list below and keeps the letter readable over bright skies. */
.scmp-mosaic__panel::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, color-mix(in srgb, var(--slot-color) 70%, #000) 0%, transparent 42%);
  opacity: 0.75;
  pointer-events: none;
}

.scmp-mosaic__panel--loading .scmp-mosaic__photo {
  background: linear-gradient(135deg, color-mix(in srgb, var(--slot-color) 78%, #000), var(--slot-color));
  animation: scmp-shimmer 1.6s ease-in-out infinite alternate;
}

@keyframes scmp-shimmer {
  from { filter: brightness(0.85); }
  to   { filter: brightness(1.1); }
}

.scmp-mosaic__letter {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 1;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--slot-color) 55%, rgba(0, 0, 0, 0.35));
  backdrop-filter: blur(6px);
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1;
  padding-bottom: 2px;
  color: #fff;
}

/* 2 and 3 cities (and the fallback strip): a row of photos cut by parallel diagonal seams.
   Each photo overlaps the one before it by the slant width and is clipped to a
   parallelogram, so the seams stay a constant --seam wide from top to bottom. */
.scmp-mosaic--duo,
.scmp-mosaic--trio,
.scmp-mosaic--strip {
  display: flex;
}

.scmp-mosaic--trio {
  --slant: 36px;
}

.scmp-mosaic--strip {
  --slant: 0px;
}

.scmp-mosaic--duo .scmp-mosaic__panel,
.scmp-mosaic--trio .scmp-mosaic__panel,
.scmp-mosaic--strip .scmp-mosaic__panel {
  flex: 1 1 0;
  clip-path: polygon(var(--slant) 0, 100% 0, calc(100% - var(--slant)) 100%, 0 100%);
  transition: margin 0.3s ease;
}

.scmp-mosaic--duo .scmp-mosaic__panel + .scmp-mosaic__panel,
.scmp-mosaic--trio .scmp-mosaic__panel + .scmp-mosaic__panel,
.scmp-mosaic--strip .scmp-mosaic__panel + .scmp-mosaic__panel {
  margin-left: calc(var(--seam) - var(--slant));
}

.scmp-mosaic--duo .scmp-mosaic__panel:first-child,
.scmp-mosaic--trio .scmp-mosaic__panel:first-child,
.scmp-mosaic--strip .scmp-mosaic__panel:first-child {
  clip-path: polygon(0 0, 100% 0, calc(100% - var(--slant)) 100%, 0 100%);
}

.scmp-mosaic--duo .scmp-mosaic__panel:last-of-type,
.scmp-mosaic--trio .scmp-mosaic__panel:last-of-type,
.scmp-mosaic--strip .scmp-mosaic__panel:last-of-type {
  clip-path: polygon(var(--slant) 0, 100% 0, 100% 100%, 0 100%);
}

/* The slant eats the bottom-left corner of every photo after the first; nudge the letter
   clear of it. */
.scmp-mosaic--duo .scmp-mosaic__panel + .scmp-mosaic__panel .scmp-mosaic__letter,
.scmp-mosaic--trio .scmp-mosaic__panel + .scmp-mosaic__panel .scmp-mosaic__letter {
  left: 18px;
}

.scmp-mosaic__vs {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 2;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-style: italic;
  font-size: 1rem;
  transform: translate(-50%, -50%);
}

/* 4 cities: a 2x2 block. */
.scmp-mosaic--quad {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: var(--seam);
  transition: gap 0.3s ease;
}

/* ── City list ───────────────────────────────────────── */
.scmp-card__cities {
  display: grid;
  grid-template-columns: repeat(var(--city-count), minmax(0, 1fr));
  gap: 12px;
  margin: 14px 0 0;
  padding: 0 2px;
  list-style: none;
}

.scmp-card__city {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-left: 10px;
  border-left: 3px solid var(--slot-color);
}

.scmp-card__city-name {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scmp-card__city-sub {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Footer ──────────────────────────────────────────── */
.scmp-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 30px;
  margin-top: 14px;
  padding: 10px 2px 0;
  border-top: 1px solid var(--border-subtle);
}

.scmp-card__meta {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.scmp-card__delete {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: none;
  border-radius: 100px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.scmp-card__delete:hover {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}

.scmp-card__delete .mdi {
  font-size: 0.95rem;
}

@media (prefers-reduced-motion: reduce) {
  .scmp-card,
  .scmp-mosaic__photo,
  .scmp-mosaic__panel,
  .scmp-mosaic--quad {
    transition: none;
  }

  .scmp-mosaic__panel--loading .scmp-mosaic__photo {
    animation: none;
  }
}

@media (max-width: 900px) {
  .scmp-grid {
    grid-template-columns: minmax(0, 1fr);
    padding: 0 32px;
  }

  .scmp-filters {
    padding: 0 32px;
  }
}

@media (max-width: 640px) {
  :deep(.site-header__search),
  :deep(.site-header__search-spacer),
  :deep(.site-header__search--mobile),
  :deep(.site-header__search-full),
  :deep(.site-header__search-pill) {
    display: none !important;
  }

  :deep(.site-header) {
    padding-bottom: 0;
    margin-bottom: 0;
  }

  .scmp-page__heading {
    padding: 0 16px 14px;
  }

  .scmp-page__title {
    font-size: 1.4rem;
  }

  .scmp-page__heading .breadcrumb {
    display: none;
  }

  .scmp-filters {
    padding: 0 16px;
    margin-bottom: 14px;
  }

  .scmp-grid {
    gap: 16px;
    padding: 0 16px;
  }

  .scmp-mosaic {
    --slant: 28px;
    height: 168px;
  }

  .scmp-mosaic--trio {
    --slant: 22px;
  }

  .scmp-mosaic__vs {
    width: 36px;
    height: 36px;
    font-size: 0.85rem;
  }

  .scmp-mosaic__letter {
    font-size: 1.2rem;
  }

  /* Three or four names don't fit side by side on a phone. */
  .scmp-card__cities {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 12px;
  }

  .scmp-card:hover {
    box-shadow: none;
    transform: none;
  }

  .scmp-card:hover .scmp-mosaic {
    --seam: 4px;
  }

  .scmp-card:hover .scmp-mosaic__photo {
    transform: none;
  }

  .scmp-page__mobile-back {
    display: inline-flex;
  }
}
</style>
