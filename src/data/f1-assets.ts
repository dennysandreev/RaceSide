import type { TeamVisual } from "@/types/racemate";

type CircuitAsset = {
  aliases: string[];
  src: string;
};

type TeamAsset = TeamVisual & {
  aliases: string[];
};

type TeamProfileAsset = {
  aliases: string[];
  carImageUrl: string;
  slug: string;
};

export const LEGACY_F1_ASSET_SEASON = 2026;

const malaysiaCircuitMap = "/f1/circuits/2026/16-malaysia.webp";
const malaysiaCircuitMapVersioned = `${malaysiaCircuitMap}?v=69b864ad6585da55`;
const singaporeCircuitMap = "/f1/circuits/2026/17-singapore.webp";
const singaporeCircuitMapRevision = "8429e12bedf7e73c";

export function getVersionedCircuitMapUrl(url: string): string {
  const localPath = url.split(/[?#]/, 1)[0];
  if (localPath === malaysiaCircuitMap) return malaysiaCircuitMapVersioned;
  if ([singaporeCircuitMap, "/f1/circuits/2026/16-singapore.webp", "/f1/circuits/singapore.webp"].includes(localPath)) {
    return `${localPath}?v=${singaporeCircuitMapRevision}`;
  }
  return url;
}

const circuitAssets = [
  {
    aliases: ["australia", "albert park", "melbourne"],
    src: "/f1/circuits/2026/01-australia.webp",
  },
  {
    aliases: ["china", "shanghai"],
    src: "/f1/circuits/2026/02-china.webp",
  },
  {
    aliases: ["japan", "suzuka"],
    src: "/f1/circuits/2026/03-japan.webp",
  },
  {
    aliases: ["miami", "miami international autodrome"],
    src: "/f1/circuits/2026/04-miami.webp",
  },
  {
    aliases: ["canada", "gilles villeneuve", "montreal"],
    src: "/f1/circuits/2026/05-canada.webp",
  },
  {
    aliases: ["monaco", "monte carlo"],
    src: "/f1/circuits/2026/06-monaco.webp",
  },
  {
    aliases: ["barcelona-catalunya", "barcelona", "catalunya", "circuit de barcelona-catalunya"],
    src: "/f1/circuits/2026/07-barcelona-catalunya.webp",
  },
  {
    aliases: ["spain", "madrid", "madring", "ifema madrid"],
    src: "/f1/circuits/2026/14-spain.webp",
  },
  {
    aliases: ["austria", "red bull ring", "spielberg"],
    src: "/f1/circuits/2026/08-austria.webp",
  },
  {
    aliases: ["great britain", "silverstone", "united kingdom"],
    src: "/f1/circuits/2026/09-great-britain.webp",
  },
  {
    aliases: ["belgium", "spa-francorchamps", "spa"],
    src: "/f1/circuits/2026/10-belgium.webp",
  },
  {
    aliases: ["hungary", "hungaroring", "budapest"],
    src: "/f1/circuits/2026/11-hungary.webp",
  },
  {
    aliases: ["netherlands", "zandvoort"],
    src: "/f1/circuits/2026/12-netherlands.webp",
  },
  {
    aliases: ["italy", "monza"],
    src: "/f1/circuits/2026/13-italy.webp",
  },
  {
    aliases: ["azerbaijan", "baku"],
    src: "/f1/circuits/2026/15-azerbaijan.webp",
  },
  {
    aliases: ["malaysia", "malaysian grand prix", "sepang", "kuala lumpur", "bahrain grand prix in malaysia"],
    src: malaysiaCircuitMapVersioned,
  },
  {
    aliases: ["singapore", "marina bay"],
    src: getVersionedCircuitMapUrl(singaporeCircuitMap),
  },
  {
    aliases: ["united states", "usa", "americas", "austin", "cota"],
    src: "/f1/circuits/2026/18-united-states.webp",
  },
  {
    aliases: ["mexico", "hermanos rodriguez"],
    src: "/f1/circuits/2026/19-mexico.webp",
  },
  {
    aliases: ["brazil", "interlagos", "jose carlos pace", "sao paulo"],
    src: "/f1/circuits/2026/20-brazil.webp",
  },
  {
    aliases: ["las vegas", "las vegas strip"],
    src: "/f1/circuits/2026/21-las-vegas.webp",
  },
  {
    aliases: ["qatar", "losail", "lusail"],
    src: "/f1/circuits/2026/22-qatar.webp",
  },
  {
    aliases: ["abu dhabi", "yas marina", "united arab emirates"],
    src: "/f1/circuits/2026/23-united-arab-emirates.webp",
  },
] satisfies CircuitAsset[];

const teamAssets = [
  {
    name: "Alpine",
    code: "ALP",
    logo: "/f1/teams/logos/2026/alpine.webp",
    color: "#0093CC",
    aliases: ["alpine", "bwt alpine", "alp"],
  },
  {
    name: "Aston Martin",
    code: "AMR",
    logo: "/f1/teams/logos/2026/aston-martin.webp",
    color: "#229971",
    aliases: ["aston martin", "aston martin aramco", "aston martin aramco f1 team", "amr", "ast"],
  },
  {
    name: "Audi",
    code: "AUD",
    logo: "/f1/teams/logos/2026/audi.webp",
    color: "#D71920",
    aliases: ["audi", "sauber", "kick sauber", "stake", "aud"],
  },
  {
    name: "Cadillac",
    code: "CAD",
    logo: "/f1/teams/logos/2026/cadillac.webp",
    color: "#B98B2F",
    aliases: ["cadillac", "cad"],
  },
  {
    name: "Ferrari",
    code: "FER",
    logo: "/f1/teams/logos/2026/ferrari.webp",
    color: "#E8002D",
    aliases: ["ferrari", "scuderia ferrari", "fer"],
  },
  {
    name: "Haas",
    code: "HAS",
    logo: "/f1/teams/logos/2026/haas.webp",
    color: "#B6BABD",
    aliases: ["haas", "haas f1 team", "moneygram haas", "tgr haas", "has", "haa"],
  },
  {
    name: "McLaren",
    code: "MCL",
    logo: "/f1/teams/logos/2026/mclaren.webp",
    color: "#FF8000",
    aliases: ["mclaren", "mclaren mercedes", "mcl"],
  },
  {
    name: "Mercedes",
    code: "MER",
    logo: "/f1/teams/logos/2026/mercedes.webp",
    color: "#27F4D2",
    aliases: ["mercedes", "mercedes-amg", "mercedes amg", "mer"],
  },
  {
    name: "Racing Bulls",
    code: "RB",
    logo: "/f1/teams/logos/2026/rb.webp",
    color: "#6692FF",
    aliases: ["racing bulls", "rb f1 team", "rb", "rbx", "visa cash app rb", "vcarb", "racingbulls"],
  },
  {
    name: "Red Bull Racing",
    code: "RBR",
    logo: "/f1/teams/logos/2026/red-bull.webp",
    color: "#3671C6",
    aliases: ["red bull", "red bull racing", "oracle red bull racing", "rbr", "red"],
  },
  {
    name: "Williams",
    code: "WIL",
    logo: "/f1/teams/logos/2026/williams.webp",
    color: "#64C4FF",
    aliases: ["williams", "atlansian williams", "williams racing", "wil"],
  },
] satisfies TeamAsset[];

const teamProfileAssets = [
  { aliases: ["mercedes", "mer"], carImageUrl: "/f1/teams/cars/2026/mercedes.webp", slug: "mercedes" },
  { aliases: ["ferrari", "fer"], carImageUrl: "/f1/teams/cars/2026/ferrari.webp", slug: "ferrari" },
  { aliases: ["mclaren", "mcl"], carImageUrl: "/f1/teams/cars/2026/mclaren.webp", slug: "mclaren" },
  { aliases: ["red bull", "red bull racing", "red"], carImageUrl: "/f1/teams/cars/2026/red-bull.webp", slug: "red-bull" },
  { aliases: ["alpine", "alpine f1 team", "alp"], carImageUrl: "/f1/teams/cars/2026/alpine.webp", slug: "alpine" },
  { aliases: ["racing bulls", "rb f1 team", "rbx"], carImageUrl: "/f1/teams/cars/2026/rb.webp", slug: "racing-bulls" },
  { aliases: ["haas", "haas f1 team", "haa"], carImageUrl: "/f1/teams/cars/2026/haas.webp", slug: "haas" },
  { aliases: ["williams", "wil"], carImageUrl: "/f1/teams/cars/2026/williams.webp", slug: "williams" },
  { aliases: ["audi", "aud"], carImageUrl: "/f1/teams/cars/2026/audi.webp", slug: "audi" },
  { aliases: ["aston martin", "ast", "amr"], carImageUrl: "/f1/teams/cars/2026/aston-martin.webp", slug: "aston-martin" },
  { aliases: ["cadillac", "cadillac f1 team", "cad"], carImageUrl: "/f1/teams/cars/2026/cadillac.webp", slug: "cadillac" },
] satisfies TeamProfileAsset[];

export function getCircuitAsset(
  circuitNameOrExternalId?: string | null,
  season = LEGACY_F1_ASSET_SEASON,
) {
  if (!circuitNameOrExternalId || season !== LEGACY_F1_ASSET_SEASON) {
    return null;
  }

  const normalized = normalizeAssetKey(circuitNameOrExternalId);

  return (
    circuitAssets.find((asset) =>
      asset.aliases.some((alias) => normalized.includes(normalizeAssetKey(alias))),
    ) ?? null
  );
}

export function getTeamAsset(
  teamNameOrCode?: string | null,
  season = LEGACY_F1_ASSET_SEASON,
): TeamVisual | null {
  if (!teamNameOrCode || season !== LEGACY_F1_ASSET_SEASON) {
    return null;
  }

  const normalized = normalizeAssetKey(teamNameOrCode);
  const match = teamAssets.find((asset) =>
    asset.aliases.some((alias) => matchesTeamAlias(normalized, normalizeAssetKey(alias))),
  );

  if (!match) {
    return null;
  }

  return {
    name: match.name,
    code: match.code,
    logo: match.logo,
    color: match.color,
  };
}

export function getTeamProfileAsset(
  teamNameOrCode?: string | null,
  season = LEGACY_F1_ASSET_SEASON,
) {
  if (!teamNameOrCode || season !== LEGACY_F1_ASSET_SEASON) {
    return null;
  }

  const normalized = normalizeAssetKey(teamNameOrCode);

  return (
    teamProfileAssets.find((asset) =>
      asset.aliases.some((alias) => normalized === normalizeAssetKey(alias)),
    ) ?? null
  );
}

type DriverTeamLookup = {
  driver?: string | null;
  team?: string | null;
  teamCode?: string | null;
  teamColor?: string | null;
  teamLogo?: string | null;
};

export function getTeamAssetForDriver(
  driverName?: string | null,
  rows: DriverTeamLookup[] = [],
): TeamVisual | null {
  if (!driverName) {
    return null;
  }

  const normalizedDriver = normalizeAssetKey(driverName);
  const match = rows.find((row) => {
    const normalizedRowDriver = normalizeAssetKey(row.driver ?? "");

    return (
      normalizedRowDriver === normalizedDriver ||
      normalizedRowDriver.includes(normalizedDriver) ||
      normalizedDriver.includes(normalizedRowDriver)
    );
  });

  if (!match) {
    return null;
  }

  return (
    getTeamAsset(match.teamCode) ??
    getTeamAsset(match.team) ?? {
      name: match.team ?? driverName,
      code: match.teamCode ?? undefined,
      logo: match.teamLogo ?? undefined,
      color: match.teamColor ?? undefined,
    }
  );
}

export function getTeamAssetForMarketOutcome(
  outcomeName?: string | null,
  rows: DriverTeamLookup[] = [],
): TeamVisual | null {
  return getTeamAsset(outcomeName) ?? getTeamAssetForDriver(outcomeName, rows);
}

export function getTeamMatchNames() {
  const names = new Set<string>();

  teamAssets.forEach((asset) => {
    names.add(asset.name);

    if (asset.code) {
      names.add(asset.code);
    }

    asset.aliases.forEach((alias) => names.add(alias));
  });

  return [...names];
}

export function getSeasonDriverAvatarPath(season: number, driverSlug: string) {
  return `/drivers/avatars/${season}/${toAssetSlug(driverSlug)}.webp`;
}

export function getSeasonTeamCarPath(season: number, constructorId: string) {
  return `/f1/teams/cars/${season}/${toAssetSlug(constructorId)}.webp`;
}

export function getSeasonTeamLogoPath(season: number, constructorId: string) {
  return `/f1/teams/logos/${season}/${toAssetSlug(constructorId)}.webp`;
}

export function getSeasonCircuitPath(
  season: number,
  round: number,
  eventSlug: string,
) {
  return `/f1/circuits/${season}/${String(round).padStart(2, "0")}-${toAssetSlug(eventSlug)}.webp`;
}

function toAssetSlug(value: string) {
  return normalizeAssetKey(value).replaceAll(" ", "-");
}

function normalizeAssetKey(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchesTeamAlias(normalizedValue: string, normalizedAlias: string) {
  if (normalizedValue === normalizedAlias) {
    return true;
  }

  if (normalizedAlias.includes(" ") || normalizedAlias.length > 3) {
    return normalizedValue.includes(normalizedAlias);
  }

  return normalizedValue.split(" ").includes(normalizedAlias);
}
