import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_COMPARE_CITIES,
  barWidth,
  bestIndex,
  buildCompareGroups,
  buildCompareUrl,
  buildKeyDifferences,
  cityLabel,
  deltaVsFirst,
  leaderTally,
  loadCompareCity,
  parseCompareCitiesParam,
  rankCells,
  slugToDisplay,
  type CompareCell,
  type CompareCityBundle,
  type CompareRow,
} from "./compare";
import { worstIndex } from "./compareMetrics";
import { computeAtlasScore } from "./atlasScore";
import { DEFAULT_PREFERENCES } from "../composables/usePreferences";

// loadCompareCity fans out to every API client; stub them so no test touches the network.
const api = vi.hoisted(() => ({
  fetchCity: vi.fn(),
  fetchIncome: vi.fn(),
  fetchDetailedIncome: vi.fn(),
  fetchHousing: vi.fn(),
  fetchAffordability: vi.fn(),
  fetchDetailedAffordability: vi.fn(),
  fetchDetailedQualityOfLife: vi.fn(),
  fetchDetailedCityProfile: vi.fn(),
  fetchClimate: vi.fn(),
  fetchAirQuality: vi.fn(),
  fetchCostOfLiving: vi.fn(),
  fetchLifestyle: vi.fn(),
  fetchPoliticalLean: vi.fn(),
  fetchCityPhoto: vi.fn(),
}));
vi.mock("../api/cities", () => ({ fetchCity: api.fetchCity }));
vi.mock("../api/income", () => ({ fetchIncome: api.fetchIncome, fetchDetailedIncome: api.fetchDetailedIncome }));
vi.mock("../api/housing", () => ({ fetchHousing: api.fetchHousing }));
vi.mock("../api/affordability", () => ({
  fetchAffordability: api.fetchAffordability,
  fetchDetailedAffordability: api.fetchDetailedAffordability,
}));
vi.mock("../api/qualityOfLife", () => ({ fetchDetailedQualityOfLife: api.fetchDetailedQualityOfLife }));
vi.mock("../api/cityProfile", () => ({ fetchDetailedCityProfile: api.fetchDetailedCityProfile }));
vi.mock("../api/climate", () => ({ fetchClimate: api.fetchClimate }));
vi.mock("../api/airQuality", () => ({ fetchAirQuality: api.fetchAirQuality }));
vi.mock("../api/costOfLiving", () => ({ fetchCostOfLiving: api.fetchCostOfLiving }));
vi.mock("../api/lifestyle", () => ({ fetchLifestyle: api.fetchLifestyle }));
vi.mock("../api/politicalLean", () => ({ fetchPoliticalLean: api.fetchPoliticalLean }));
vi.mock("./cityPhotos", () => ({ fetchCityPhoto: api.fetchCityPhoto }));

const cell = (value: number | null): CompareCell => ({ value, display: String(value), note: null });
const cells = (...values: Array<number | null>) => values.map(cell);

function bundle(overrides: Partial<CompareCityBundle> = {}): CompareCityBundle {
  const dim = { char: null, tier: null };
  return {
    state: "co", city: "denver", name: "Denver", county: "Denver County", population: 715_000, photoUrl: null,
    atlasScore: null, personalizedAtlasScore: null,
    affordability: dim, jobMarket: dim, climate: dim, opportunity: dim,
    lifestyleVibrancy: dim, airQuality: dim, connectivity: dim,
    medianHouseholdIncome: null, medianRenterIncome: null, povertyRate: null, unemploymentRate: null,
    employmentGrowthPct5yr: null, giniCoefficient: null,
    medianRent: null, medianHomeValue: null, rentBurdenPercent: null, priceToIncomeRatio: null,
    ownerShare: null, rppIndex: null, rppIsStateLevel: false,
    summerAvgHighF: null, winterAvgLowF: null, sunnyDaysPerYear: null, annualPrecipitationInches: null,
    medianAqi: null, aqiCategory: null,
    ...overrides,
  };
}

// ── URL / label helpers ─────────────────────────────────────────────────────────

