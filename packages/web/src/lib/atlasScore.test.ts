import { describe, expect, it } from "vitest";
import {
  computeAtlasScore,
  dimTier,
  evaluateOpportunityMatch,
  politicalDimTier,
  rawHousingScore,
  rawIncomeScore,
  scoreTier,
  type ScoreInputs,
} from "./atlasScore";
import {
  DEFAULT_PREFERENCES,
  withDealbreakerToggled,
  type UserPreferences,
} from "../composables/usePreferences";

// ── Helpers ─────────────────────────────────────────────────────────────────────

function inputs(overrides: Partial<ScoreInputs> = {}): ScoreInputs {
  return {
    income: null,
    affordability: null,
    costOfLiving: null,
    profile: null,
    qol: null,
    climate: null,
    airQuality: null,
    lifestyle: null,
    politicalLean: null,
    housing: null,
    ...overrides,
  };
}

function prefs(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return { ...DEFAULT_PREFERENCES, ...overrides };
}

// Sum of the default (non-personalized) weights: affordability 18 (cost_medium), job market 18,
// climate 18, opportunity 10, lifestyle 18, air quality 18 (medium), safety 0, connectivity 18.
const DEFAULT_TOTAL_WEIGHT = 118;

// The non-null dimensions of a breakdown, for "everything else stayed null" assertions.
function scoredDims(breakdown: Record<string, number | null>): string[] {
  return Object.entries(breakdown).filter(([, v]) => v != null).map(([k]) => k);
}

// Builds an industryBreakdown where `matchName` sits at the given 1-based rank, padded with
// filler sectors (unlabeled names, so they never match any opportunity preference).
function sectorsWithMatchAtRank(rank: number, matchName: string, matchShare: number, total = rank) {
  return Array.from({ length: total }, (_, i) => {
    const r = i + 1;
    if (r === rank) return { name: matchName, share: matchShare };
    // Above the match: strictly larger shares; below it: strictly smaller.
    const share = r < rank ? matchShare + (rank - r) * 0.01 : matchShare - (r - rank) * 0.001;
    return { name: `Filler ${r}`, share };
  });
}

// ── Raw (non-personalized) dimension scoring ───────────────────────────────────

describe("computeAtlasScore — raw dimensions (no preferences)", () => {
  it("returns a non-personalized result when no preferences are passed", () => {
    const r = computeAtlasScore(inputs());
    expect(r.isPersonalized).toBe(false);
    expect(r.dealbreakerFailures).toEqual([]);
    expect(r.politicalScore).toBeNull();
  });

  describe("affordability", () => {
    it("averages rent-to-income, local RPP, and 5yr rent growth (all lower-is-better)", () => {
      const best = computeAtlasScore(inputs({
        affordability: { rentToIncomeRatio: 0.15 },
        costOfLiving: { level: "msa", rppIndex: 80 },
        housing: { rentGrowthPct5yr: -5 },
      }));
      expect(best.breakdown.affordability).toBe(100);

      const mid = computeAtlasScore(inputs({
        affordability: { rentToIncomeRatio: 0.375 }, // midpoint of 0.15–0.6
        costOfLiving: { level: "msa", rppIndex: 105 }, // midpoint of 80–130
        housing: { rentGrowthPct5yr: 12.5 }, // midpoint of -5–30
      }));
      expect(mid.breakdown.affordability).toBeCloseTo(50);
    });

    it("ignores a statewide RPP fallback rather than scoring it as local", () => {
      const r = computeAtlasScore(inputs({
        affordability: { rentToIncomeRatio: 0.6 }, // → 0
        costOfLiving: { level: "state", rppIndex: 80 }, // would be 100 if it counted
      }));
      expect(r.breakdown.affordability).toBe(0);
    });
  });

  describe("jobMarket", () => {
    it("weights regional jobs 35%, unemployment 35%, growth 20%, industry diversity 10%", () => {
      const r = computeAtlasScore(inputs({
        income: {
          jobsWithin25Miles: 1_000_000, // log10 = 6 → (6-3)/3.7
          employmentGrowthPct5yr: 5, // → 50
          industryBreakdown: [{ name: "A", share: 0.5 }, { name: "B", share: 0.5 }], // HHI 0.5 → 50
        },
        qol: { unemploymentRate: { value: 0.07 } }, // → 50
      }));
      const regional = (3 / 3.7) * 100;
      expect(r.breakdown.jobMarket).toBeCloseTo(0.35 * regional + 0.35 * 50 + 0.2 * 50 + 0.1 * 50);
    });

    it("renormalizes over whichever signals are present", () => {
      const r = computeAtlasScore(inputs({ qol: { unemploymentRate: { value: 0.02 } } }));
      expect(r.breakdown.jobMarket).toBe(100);
    });

    it("treats zero or missing regional job counts as no signal", () => {
      expect(computeAtlasScore(inputs({ income: { jobsWithin25Miles: 0 } })).breakdown.jobMarket).toBeNull();
      expect(computeAtlasScore(inputs({ income: {} })).breakdown.jobMarket).toBeNull();
    });
  });

  describe("climate", () => {
    it("blends sun + temperature comfort (85%) with hazard risk (15%)", () => {
      const ideal = computeAtlasScore(inputs({
        climate: { avgTempF: 65, sunnyDaysPerYear: 300, hazardRisks: { compositeScore: 0 } },
      }));
      expect(ideal.breakdown.climate).toBeCloseTo(100);

      const hazardOnly = computeAtlasScore(inputs({ climate: { hazardRisks: { compositeScore: 100 } } }));
      expect(hazardOnly.breakdown.climate).toBe(0);

      const mixed = computeAtlasScore(inputs({
        climate: { avgTempF: 85, sunnyDaysPerYear: 200, hazardRisks: { compositeScore: 40 } },
      }));
      // sunny 50, temp deviation 20/40 → 50, hazard 60
      expect(mixed.breakdown.climate).toBeCloseTo(0.85 * 50 + 0.15 * 60);
    });

    it("is null when the climate object is missing or has no usable fields", () => {
      expect(computeAtlasScore(inputs({ climate: null })).breakdown.climate).toBeNull();
      expect(computeAtlasScore(inputs({ climate: {} })).breakdown.climate).toBeNull();
    });
  });

  describe("opportunity", () => {
    it("averages poverty rate and labor force participation", () => {
      const r = computeAtlasScore(inputs({
        income: { povertyRate: 3 }, // → 100
        qol: { laborForceParticipationRate: { value: 0.55 } }, // → 0
      }));
      expect(r.breakdown.opportunity).toBe(50);
    });

    // CLAUDE.md says opportunityScore() derives bachelor's+/graduate+ from
    // profile.educationalAttainment, but the code (rawOpportunityScore) deliberately ignores
    // education — see its doc comment. This pins the code's actual behavior; the doc mismatch is
    // flagged in the PR.
    it("does not read profile.educationalAttainment", () => {
      const base = inputs({ income: { povertyRate: 10 }, qol: { laborForceParticipationRate: { value: 0.65 } } });
      const withEducation = {
        ...base,
        profile: {
          educationalAttainment: [
            { label: "Bachelor's degree", share: 0.6 },
            { label: "Graduate degree", share: 0.3 },
          ],
        },
      };
      expect(computeAtlasScore(withEducation).breakdown.opportunity)
        .toBe(computeAtlasScore(base).breakdown.opportunity);
      expect(computeAtlasScore(inputs({ profile: withEducation.profile })).breakdown.opportunity).toBeNull();
    });
  });

  describe("lifestyleVibrancy", () => {
    it("averages restaurant/bar/arts density, commute time, and remote work share", () => {
      const r = computeAtlasScore(inputs({
        lifestyle: {
          restaurants: { perTenThousandResidents: 80 }, // 100
          bars: { perTenThousandResidents: 2 }, // 0
          artsAndCulture: { perTenThousandResidents: 20 }, // 100
        },
        profile: { meanCommuteMinutes: 55, remoteWorkShare: 0.4 }, // 0, 100
      }));
      expect(r.breakdown.lifestyleVibrancy).toBe(60);
    });
  });

  describe("airQuality", () => {
    it("averages median AQI (lower better) and good-day share (higher better)", () => {
      const r = computeAtlasScore(inputs({ airQuality: { medianAqi: 20, goodDaysPercent: 30 } }));
      expect(r.breakdown.airQuality).toBe(50);
      const clean = computeAtlasScore(inputs({ airQuality: { medianAqi: 20, goodDaysPercent: 90 } }));
      expect(clean.breakdown.airQuality).toBe(100);
    });

    it("is null for counties without EPA monitoring", () => {
      expect(computeAtlasScore(inputs({ airQuality: null })).breakdown.airQuality).toBeNull();
    });
  });

  describe("connectivity", () => {
    it("averages airport busyness percentile, airport distance, and transit share", () => {
      const r = computeAtlasScore(inputs({
        qol: {
          airportBusyness: { value: { nationalPercentile: 90 } },
          airportDistanceMiles: { value: 50 }, // → 50
        },
        profile: { transitShare: 0.4 }, // → 100
      }));
      expect(r.breakdown.connectivity).toBeCloseTo(80);
    });
  });

  describe("safety", () => {
    it("is never scored (no safety data source is wired in yet)", () => {
      const full = computeAtlasScore(GOLDEN.denverLike);
      expect(full.breakdown.safety).toBeNull();
      const personalized = computeAtlasScore(GOLDEN.denverLike, prefs({ weight_safety: 90 }));
      expect(personalized.breakdown.safety).toBeNull();
    });
  });
});

