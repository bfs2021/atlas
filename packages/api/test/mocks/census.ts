import { http, HttpResponse } from "msw";

const ACS5 = "https://api.census.gov/data/:year/acs/acs5";

// Rows as the Census API returns them: NAME, B01003_001E (population), state, place.
export type PlaceRow = [name: string, population: string, stateFips: string, placeCode: string];

// Census place + county-subdivision listing for a state, as fetched by place-resolver.ts.
// County subdivisions come back empty unless given, which is enough for resolving cities.
export function censusPlaces(places: PlaceRow[], countySubdivisions: string[][] = []) {
  return http.get(ACS5, ({ request }) => {
    const geography = new URL(request.url).searchParams.get("for") ?? "";
    if (geography.startsWith("place:")) {
      return HttpResponse.json([["NAME", "B01003_001E", "state", "place"], ...places]);
    }
    if (geography.startsWith("county subdivision:")) {
      return HttpResponse.json([
        ["NAME", "B01003_001E", "state", "county", "county subdivision"],
        ...countySubdivisions,
      ]);
    }
    return undefined; // fall through: unmocked Census queries still fail loudly
  });
}

// Every ACS 5-year request fails with the given status.
export function censusDown(status = 503) {
  return http.get(ACS5, () => new HttpResponse("Service Unavailable", { status }));
}