describe("slugToDisplay / cityLabel", () => {
  it("title-cases hyphenated slugs", () => {
    expect(slugToDisplay("san-luis-obispo")).toBe("San Luis Obispo");
    expect(slugToDisplay("denver")).toBe("Denver");
    expect(slugToDisplay("")).toBe("");
  });

  it("appends the upper-cased state", () => {
    expect(cityLabel("salt-lake-city", "ut")).toBe("Salt Lake City, UT");
  });
});

describe("buildCompareUrl / parseCompareCitiesParam", () => {
  it("builds /compare with no cities", () => {
    expect(buildCompareUrl([])).toBe("/compare");
  });

  it("joins state-city pairs with underscores and lower-cases the state", () => {
    expect(buildCompareUrl([{ state: "CO", city: "denver" }, { state: "ca", city: "san-luis-obispo" }]))
      .toBe("/compare/co-denver_ca-san-luis-obispo");
  });

  it("round-trips multi-word city slugs", () => {
    const refs = [{ state: "ca", city: "san-luis-obispo" }, { state: "ut", city: "salt-lake-city" }];
    const param = buildCompareUrl(refs).replace("/compare/", "");
    expect(parseCompareCitiesParam(param)).toEqual(refs);
  });

  it("caps the list at MAX_COMPARE_CITIES", () => {
    const param = ["co-a", "co-b", "co-c", "co-d", "co-e"].join("_");
    expect(parseCompareCitiesParam(param)).toHaveLength(MAX_COMPARE_CITIES);
  });

  it("drops malformed pairs and ignores missing/array params", () => {
    expect(parseCompareCitiesParam("CO-denver_bogus_-x")).toEqual([{ state: "co", city: "denver" }]);
    expect(parseCompareCitiesParam(undefined)).toEqual([]);
    expect(parseCompareCitiesParam(["co-denver"])).toEqual([]);
  });
});

// ── Rank / bar / delta math ─────────────────────────────────────────────────────

describe("rankCells", () => {
  it("ranks highest first for 'higher' and lowest first for 'lower'", () => {
    expect(rankCells(cells(10, 30, 20), "higher")).toEqual([3, 1, 2]);
    expect(rankCells(cells(10, 30, 20), "lower")).toEqual([1, 3, 2]);
  });

  it("gives tied values the same (competition-style) rank", () => {
    expect(rankCells(cells(50, 50, 40, 60), "higher")).toEqual([2, 2, 4, 1]);
  });

  it("leaves null cells unranked", () => {
    expect(rankCells(cells(null, 5, null, 7), "higher")).toEqual([null, 2, null, 1]);
    expect(rankCells(cells(null, null), "higher")).toEqual([null, null]);
  });
});

describe("bestIndex / worstIndex", () => {
  it("finds the best and worst slots", () => {
    expect(bestIndex(cells(10, 30, 20), "higher")).toBe(1);
    expect(worstIndex(cells(10, 30, 20), "higher")).toBe(0);
    expect(bestIndex(cells(10, 30, 20), "lower")).toBe(0);
    expect(worstIndex(cells(10, 30, 20), "lower")).toBe(1);
  });

  it("picks the first slot on a tie for best", () => {
    expect(bestIndex(cells(30, 30, 10), "higher")).toBe(0);
  });

  it("returns null when nothing is ranked, or when best and worst coincide", () => {
    expect(bestIndex(cells(null, null), "higher")).toBeNull();
    expect(worstIndex(cells(null, null), "higher")).toBeNull();
    expect(worstIndex(cells(5, null), "higher")).toBeNull();
    expect(worstIndex(cells(5, 5), "higher")).toBeNull();
  });
});

describe("barWidth", () => {
  it("is value/max for 'higher' metrics", () => {
    const row = cells(50, 100, null);
    expect(barWidth(row[0], row, "higher")).toBe(0.5);
    expect(barWidth(row[1], row, "higher")).toBe(1);
    expect(barWidth(row[2], row, "higher")).toBe(0);
  });

  it("is min/value for 'lower' metrics so the lowest draws fullest", () => {
    const row = cells(1000, 2000);
    expect(barWidth(row[0], row, "lower")).toBe(1);
    expect(barWidth(row[1], row, "lower")).toBe(0.5);
  });

  it("handles zeros without dividing by zero", () => {
    expect(barWidth(cell(0), cells(0, 0), "higher")).toBe(0);
    expect(barWidth(cell(0), cells(0, 5), "lower")).toBe(1);
    expect(barWidth(cell(0), cells(0, 5), "higher")).toBe(0);
  });
});