// ── Missing data handling ──────────────────────────────────────────────────────

describe("computeAtlasScore — missing data", () => {
  it("excludes null dimensions from the composite instead of treating them as zero", () => {
    const r = computeAtlasScore(inputs({ airQuality: { medianAqi: 20, goodDaysPercent: 90 } }));
    expect(scoredDims(r.breakdown)).toEqual(["airQuality"]);
    // If missing dimensions were zeroed, this would be 100 * 18 / 118 ≈ 15.
    expect(r.score).toBe(100);
    expect(r.dataCoverage).toBeCloseTo(18 / DEFAULT_TOTAL_WEIGHT);
    expect(r.hasEnoughData).toBe(false);
  });

  it("falls back to a neutral 50 with zero coverage when nothing is scorable", () => {
    const r = computeAtlasScore(inputs());
    expect(r.score).toBe(50);
    expect(r.dataCoverage).toBe(0);
    expect(r.hasEnoughData).toBe(false);
    expect(scoredDims(r.breakdown)).toEqual([]);
  });

  it("flags a full data bundle as unreliable when population is under 5,000", () => {
    const small = computeAtlasScore({ ...GOLDEN.denverLike, profile: { ...GOLDEN.denverLike.profile, population: 4_999 } });
    expect(small.dataCoverage).toBe(1);
    expect(small.hasEnoughData).toBe(false);

    const enough = computeAtlasScore({ ...GOLDEN.denverLike, profile: { ...GOLDEN.denverLike.profile, population: 5_000 } });
    expect(enough.hasEnoughData).toBe(true);
  });

  it("requires at least half the possible weight to have data", () => {
    // affordability + job market + climate = 54 / 118 ≈ 0.46 → not enough
    const thin = computeAtlasScore(inputs({
      affordability: { rentToIncomeRatio: 0.3 },
      qol: { unemploymentRate: { value: 0.04 } },
      climate: { avgTempF: 60 },
    }));
    expect(thin.dataCoverage).toBeCloseTo(54 / DEFAULT_TOTAL_WEIGHT);
    expect(thin.hasEnoughData).toBe(false);

    // + air quality = 72 / 118 ≈ 0.61 → enough
    const ok = computeAtlasScore(inputs({
      affordability: { rentToIncomeRatio: 0.3 },
      qol: { unemploymentRate: { value: 0.04 } },
      climate: { avgTempF: 60 },
      airQuality: { goodDaysPercent: 70 },
    }));
    expect(ok.dataCoverage).toBeCloseTo(72 / DEFAULT_TOTAL_WEIGHT);
    expect(ok.hasEnoughData).toBe(true);
  });
});

