export const TRACK_MODEL_ALIASES = {
  "yas-marina": [
    "yas marina circuit", "yas marina", "yas_marina", "яс-марина", "яс марина",
    "abu dhabi", "abu-dhabi", "абу-даби", "абу даби", "abu dhabi grand prix", "гран-при абу-даби",
  ],
  qatar: [
    "lusail international circuit", "losail international circuit", "lusail", "losail",
    "qatar", "катар", "лусаил", "лусайл", "лосайл", "qatar grand prix", "гран-при катара",
  ],
  "las-vegas": [
    "las vegas strip circuit", "las vegas", "las-vegas", "лас-вегас", "лас вегас",
    "las vegas grand prix", "гран-при лас-вегаса",
  ],
  interlagos: [
    "interlagos", "интерлагос", "autódromo josé carlos pace", "autodromo jose carlos pace",
    "jose carlos pace", "josé carlos pace", "жозе карлос пасе",
    "são paulo", "sao paulo", "сан-паулу", "сан паулу", "brazil", "бразилия",
    "brazilian grand prix", "гран-при бразилии", "гран-при сан-паулу",
  ],
  mexico: [
    "autódromo hermanos rodríguez", "autodromo hermanos rodriguez", "hermanos rodríguez", "hermanos rodriguez",
    "rodriguez", "mexico city", "mexico", "мехико", "мексика", "эрманос родригес",
    "mexico city grand prix", "mexican grand prix", "гран-при мехико", "гран-при мексики",
  ],
  singapore: [
    "marina bay street circuit", "marina bay", "singapore", "сингапур", "марина-бэй",
    "singapore grand prix", "гран-при сингапура",
  ],
  austin: [
    "circuit of the americas", "cota", "austin", "остин", "united states grand prix",
    "гран-при сша", "гран-при соединенных штатов",
  ],
  sepang: [
    "sepang international circuit", "sepang", "сепанг", "malaysian grand prix",
    "гран-при малайзии", "bahrain grand prix in malaysia", "kuala lumpur", "куала лумпур",
  ],
  baku: [
    "baku city circuit", "baku", "baki", "баку", "azerbaijan grand prix", "гран-при азербайджана",
  ],
  "albert-park": [
    "albert park circuit",
    "albert park grand prix circuit",
    "albert park",
    "melbourne",
    "мельбурн",
    "australian grand prix",
    "гран-при австралии",
  ],
  shanghai: [
    "shanghai international circuit",
    "shanghai circuit",
    "shanghai",
    "шанхай",
    "chinese grand prix",
    "гран-при китая",
  ],
  suzuka: [
    "suzuka international racing course",
    "suzuka circuit",
    "suzuka",
    "сузука",
    "japanese grand prix",
    "гран-при японии",
  ],
  miami: [
    "miami international autodrome",
    "miami autodrome",
    "miami",
    "майами",
    "miami grand prix",
    "гран-при майами",
  ],
  montreal: [
    "circuit gilles-villeneuve",
    "circuit gilles villeneuve",
    "gilles-villeneuve",
    "gilles villeneuve",
    "montreal",
    "монреаль",
    "жиль вильнев",
    "canadian grand prix",
    "гран-при канады",
  ],
  monaco: [
    "circuit de monaco",
    "monaco circuit",
    "monte carlo",
    "monaco",
    "монте-карло",
    "монте карло",
    "монако",
    "monaco grand prix",
    "гран-при монако",
  ],
  monza: [
    "autodromo nazionale monza",
    "autodromo nazionale di monza",
    "monza circuit",
    "monza",
    "монца",
    "italian grand prix",
    "гран-при италии",
  ],
  catalunya: [
    "circuit de barcelona-catalunya",
    "circuit de barcelona catalunya",
    "barcelona-catalunya",
    "barcelona catalunya",
    "barcelona",
    "catalunya",
    "каталунья",
    "барселона",
    "барселона-каталунья",
    "барселона каталунья",
    "barcelona grand prix",
    "гран-при барселоны",
    "montmeló",
    "монтмело",
  ],
  madring: [
    "madring",
    "мадринг",
    "madrid",
    "мадрид",
    "ifema",
    "spanish grand prix",
    "гран-при испании",
  ],
  "red-bull-ring": [
    "red bull ring",
    "ред булл ринг",
    "spielberg",
    "шпильберг",
    "austrian grand prix",
    "гран-при австрии",
  ],
  silverstone: [
    "silverstone circuit",
    "silverstone",
    "сильверстоун",
    "british grand prix",
    "гран-при великобритании",
    "great britain",
    "великобритания",
  ],
  spa: [
    "circuit de spa-francorchamps",
    "circuit de spa francorchamps",
    "spa-francorchamps",
    "spa francorchamps",
    "spa",
    "спа-франкоршам",
    "спа франкоршам",
    "belgian grand prix",
    "гран-при бельгии",
  ],
  hungaroring: [
    "hungaroring",
    "хунгароринг",
    "hungarian grand prix",
    "гран-при венгрии",
    "budapest",
    "будапешт",
  ],
  zandvoort: [
    "circuit zandvoort",
    "zandvoort",
    "зандворт",
    "dutch grand prix",
    "гран-при нидерландов",
    "netherlands",
    "нидерланды",
  ],
} as const;

export type TrackModelId = keyof typeof TRACK_MODEL_ALIASES;

const TRACK_MODEL_IDS = Object.keys(TRACK_MODEL_ALIASES) as TrackModelId[];

export function getThreeDimensionalTrackModelId(circuit: string): TrackModelId | null {
  const normalized = normalizeCircuitName(circuit);

  return TRACK_MODEL_IDS.find((modelId) =>
    TRACK_MODEL_ALIASES[modelId].some((alias) =>
      normalized.includes(normalizeCircuitName(alias)),
    ),
  ) ?? null;
}

export function hasThreeDimensionalTrackModel(circuit: string) {
  return getThreeDimensionalTrackModelId(circuit) !== null;
}

function normalizeCircuitName(value: string) {
  return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
}
