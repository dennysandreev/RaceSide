export type TeamInformation = {
  slug: string;
  firstEntryYear: number;
  base: string;
  teamPrincipals: string[];
  technicalDirectors: string[];
  chassis: string;
  sourceUrl: string;
};

// Formula1.com team profiles, verified on 2026-10-14. Entry years follow its lineage convention.
const teamInformation2026: TeamInformation[] = [
  {
    slug: "mercedes",
    firstEntryYear: 1970,
    base: "Брэкли, Великобритания",
    teamPrincipals: ["Toto Wolff"],
    technicalDirectors: ["James Allison"],
    chassis: "W17",
    sourceUrl: "https://www.formula1.com/en/teams/mercedes",
  },
  {
    slug: "ferrari",
    firstEntryYear: 1950,
    base: "Маранелло, Италия",
    teamPrincipals: ["Frédéric Vasseur"],
    technicalDirectors: ["Loic Serra", "Enrico Gualtieri"],
    chassis: "SF-26",
    sourceUrl: "https://www.formula1.com/en/teams/ferrari",
  },
  {
    slug: "mclaren",
    firstEntryYear: 1966,
    base: "Уокинг, Великобритания",
    teamPrincipals: ["Andrea Stella"],
    technicalDirectors: ["Peter Prodromou", "Neil Houldey"],
    chassis: "MCL40",
    sourceUrl: "https://www.formula1.com/en/teams/mclaren",
  },
  {
    slug: "red-bull",
    firstEntryYear: 1997,
    base: "Милтон-Кинс, Великобритания",
    teamPrincipals: ["Laurent Mekies"],
    technicalDirectors: ["Pierre Waché"],
    chassis: "RB22",
    sourceUrl: "https://www.formula1.com/en/teams/red-bull-racing",
  },
  {
    slug: "aston-martin",
    firstEntryYear: 2018,
    base: "Сильверстоун, Великобритания",
    teamPrincipals: ["Adrian Newey"],
    technicalDirectors: ["Enrico Cardile"],
    chassis: "AMR26",
    sourceUrl: "https://www.formula1.com/en/teams/aston-martin",
  },
  {
    slug: "alpine",
    firstEntryYear: 1986,
    base: "Энстоун, Великобритания",
    teamPrincipals: ["Flavio Briatore", "Steve Nielsen"],
    technicalDirectors: ["David Sanchez"],
    chassis: "A526",
    sourceUrl: "https://www.formula1.com/en/teams/alpine",
  },
  {
    slug: "racing-bulls",
    firstEntryYear: 1985,
    base: "Фаэнца, Италия",
    teamPrincipals: ["Alan Permane"],
    technicalDirectors: ["Tim Goss"],
    chassis: "VCARB 03",
    sourceUrl: "https://www.formula1.com/en/teams/racing-bulls",
  },
  {
    slug: "haas",
    firstEntryYear: 2016,
    base: "Каннаполис, США",
    teamPrincipals: ["Ayao Komatsu"],
    technicalDirectors: ["Andrea De Zordo"],
    chassis: "VF-26",
    sourceUrl: "https://www.formula1.com/en/teams/haas",
  },
  {
    slug: "williams",
    firstEntryYear: 1978,
    base: "Гроув, Великобритания",
    teamPrincipals: ["James Vowles"],
    technicalDirectors: ["Pat Fry"],
    chassis: "FW48",
    sourceUrl: "https://www.formula1.com/en/teams/williams",
  },
  {
    slug: "audi",
    firstEntryYear: 2026,
    base: "Хинвиль, Швейцария",
    teamPrincipals: ["Mattia Binotto"],
    technicalDirectors: ["James Key"],
    chassis: "R26",
    sourceUrl: "https://www.formula1.com/en/teams/audi",
  },
  {
    slug: "cadillac",
    firstEntryYear: 2026,
    base: "Сильверстоун, Великобритания",
    teamPrincipals: ["Marcin Budkowski"],
    technicalDirectors: ["Nick Chester"],
    chassis: "MAC-26",
    sourceUrl: "https://www.formula1.com/en/teams/cadillac",
  },
];

export function getTeamInformation(slug: string, season: number): TeamInformation | null {
  if (season !== 2026) return null;

  const normalizedSlug = slug.trim().toLowerCase();
  return teamInformation2026.find((team) => team.slug === normalizedSlug) ?? null;
}