describe("deltaVsFirst", () => {
  it("classifies improvement by direction", () => {
    expect(deltaVsFirst(cell(120), cell(100), "higher")).toEqual({ fraction: 0.2, klass: "good" });
    expect(deltaVsFirst(cell(120), cell(100), "lower")).toEqual({ fraction: 0.2, klass: "bad" });
    expect(deltaVsFirst(cell(80), cell(100), "lower")).toEqual({ fraction: -0.2, klass: "good" });
  });

  it("treats gaps under 2% as flat", () => {
    expect(deltaVsFirst(cell(101.9), cell(100), "higher")?.klass).toBe("flat");
    expect(deltaVsFirst(cell(102), cell(100), "higher")?.klass).toBe("good");
  });

  it("returns null for missing values or a zero baseline", () => {
    expect(deltaVsFirst(cell(null), cell(100), "higher")).toBeNull();
    expect(deltaVsFirst(cell(5), cell(null), "higher")).toBeNull();
    expect(deltaVsFirst(cell(5), cell(0), "higher")).toBeNull();
  });
});

describe("leaderTally", () => {
  it("counts rank-1 wins per slot, skipping rows with no ranked values", () => {
    const rows = [
      { direction: "higher" as const, cells: cells(1, 2, 3) },
      { direction: "lower" as const, cells: cells(1, 2, 3) },
      { direction: "higher" as const, cells: cells(9, 2, 3) },
      { direction: "higher" as const, cells: cells(null, null, null) },
    ];
    expect(leaderTally(rows, 3)).toEqual([2, 0, 1]);
  });
});

// ── Grouped table ───────────────────────────────────────────────────────────────

describe("buildCompareGroups", () => {
  const groups = buildCompareGroups([
    bundle({
      atlasScore: 72, medianHouseholdIncome: 88_000, unemploymentRate: 0.035, rppIndex: 108,
      summerAvgHighF: 89, climate: { char: "Mountain Snow", tier: "good" },
    }),
    bundle({
      name: "Boise", atlasScore: 64, medianHouseholdIncome: 70_000, rppIndex: 93, rppIsStateLevel: true,
      climate: { char: "Mountain Snow", tier: "average" },
    }),
  ]);
  const row = (key: string) =>
    groups.flatMap((g) => g.rows).find((r) => r.key === key)!;

  it("emits the four groups in order", () => {
    expect(groups.map((g) => g.key)).toEqual(["atlas-score", "income-jobs", "housing-cost", "climate-air"]);
  });

  it("formats values, US-average sublabels, and N/A for missing data", () => {
    const income = row("medianHouseholdIncome") as CompareRow;
    expect(income.kind).toBe("numeric");
    expect(income.subLabel).toBe(`US AVG $${(75149).toLocaleString()}`);
    expect(income.cells.map((c) => c.display)).toEqual([`$${(88000).toLocaleString()}`, `$${(70000).toLocaleString()}`]);

    const unemployment = row("unemploymentRate") as CompareRow;
    expect(unemployment.cells.map((c) => c.display)).toEqual(["3.5%", "N/A"]);
    expect(unemployment.cells[1].note).toBeNull();
  });

  it("labels the Atlas Score row as a subscore with no US average", () => {
    const score = row("atlasScore") as CompareRow;
    expect(score.subLabel).toBe("ATLAS SUBSCORE");
    expect(score.usValue).toBeNull();
    expect(score.ranked).toBe(true);
  });

  it("hides state-level cost of living with an explanatory note", () => {
    const rpp = row("rppIndex") as CompareRow;
    expect(rpp.cells[0]).toEqual({ value: 108, display: "108", note: null });
    expect(rpp.cells[1].value).toBeNull();
    expect(rpp.cells[1].display).toBe("N/A");
    expect(rpp.cells[1].note).toMatch(/state-level/);
  });

  it("marks context metrics as unranked and maps their direction to 'higher'", () => {
    const summer = row("summerAvgHighF") as CompareRow;
    expect(summer.ranked).toBe(false);
    expect(summer.direction).toBe("higher");
    expect((row("medianAqi") as CompareRow).direction).toBe("lower");
  });

  it("appends the 7 dimension characteristic rows (no political lean) to the Atlas Score group", () => {
    const atlas = groups[0];
    expect(atlas.rows.map((r) => r.key)).toEqual([
      "atlasScore", "climate", "affordability", "jobMarket", "lifestyleVibrancy", "opportunity", "airQuality", "connectivity",
    ]);
    expect(row("climate")).toEqual({
      kind: "char", key: "climate", label: "Climate",
      cells: [{ char: "Mountain Snow", tier: "good" }, { char: "Mountain Snow", tier: "average" }],
    });
    expect(groups.slice(1).every((g) => g.rows.every((r) => r.kind === "numeric"))).toBe(true);
  });
});

