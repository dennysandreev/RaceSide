export type ConfirmedSeasonChampion = {
  season: number;
  name: string;
  driverSlug: string;
};

// Confirmed titles only. Leading the standings does not establish a championship.
const champion2026: ConfirmedSeasonChampion = {
  season: 2026,
  name: "K Antonelli",
  driverSlug: "andrea-kimi-antonelli",
};

export function getConfirmedSeasonChampion(season: number): ConfirmedSeasonChampion | null {
  return season === champion2026.season ? champion2026 : null;
}