// ── Clamping ───────────────────────────────────────────────────────────────────

describe("computeAtlasScore — clamping", () => {
  it("clamps out-of-range inputs to 0–100 per dimension", () => {
    const extremeGood = computeAtlasScore(inputs({
      affordability: { rentToIncomeRatio: -1 },
      income: { jobsWithin25Miles: 1e12, povertyRate: -50, employmentGrowthPct5yr: 999 },
      qol: { unemploymentRate: { value: -1 }, laborForceParticipationRate: { value: 5 } },
      climate: { avgTempF: 65, sunnyDaysPerYear: 10_000, hazardRisks: { compositeScore: -100 } },
      airQuality: { medianAqi: -500, goodDaysPercent: 500 },
    }));
    for (const v of Object.values(extremeGood.breakdown)) {
      // wavg() can land a float ulp above 100 (e.g. 100.00000000000001); the composite is rounded.
      if (v != null) expect(v).toBeCloseTo(100);
    }
    expect(extremeGood.score).toBe(100);

    const extremeBad = computeAtlasScore(inputs({
      affordability: { rentToIncomeRatio: 10 },
      income: { jobsWithin25Miles: 1, povertyRate: 500, employmentGrowthPct5yr: -999 },
      qol: { unemploymentRate: { value: 1 }, laborForceParticipationRate: { value: 0 } },
      climate: { avgTempF: -100, sunnyDaysPerYear: 0, hazardRisks: { compositeScore: 500 } },
      airQuality: { medianAqi: 5_000, goodDaysPercent: -10 },
    }));
    for (const v of Object.values(extremeBad.breakdown)) {
      if (v != null) expect(v).toBeCloseTo(0);
    }
    expect(extremeBad.score).toBe(0);
  });

  it("clamps the political match score to 0–100", () => {
    const pro = prefs({ political_lean_preference: "progressive" });
    expect(computeAtlasScore(inputs({ politicalLean: { marginPct: 500 } }), pro).politicalScore).toBe(100);
    expect(computeAtlasScore(inputs({ politicalLean: { marginPct: -500 } }), pro).politicalScore).toBe(0);
    const open = prefs({ political_lean_preference: "open" });
    expect(computeAtlasScore(inputs({ politicalLean: { marginPct: 500 } }), open).politicalScore).toBe(0);
  });

  it("keeps every golden composite inside 0–100", () => {
    for (const bundle of Object.values(GOLDEN)) {
      const { score } = computeAtlasScore(bundle);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

// ── City characteristics ───────────────────────────────────────────────────────

describe("computeAtlasScore — city characteristics", () => {
  it.each([
    ["Desert Heat", { avgTempF: 75, summerAvgHighF: 105, winterAvgLowF: 45, annualPrecipitationInches: 8, freezingDaysPerYear: 5 }],
    ["Mountain Snow", { avgTempF: 51, summerAvgHighF: 90, winterAvgLowF: 20, annualPrecipitationInches: 15, freezingDaysPerYear: 150 }],
    ["Four seasons", { avgTempF: 51, summerAvgHighF: 85, winterAvgLowF: 20, annualPrecipitationInches: 38, freezingDaysPerYear: 120 }],
    ["Warm Winters", { avgTempF: 62, summerAvgHighF: 90, winterAvgLowF: 35, annualPrecipitationInches: 45, freezingDaysPerYear: 20 }],
    ["Tropical Heat", { avgTempF: 76, summerAvgHighF: 90, winterAvgLowF: 60, annualPrecipitationInches: 60, freezingDaysPerYear: 0 }],
    ["Endless Summer", { avgTempF: 65, summerAvgHighF: 80, winterAvgLowF: 48, annualPrecipitationInches: 12, freezingDaysPerYear: 0 }],
    ["Humid Coast", { avgTempF: 66, summerAvgHighF: 85, winterAvgLowF: 42, annualPrecipitationInches: 50, freezingDaysPerYear: 5 }],
    ["Foggy Coast", { avgTempF: 58, summerAvgHighF: 70, winterAvgLowF: 45, annualPrecipitationInches: 22, annualSnowfallInches: 0 }],
    ["Rainy & Cool", { avgTempF: 54, summerAvgHighF: 78, winterAvgLowF: 36, annualPrecipitationInches: 40, annualSnowfallInches: 5, freezingDaysPerYear: 30 }],
  ])("classifies climate as %s", (expected, climate) => {
    expect(computeAtlasScore(inputs({ climate })).cityChars.climate).toBe(expected);
  });

  it("returns no climate characteristic without an annual average temp", () => {
    expect(computeAtlasScore(inputs({ climate: { summerAvgHighF: 90 } })).cityChars.climate).toBeNull();
  });

  it.each([
    [3_000_000, "Major metro job market"],
    [2_999_999, "Large regional job market"],
    [800_000, "Large regional job market"],
    [799_999, "Solid regional job market"],
    [200_000, "Solid regional job market"],
    [199_999, "Small regional job market"],
    [50_000, "Small regional job market"],
    [49_999, "Limited regional job market"],
  ])("classifies %d regional jobs as %s", (jobs, expected) => {
    expect(computeAtlasScore(inputs({ income: { jobsWithin25Miles: jobs } })).cityChars.jobMarket).toBe(expected);
  });

  it("only trusts a local (non-state) RPP for the affordability label", () => {
    const local = computeAtlasScore(inputs({ costOfLiving: { level: "msa", rppIndex: 94 } }));
    expect(local.cityChars.affordability).toBe("Affordable");
    const stateFallback = computeAtlasScore(inputs({
      costOfLiving: { level: "state", rppIndex: 90 },
      affordability: { rentToIncomeRatio: 0.4 },
    }));
    expect(stateFallback.cityChars.affordability).toBe("Expensive");
  });

  it("labels a dominant sector by its friendly name, and no dominant sector as diverse", () => {
    const dominant = computeAtlasScore(inputs({
      income: { industryBreakdown: [{ name: "Professional, Scientific, & Technical Services", share: 0.3 }, { name: "Retail Trade", share: 0.1 }] },
    }));
    expect(dominant.cityChars.opportunity).toBe("Tech & Professional Services");
    const diverse = computeAtlasScore(inputs({
      income: { industryBreakdown: [{ name: "Retail Trade", share: 0.19 }, { name: "Manufacturing", share: 0.18 }] },
    }));
    expect(diverse.cityChars.opportunity).toBe("Diverse economy");
  });

  it("defers to the backend's small-town/rural classification for lifestyle and connectivity", () => {
    const r = computeAtlasScore(inputs({
      lifestyle: { restaurants: { perTenThousandResidents: 60 } },
      profile: { urbanCharacter: "Small Town", transitShare: 0.2, population: 1_500 },
    }));
    expect(r.cityChars.lifestyleVibrancy).toBe("Quiet & suburban");
    expect(r.cityChars.connectivity).toBe("Suburban & drivable");
  });

  it("needs a real transit reading before labeling connectivity", () => {
    const r = computeAtlasScore(inputs({ qol: { airportDistanceMiles: { value: 5 } } }));
    expect(r.cityChars.connectivity).toBeNull();
  });
});

// ── Personalized scoring ───────────────────────────────────────────────────────

describe("computeAtlasScore — personalized", () => {
  const phoenixClimate = { avgTempF: 75, summerAvgHighF: 106, winterAvgLowF: 46, annualPrecipitationInches: 8, freezingDaysPerYear: 3 };

  it("scores a dimension by how well the city's characteristic matches the preference", () => {
    const exact = computeAtlasScore(inputs({ climate: phoenixClimate }), prefs({ climate_preference: ["hot_dry"] }));
    expect(exact.isPersonalized).toBe(true);
    expect(exact.cityChars.climate).toBe("Desert Heat");
    expect(exact.breakdown.climate).toBe(100);

    const mismatch = computeAtlasScore(inputs({ climate: phoenixClimate }), prefs({ climate_preference: ["misty"] }));
    expect(mismatch.breakdown.climate).toBe(15);
  });

  it("takes the best match across multi-select values rather than averaging", () => {
    const warmWinters = { avgTempF: 62, summerAvgHighF: 90, winterAvgLowF: 35, annualPrecipitationInches: 45, freezingDaysPerYear: 20 };
    const r = computeAtlasScore(inputs({ climate: warmWinters }), prefs({ climate_preference: ["hot_dry", "four_seasons"] }));
    expect(r.breakdown.climate).toBe(70); // four_seasons → Warm Winters 70 beats hot_dry → 35
  });

  it("does not score dimensions whose characteristic is unknown", () => {
    const r = computeAtlasScore(inputs({ climate: phoenixClimate }), prefs({ climate_preference: ["hot_dry"] }));
    expect(scoredDims(r.breakdown)).toEqual(["climate"]);
    expect(r.score).toBe(100);
  });

  describe("importance weights shift the composite", () => {
    // Expensive city (RPP 130) with very clean air (80% good days).
    const city = inputs({
      costOfLiving: { level: "msa", rppIndex: 130 },
      airQuality: { goodDaysPercent: 80 },
    });

    it("balances both at medium importance", () => {
      // affordability cost_medium: Expensive → 35 (w18); air medium: Very clean → 100 (w18)
      expect(computeAtlasScore(city, prefs()).score).toBe(Math.round((35 * 18 + 100 * 18) / 36));
    });

    it("drags the score down when cost matters most", () => {
      const r = computeAtlasScore(city, prefs({ affordability_preference: "cost_high", air_quality_priority: "low" }));
      // Expensive → 10 at weight 80; clean air → 100 at weight 8
      expect(r.score).toBe(Math.round((10 * 80 + 100 * 8) / 88));
    });

    it("lifts the score when clean air matters most", () => {
      const r = computeAtlasScore(city, prefs({ affordability_preference: "cost_low", air_quality_priority: "high" }));
      // cost_low treats every tier as 100 at weight 8; clean air 100 at weight 80
      expect(r.score).toBe(100);
    });

    it("honors the importance dial on 'type' dimensions", () => {
      const mixed = inputs({ climate: phoenixClimate, airQuality: { goodDaysPercent: 80 } });
      const base = prefs({ climate_preference: ["misty"] }); // Desert Heat → 15
      const low = computeAtlasScore(mixed, { ...base, weight_climate: 8 }).score;
      const high = computeAtlasScore(mixed, { ...base, weight_climate: 80 }).score;
      expect(low).toBe(Math.round((15 * 8 + 100 * 18) / 26));
      expect(high).toBe(Math.round((15 * 80 + 100 * 18) / 98));
      expect(high).toBeLessThan(low);
    });
  });

  describe("deal breakers", () => {
    const fourSeasons = { avgTempF: 51, summerAvgHighF: 85, winterAvgLowF: 20, annualPrecipitationInches: 38, freezingDaysPerYear: 120 };

    it("caps a failed deal-breaker dimension at 15, flags it, and gives it dominant weight", () => {
      const p = withDealbreakerToggled(prefs({ climate_preference: ["hot_dry"] }), "climate");
      const r = computeAtlasScore(inputs({ climate: fourSeasons, airQuality: { goodDaysPercent: 80 } }), p);
      expect(r.breakdown.climate).toBe(15); // MATCH_SCORES would give 25
      expect(r.dealbreakerFailures).toEqual(["climate"]);
      expect(r.score).toBe(Math.round((15 * 90 + 100 * 18) / 108));
    });

    it("does not fail when the characteristic matches a selected value exactly", () => {
      const p = withDealbreakerToggled(prefs({ climate_preference: ["hot_dry", "four_seasons"] }), "climate");
      const r = computeAtlasScore(inputs({ climate: fourSeasons }), p);
      expect(r.breakdown.climate).toBe(100);
      expect(r.dealbreakerFailures).toEqual([]);
    });

    it("cannot fail on missing data or an 'any' preference", () => {
      const p = withDealbreakerToggled(prefs({ climate_preference: ["hot_dry"] }), "climate");
      expect(computeAtlasScore(inputs(), p).dealbreakerFailures).toEqual([]);
      const anyP = withDealbreakerToggled(prefs(), "climate");
      expect(computeAtlasScore(inputs({ climate: fourSeasons }), anyP).dealbreakerFailures).toEqual([]);
    });

    it("fails opportunity when the user's field ranks 7th or lower", () => {
      const p = withDealbreakerToggled(prefs({ opportunity_preference: ["retail"] }), "opportunity");
      const r = computeAtlasScore(inputs({ income: { industryBreakdown: sectorsWithMatchAtRank(7, "Retail Trade", 0.05) } }), p);
      expect(r.breakdown.opportunity).toBe(15);
      expect(r.dealbreakerFailures).toEqual(["opportunity"]);
    });
  });
});

// ── Political lean ─────────────────────────────────────────────────────────────

describe("computeAtlasScore — political lean (opt-in only)", () => {
  // cost_low → "Affordable" scores 100 at weight 8, giving a fixed anchor dimension.
  const city = (lean: Record<string, unknown>) => inputs({
    costOfLiving: { level: "msa", rppIndex: 90 },
    politicalLean: lean,
  });

  it("is ignored when not personalized", () => {
    const r = computeAtlasScore(city({ marginPct: -40 }));
    expect(r.politicalScore).toBeNull();
  });

  it("is ignored when the preference is 'not_a_factor' (the default)", () => {
    const r = computeAtlasScore(city({ marginPct: -40 }), prefs({ affordability_preference: "cost_low" }));
    expect(r.politicalScore).toBeNull();
    expect(r.score).toBe(100);
  });

  it("scores alignment by signed margin, with a steeper falloff when opposed", () => {
    const margin20 = city({ marginPct: 20 });
    expect(computeAtlasScore(margin20, prefs({ political_lean_preference: "progressive" })).politicalScore).toBe(60);
    expect(computeAtlasScore(margin20, prefs({ political_lean_preference: "conservative" })).politicalScore)
      .toBeCloseTo(50 - 20 / 1.3);
    expect(computeAtlasScore(margin20, prefs({ political_lean_preference: "open" })).politicalScore).toBe(90);
  });

  it("weights county-level data at 8, place-level at 20, and a deal breaker at 90", () => {
    const base = prefs({ affordability_preference: "cost_low", political_lean_preference: "progressive" });
    // politicalScore 60 for margin +20; affordability anchor 100 at weight 8.
    const county = computeAtlasScore(city({ marginPct: 20 }), base);
    expect(county.score).toBe(Math.round((100 * 8 + 60 * 8) / 16));

    const place = computeAtlasScore(city({ marginPct: 20, source: { geographyLevel: "place" } }), base);
    expect(place.score).toBe(Math.round((100 * 8 + 60 * 20) / 28));

    const dealbreaker = computeAtlasScore(city({ marginPct: 20 }), { ...base, weight_safety: 90 });
    expect(dealbreaker.score).toBe(Math.round((100 * 8 + 60 * 90) / 98));
  });

  it("is skipped when the city has no political lean data", () => {
    const r = computeAtlasScore(city({}), prefs({ affordability_preference: "cost_low", political_lean_preference: "progressive" }));
    expect(r.politicalScore).toBeNull();
    expect(r.score).toBe(100);
  });

  // Possible bug, flagged in the PR rather than pinned here: the political-lean deal-breaker flag
  // is stored in weight_safety, and computeAtlasScore also uses weight_safety as the weight of the
  // (always-null) safety dimension. That phantom 90 counts toward maxPossibleWeight, so turning
  // the deal breaker on lowers dataCoverage (and can flip hasEnoughData) even with full data.
  it.todo("political deal breaker should not count a phantom safety weight against dataCoverage");
});

describe("politicalDimTier", () => {
  it("returns null without data or when not a factor", () => {
    expect(politicalDimTier(null, "progressive")).toBeNull();
    expect(politicalDimTier({ marginPct: 10 }, "not_a_factor")).toBeNull();
  });

  it.each([
    [10, "good"], [9.9, "average"], [-5, "average"], [-5.1, "below"], [-20, "below"], [-20.1, "poor"],
  ] as const)("progressive vs margin %d → %s", (margin, tier) => {
    expect(politicalDimTier({ marginPct: margin }, "progressive")).toBe(tier);
    expect(politicalDimTier({ marginPct: -margin }, "conservative")).toBe(tier);
  });

  it.each([
    [0, "good"], [-9.9, "good"], [10, "average"], [24.9, "average"], [25, "below"], [-60, "below"],
  ] as const)("open vs margin %d → %s", (margin, tier) => {
    expect(politicalDimTier({ marginPct: margin }, "open")).toBe(tier);
  });
});

// ── evaluateOpportunityMatch ──────────────────────────────────────────────────

describe("evaluateOpportunityMatch", () => {
  const sectors = [
    { name: "Education, Health, & Social Services", share: 0.30 },
    { name: "Retail Trade", share: 0.16 },
    { name: "Manufacturing", share: 0.14 },
    { name: "Construction", share: 0.10 },
    { name: "Finance, Insurance, & Real Estate", share: 0.08 },
    { name: "Information", share: 0.07 },
    { name: "Public Administration", share: 0.06 },
    { name: "Agriculture, Forestry, & Mining", share: 0.05 },
    { name: "Other Services", share: 0.04 },
  ];
  const income = { industryBreakdown: sectors };

  it("returns null without industry data", () => {
    expect(evaluateOpportunityMatch(["retail"], null)).toBeNull();
    expect(evaluateOpportunityMatch(["retail"], { industryBreakdown: [] })).toBeNull();
  });

  it("gives a full, unannotated match for 'any', no selection, or unknown values", () => {
    const full = { score: 100, tier: "good", matchedLabel: null, matchedRank: null, matchedSharePct: null, cityTopLabel: null, cityTopSharePct: null };
    expect(evaluateOpportunityMatch(["any"], income)).toEqual(full);
    expect(evaluateOpportunityMatch([], income)).toEqual(full);
    expect(evaluateOpportunityMatch(["not_a_real_field"], income)).toEqual(full);
  });

  it("scores a #1 match at 100 without repeating the city's top label", () => {
    expect(evaluateOpportunityMatch(["education_healthcare"], income)).toEqual({
      score: 100, tier: "good",
      matchedLabel: "Education & Healthcare", matchedRank: 1, matchedSharePct: 30,
      cityTopLabel: null, cityTopSharePct: null,
    });
  });

  it.each([
    ["retail", 2, 90, "good"],
    ["manufacturing", 3, 78, "good"],
    ["construction_trades", 4, 65, "average"],
    ["corporate_finance", 5, 60, "average"],
    ["tech_media_pro", 6, 55, "average"],
    ["government_services", 7, 50, "poor"], // Public Administration ranks above Local Services
    ["agriculture", 8, 44, "poor"],
    ["nonprofit", 9, 38, "poor"],
  ] as const)("%s → rank %d, score %d, tier %s", (pref, rank, score, tier) => {
    const r = evaluateOpportunityMatch([pref], income)!;
    expect(r.matchedRank).toBe(rank);
    expect(r.score).toBe(score);
    expect(r.tier).toBe(tier);
    expect(r.cityTopLabel).toBe("Education & Healthcare");
    expect(r.cityTopSharePct).toBe(30);
  });

  it("uses lower rank-2/rank-3 scores when the matched share is small", () => {
    expect(evaluateOpportunityMatch(["retail"], { industryBreakdown: sectorsWithMatchAtRank(2, "Retail Trade", 0.14) })!.score).toBe(82);
    expect(evaluateOpportunityMatch(["retail"], { industryBreakdown: sectorsWithMatchAtRank(2, "Retail Trade", 0.15) })!.score).toBe(90);
    expect(evaluateOpportunityMatch(["retail"], { industryBreakdown: sectorsWithMatchAtRank(3, "Retail Trade", 0.11) })!.score).toBe(72);
    expect(evaluateOpportunityMatch(["retail"], { industryBreakdown: sectorsWithMatchAtRank(3, "Retail Trade", 0.12) })!.score).toBe(78);
  });

  it("floors deep-rank matches at 20", () => {
    expect(evaluateOpportunityMatch(["retail"], { industryBreakdown: sectorsWithMatchAtRank(12, "Retail Trade", 0.02) })!.score).toBe(20);
    expect(evaluateOpportunityMatch(["retail"], { industryBreakdown: sectorsWithMatchAtRank(15, "Retail Trade", 0.02) })!.score).toBe(20);
  });

  it("scores against the best-ranked field across a multi-select", () => {
    const r = evaluateOpportunityMatch(["agriculture", "retail"], income)!;
    expect(r.matchedLabel).toBe("Retail");
    expect(r.matchedRank).toBe(2);
    expect(r.score).toBe(90);
  });

  it("returns a neutral 70 when the field is absent from the city's data", () => {
    expect(evaluateOpportunityMatch(["hospitality_arts"], income)).toEqual({
      score: 70, tier: "average",
      matchedLabel: null, matchedRank: null, matchedSharePct: null,
      cityTopLabel: "Education & Healthcare", cityTopSharePct: 30,
    });
  });

  it("ranks by share regardless of input order", () => {
    const shuffled = { industryBreakdown: [...sectors].reverse() };
    expect(evaluateOpportunityMatch(["retail"], shuffled)!.matchedRank).toBe(2);
  });

  it("feeds the personalized opportunity dimension", () => {
    const r = computeAtlasScore(inputs({ income }), prefs({ opportunity_preference: ["manufacturing"] }));
    expect(r.breakdown.opportunity).toBe(78);
  });
});

// ── Tier boundaries ────────────────────────────────────────────────────────────

describe("dimTier", () => {
  it.each([
    [null, null], [undefined, null],
    [100, "good"], [65, "good"], [64.99, "average"],
    [45, "average"], [44.99, "below"], [0, "below"],
  ] as const)("%s → %s", (value, tier) => {
    expect(dimTier(value)).toBe(tier);
  });
});

describe("scoreTier", () => {
  it.each([
    [100, "Excellent", "excellent"], [80, "Excellent", "excellent"], [79.99, "Good", "good"],
    [65, "Good", "good"], [64.99, "Average", "average"],
    [45, "Average", "average"], [44.99, "Below Average", "below"],
    [30, "Below Average", "below"], [29.99, "Poor", "poor"], [0, "Poor", "poor"],
  ] as const)("%d → %s", (score, label, tier) => {
    expect(scoreTier(score)).toEqual({ label, tier });
  });
});

// ── Compare-page-only subscores ───────────────────────────────────────────────

describe("rawIncomeScore / rawHousingScore", () => {
  it("weights income 70% and poverty 30%", () => {
    expect(rawIncomeScore({ medianHouseholdIncome: 120_000, povertyRate: 30 })).toBeCloseTo(70);
    expect(rawIncomeScore({ medianHouseholdIncome: 75_000 })).toBeCloseTo(50);
    expect(rawIncomeScore(null)).toBeNull();
  });

  it("weights rent burden 45%, home value 30%, local RPP 25%", () => {
    expect(rawHousingScore({ rentBurdenPercent: 0.2 }, { medianHomeValue: 700_000 }, { level: "msa", rppIndex: 105 }))
      .toBeCloseTo(0.45 * 100 + 0.3 * 0 + 0.25 * 50);
    // State-level RPP is excluded, and the remaining weights renormalize.
    expect(rawHousingScore({ rentBurdenPercent: 0.5 }, { medianHomeValue: 100_000 }, { level: "state", rppIndex: 80 }))
      .toBeCloseTo((0.45 * 0 + 0.3 * 100) / 0.75);
    expect(rawHousingScore(null, null, null)).toBeNull();
  });
});

// ── Golden city fixtures ───────────────────────────────────────────────────────
//
// Full, synthetic input bundles loosely modeled on real city archetypes (not live data). Expected
// values were computed from the current algorithm and hand-checked for denverLike; they exist to
// catch unintended scoring drift. If a scoring change is intentional, update the numbers here in
// the same PR and say why.

const GOLDEN = {
  denverLike: inputs({
    income: {
      medianHouseholdIncome: 88_000,
      povertyRate: 11,
      jobsWithin25Miles: 1_500_000,
      employmentGrowthPct5yr: 9,
      industryBreakdown: [
        { name: "Professional, Scientific, & Technical Services", share: 0.22 },
        { name: "Education, Health, & Social Services", share: 0.19 },
        { name: "Retail Trade", share: 0.10 },
        { name: "Arts, Entertainment, & Food Services", share: 0.10 },
        { name: "Finance, Insurance, & Real Estate", share: 0.08 },
        { name: "Construction", share: 0.07 },
        { name: "Transportation & Utilities", share: 0.05 },
        { name: "Manufacturing", share: 0.05 },
        { name: "Information", share: 0.04 },
        { name: "Public Administration", share: 0.04 },
        { name: "Other Services", share: 0.04 },
        { name: "Agriculture, Forestry, & Mining", share: 0.02 },
      ],
    },
    affordability: { rentToIncomeRatio: 0.3, rentBurdenPercent: 0.32 },
    costOfLiving: { level: "msa", rppIndex: 108 },
    housing: { rentGrowthPct5yr: 18, medianHomeValue: 560_000 },
    profile: {
      population: 715_000,
      urbanCharacter: "Urban Core",
      transitShare: 0.06,
      meanCommuteMinutes: 26,
      remoteWorkShare: 0.22,
    },
    qol: {
      unemploymentRate: { value: 0.035 },
      laborForceParticipationRate: { value: 0.72 },
      airportBusyness: { value: { nationalPercentile: 98 } },
      airportDistanceMiles: { value: 24 },
    },
    climate: {
      avgTempF: 51,
      summerAvgHighF: 89,
      winterAvgLowF: 18,
      annualPrecipitationInches: 15,
      annualSnowfallInches: 57,
      freezingDaysPerYear: 155,
      sunnyDaysPerYear: 245,
      hazardRisks: { compositeScore: 35 },
    },
    airQuality: { medianAqi: 48, goodDaysPercent: 55 },
    lifestyle: {
      restaurants: { perTenThousandResidents: 30 },
      bars: { perTenThousandResidents: 8 },
      artsAndCulture: { perTenThousandResidents: 6 },
    },
    politicalLean: { lean: "Strong Democrat", marginPct: 60, source: { geographyLevel: "county" } },
  }),

  phoenixLike: inputs({
    income: {
      medianHouseholdIncome: 72_000,
      povertyRate: 15,
      jobsWithin25Miles: 2_200_000,
      employmentGrowthPct5yr: 12,
      industryBreakdown: [
        { name: "Education, Health, & Social Services", share: 0.21 },
        { name: "Professional, Scientific, & Technical Services", share: 0.13 },
        { name: "Retail Trade", share: 0.12 },
        { name: "Arts, Entertainment, & Food Services", share: 0.10 },
        { name: "Construction", share: 0.09 },
        { name: "Finance, Insurance, & Real Estate", share: 0.09 },
        { name: "Transportation & Utilities", share: 0.07 },
        { name: "Manufacturing", share: 0.07 },
        { name: "Other Services", share: 0.05 },
        { name: "Public Administration", share: 0.04 },
        { name: "Information", share: 0.02 },
        { name: "Agriculture, Forestry, & Mining", share: 0.01 },
      ],
    },
    affordability: { rentToIncomeRatio: 0.29, rentBurdenPercent: 0.33 },
    costOfLiving: { level: "msa", rppIndex: 103 },
    housing: { rentGrowthPct5yr: 28, medianHomeValue: 410_000 },
    profile: {
      population: 1_650_000,
      urbanCharacter: "City",
      transitShare: 0.025,
      meanCommuteMinutes: 26,
      remoteWorkShare: 0.18,
    },
    qol: {
      unemploymentRate: { value: 0.04 },
      laborForceParticipationRate: { value: 0.64 },
      airportBusyness: { value: { nationalPercentile: 96 } },
      airportDistanceMiles: { value: 8 },
    },
    climate: {
      avgTempF: 75,
      summerAvgHighF: 106,
      winterAvgLowF: 46,
      annualPrecipitationInches: 8,
      annualSnowfallInches: 0,
      freezingDaysPerYear: 3,
      sunnyDaysPerYear: 299,
      hazardRisks: { compositeScore: 55 },
    },
    airQuality: { medianAqi: 62, goodDaysPercent: 28 },
    lifestyle: {
      restaurants: { perTenThousandResidents: 22 },
      bars: { perTenThousandResidents: 4 },
      artsAndCulture: { perTenThousandResidents: 3 },
    },
    politicalLean: { lean: "Swing", marginPct: 2, source: { geographyLevel: "county" } },
  }),

  smallTown: inputs({
    income: {
      medianHouseholdIncome: 52_000,
      povertyRate: 19,
      jobsWithin25Miles: 30_000,
      employmentGrowthPct5yr: -2,
      industryBreakdown: [
        { name: "Manufacturing", share: 0.26 },
        { name: "Education, Health, & Social Services", share: 0.22 },
        { name: "Retail Trade", share: 0.13 },
        { name: "Agriculture, Forestry, & Mining", share: 0.09 },
        { name: "Construction", share: 0.08 },
        { name: "Transportation & Utilities", share: 0.06 },
        { name: "Public Administration", share: 0.05 },
        { name: "Arts, Entertainment, & Food Services", share: 0.05 },
        { name: "Other Services", share: 0.04 },
        { name: "Finance, Insurance, & Real Estate", share: 0.02 },
      ],
    },
    affordability: { rentToIncomeRatio: 0.22, rentBurdenPercent: 0.26 },
    costOfLiving: { level: "state", rppIndex: 88 },
    housing: { rentGrowthPct5yr: 9, medianHomeValue: 140_000 },
    profile: {
      population: 8_200,
      urbanCharacter: "Small Town",
      transitShare: 0.004,
      meanCommuteMinutes: 21,
      remoteWorkShare: 0.07,
    },
    qol: {
      unemploymentRate: { value: 0.055 },
      laborForceParticipationRate: { value: 0.58 },
      airportBusyness: { value: { nationalPercentile: 35 } },
      airportDistanceMiles: { value: 70 },
    },
    climate: {
      avgTempF: 48,
      summerAvgHighF: 83,
      winterAvgLowF: 14,
      annualPrecipitationInches: 36,
      annualSnowfallInches: 40,
      freezingDaysPerYear: 150,
      sunnyDaysPerYear: 180,
      hazardRisks: { compositeScore: 25 },
    },
    airQuality: null, // no EPA monitor in county
    lifestyle: {
      restaurants: { perTenThousandResidents: 11 },
      bars: { perTenThousandResidents: 5 },
      artsAndCulture: { perTenThousandResidents: 2 },
    },
    politicalLean: { lean: "Strong Republican", marginPct: -45, source: { geographyLevel: "county" } },
  }),
} satisfies Record<string, ScoreInputs>;

describe("golden city fixtures", () => {
  const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  const snapshot = (r: ReturnType<typeof computeAtlasScore>) => ({
    score: r.score,
    breakdown: Object.fromEntries(Object.entries(r.breakdown).map(([k, v]) => [k, round1(v)])),
    cityChars: r.cityChars,
    dataCoverage: round1(r.dataCoverage),
    hasEnoughData: r.hasEnoughData,
  });

  it("denverLike (raw)", () => {
    expect(snapshot(computeAtlasScore(GOLDEN.denverLike))).toEqual(EXPECTED.denverLike);
  });

  it("phoenixLike (raw)", () => {
    expect(snapshot(computeAtlasScore(GOLDEN.phoenixLike))).toEqual(EXPECTED.phoenixLike);
  });

  it("smallTown (raw)", () => {
    expect(snapshot(computeAtlasScore(GOLDEN.smallTown))).toEqual(EXPECTED.smallTown);
  });

  it("personalized: a progressive, snow-loving tech worker who wants a walkable city", () => {
    const p = prefs({
      climate_preference: ["mountain_snow"],
      affordability_preference: "cost_high",
      job_market_preference: ["growth"],
      lifestyle_preference: ["urban"],
      opportunity_preference: ["tech_media_pro"],
      air_quality_priority: "medium",
      connectivity_preference: ["walkable"],
      political_lean_preference: "progressive",
    });
    const results = Object.fromEntries(
      Object.entries(GOLDEN).map(([name, bundle]) => [name, computeAtlasScore(bundle, p).score]),
    );
    expect(results).toEqual(EXPECTED.personalized);
  });
});

// Computed from the current algorithm; see the GOLDEN comment above. denverLike was hand-checked
// dimension by dimension against the formulas in atlasScore.ts.
const EXPECTED = {
  denverLike: {
    score: 61,
    breakdown: {
      affordability: 48.3, jobMarket: 82.5, climate: 68.2, opportunity: 77.7,
      lifestyleVibrancy: 37.7, airQuality: 56.8, safety: null, connectivity: 61.5,
    },
    cityChars: {
      affordability: "Pricey",
      jobMarket: "Large regional job market",
      climate: "Mountain Snow",
      opportunity: "Tech & Professional Services",
      lifestyleVibrancy: "City energy",
      airQuality: "Generally clean",
      connectivity: "Balanced & accessible",
      politicalLean: "Strong Democrat",
    },
    dataCoverage: 1,
    hasEnoughData: true,
  },
  phoenixLike: {
    score: 55,
    breakdown: {
      affordability: 42.9, jobMarket: 85.5, climate: 80.9, opportunity: 50.3,
      lifestyleVibrancy: 28, airQuality: 29, safety: null, connectivity: 63.1,
    },
    cityChars: {
      affordability: "Moderate",
      jobMarket: "Large regional job market",
      climate: "Desert Heat",
      opportunity: "Education & Healthcare",
      lifestyleVibrancy: "City energy",
      airQuality: "Often unhealthy",
      connectivity: "Balanced & accessible",
      politicalLean: "Swing",
    },
    dataCoverage: 1,
    hasEnoughData: true,
  },
  smallTown: {
    score: 42,
    breakdown: {
      affordability: 72.2, jobMarket: 48.1, climate: 52.7, opportunity: 27.9,
      lifestyleVibrancy: 20.5, airQuality: null, safety: null, connectivity: 21.7,
    },
    cityChars: {
      // State-level RPP is ignored; the label falls back to rent-to-income (0.22).
      affordability: "Affordable",
      jobMarket: "Limited regional job market",
      climate: "Four seasons",
      opportunity: "Manufacturing",
      lifestyleVibrancy: "Quiet & suburban",
      airQuality: null,
      connectivity: "Suburban & drivable",
      politicalLean: "Strong Republican",
    },
    dataCoverage: 0.8, // 100 / 118 without air quality
    hasEnoughData: true,
  },
  // cost_high gives affordability weight 80, so the cheap small town edges out denverLike
  // ("Pricey" → 35) despite missing on climate, lifestyle, and connectivity.
  personalized: { denverLike: 66, phoenixLike: 68, smallTown: 67 },
};