// ── Key differences ─────────────────────────────────────────────────────────────

describe("buildKeyDifferences", () => {
  it("prompts for a second city when fewer than two are loaded", () => {
    expect(buildKeyDifferences([bundle()])).toEqual([expect.objectContaining({ label: "GET STARTED" })]);
  });

  it("falls back to the prompt when no metric has two values", () => {
    expect(buildKeyDifferences([bundle(), bundle({ name: "Boise" })])).toEqual([
      expect.objectContaining({ label: "GET STARTED" }),
    ]);
  });

  it("reports income gap, cheapest rent, and Atlas Score lead across the extremes", () => {
    const items = buildKeyDifferences([
      bundle({ name: "Denver", medianHouseholdIncome: 88_000, medianRent: 1_800, atlasScore: 61 }),
      bundle({ name: "Boise", medianHouseholdIncome: 70_000, medianRent: 1_400, atlasScore: 66 }),
      bundle({ name: "Austin", medianHouseholdIncome: 92_000, medianRent: null, atlasScore: 58 }),
    ]);
    expect(items).toEqual([
      { label: "INCOME GAP", text: `Austin earns $${(22000).toLocaleString()} more in median household income than Boise.` },
      { label: "HOUSING COST", text: `Boise has the lowest median rent at $${(1400).toLocaleString()}/mo, $400 under Denver.` },
      { label: "OVERALL FIT", text: "Boise posts the top Atlas Score at 66, 8 points clear of Austin." },
    ]);
  });
});

// ── loadCompareCity ────────────────────────────────────────────────────────────

describe("loadCompareCity", () => {
  const data = {
    income: { medianHouseholdIncome: 88_000, medianRenterIncome: 60_000, povertyRate: 11 },
    detailedIncome: {
      medianHouseholdIncome: 88_000, povertyRate: 11, jobsWithin25Miles: 1_500_000,
      employmentGrowthPct5yr: 9, giniCoefficient: 0.46,
      industryBreakdown: [
        { name: "Professional, Scientific, & Technical Services", share: 0.22 },
        { name: "Education, Health, & Social Services", share: 0.19 },
      ],
    },
    housing: { medianRent: 1_800, medianHomeValue: 560_000, rentGrowthPct5yr: 18 },
    affordability: { rentToIncomeRatio: 0.3 },
    detailedAffordability: { rentBurdenPercent: 0.32, priceToIncomeRatio: 6.4 },
    qol: { unemploymentRate: { value: 0.035 }, laborForceParticipationRate: { value: 0.72 } },
    profile: { population: 715_000, ownerShare: 0.5, transitShare: 0.06, urbanCharacter: "Urban Core" },
    climate: { avgTempF: 51, summerAvgHighF: 89, winterAvgLowF: 18, annualPrecipitationInches: 15, freezingDaysPerYear: 155, sunnyDaysPerYear: 245 },
    airQuality: { medianAqi: 48, goodDaysPercent: 55, aqiCategory: "Good" },
    costOfLiving: { level: "msa", rppIndex: 108 },
    lifestyle: { restaurants: { perTenThousandResidents: 30 } },
    politicalLean: { lean: "Strong Democrat", marginPct: 60 },
  };

  beforeEach(() => {
    api.fetchCity.mockResolvedValue({ name: "Denver", county: "Denver County", population: 715_000 });
    api.fetchIncome.mockResolvedValue(data.income);
    api.fetchDetailedIncome.mockResolvedValue(data.detailedIncome);
    api.fetchHousing.mockResolvedValue({ housing: data.housing });
    api.fetchAffordability.mockResolvedValue(data.affordability);
    api.fetchDetailedAffordability.mockResolvedValue(data.detailedAffordability);
    api.fetchDetailedQualityOfLife.mockResolvedValue(data.qol);
    api.fetchDetailedCityProfile.mockResolvedValue(data.profile);
    api.fetchClimate.mockResolvedValue(data.climate);
    api.fetchAirQuality.mockResolvedValue(data.airQuality);
    api.fetchCostOfLiving.mockResolvedValue(data.costOfLiving);
    api.fetchLifestyle.mockResolvedValue(data.lifestyle);
    api.fetchPoliticalLean.mockResolvedValue(data.politicalLean);
    api.fetchCityPhoto.mockResolvedValue("https://example.test/denver.jpg");
  });

  const scoreInputs = () => ({
    income: data.detailedIncome,
    affordability: data.affordability,
    costOfLiving: data.costOfLiving,
    profile: data.profile,
    qol: data.qol,
    climate: data.climate,
    airQuality: data.airQuality,
    lifestyle: data.lifestyle,
    politicalLean: data.politicalLean,
    housing: data.housing,
  });

  it("uses the exact same computeAtlasScore result as the single-city card", async () => {
    const b = await loadCompareCity("co", "denver");
    const expected = computeAtlasScore(scoreInputs());
    expect(b.atlasScore).toBe(expected.score);
    expect(b.personalizedAtlasScore).toBeNull();
    expect(b.climate).toEqual({ char: expected.cityChars.climate, tier: "good" });
    expect(b.affordability.char).toBe("Pricey");
  });

  it("switches to the personalized score when preferences are passed", async () => {
    const prefs = { ...DEFAULT_PREFERENCES, climate_preference: ["hot_dry" as const], political_lean_preference: "conservative" as const };
    const b = await loadCompareCity("co", "denver", prefs);
    const expected = computeAtlasScore(scoreInputs(), prefs);
    expect(b.personalizedAtlasScore).toBe(expected.score);
    expect(b.atlasScore).toBe(expected.score);
    expect(b.climate.tier).toBe("below"); // Mountain Snow vs hot_dry → 40
  });

  it("maps raw metrics and flags state-level cost of living", async () => {
    api.fetchCostOfLiving.mockResolvedValue({ level: "state", rppIndex: 104 });
    const b = await loadCompareCity("co", "denver");
    expect(b).toMatchObject({
      name: "Denver", county: "Denver County", population: 715_000,
      photoUrl: "https://example.test/denver.jpg",
      medianHouseholdIncome: 88_000, medianRenterIncome: 60_000, povertyRate: 11,
      unemploymentRate: 0.035, employmentGrowthPct5yr: 9, giniCoefficient: 0.46,
      medianRent: 1_800, medianHomeValue: 560_000, rentBurdenPercent: 0.32, priceToIncomeRatio: 6.4,
      ownerShare: 0.5, rppIndex: 104, rppIsStateLevel: true,
      summerAvgHighF: 89, winterAvgLowF: 18, medianAqi: 48, aqiCategory: "Good",
    });
  });

  it("tolerates optional endpoints failing", async () => {
    for (const fn of [
      api.fetchDetailedIncome, api.fetchAffordability, api.fetchDetailedAffordability,
      api.fetchDetailedQualityOfLife, api.fetchDetailedCityProfile, api.fetchClimate,
      api.fetchAirQuality, api.fetchCostOfLiving, api.fetchLifestyle, api.fetchPoliticalLean, api.fetchCityPhoto,
    ]) {
      fn.mockRejectedValue(new Error("boom"));
    }
    const b = await loadCompareCity("co", "denver");
    expect(b.photoUrl).toBeNull();
    expect(b.giniCoefficient).toBeNull();
    expect(b.medianRent).toBe(1_800);
    // Falls back to summary income for scoring.
    expect(b.atlasScore).toBe(computeAtlasScore({
      income: data.income, affordability: null, costOfLiving: null, profile: null, qol: null,
      climate: null, airQuality: null, lifestyle: null, politicalLean: null, housing: data.housing,
    }).score);
  });

  it("propagates failures from required endpoints", async () => {
    api.fetchCity.mockRejectedValue(new Error("not found"));
    await expect(loadCompareCity("co", "nowhere")).rejects.toThrow("not found");
  });
});
