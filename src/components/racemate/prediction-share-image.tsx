/* eslint-disable @next/next/no-img-element */
import { RaceSideLogoSvg } from "@/components/racemate/racemate-logo";
import type {
  PredictionShareDriverPick,
  PredictionShareTeamPick,
  PublicPredictionShare,
} from "@/types/racemate";

type PredictionShareImageProps = {
  share: PublicPredictionShare;
  variant: "og" | "story";
};

type ShareHero = {
  accent: string;
  driver: PredictionShareDriverPick | null;
  team: PredictionShareTeamPick | null;
};

const colors = {
  background: "#090909",
  border: "#2a2a2c",
  muted: "#aaa6a3",
  primary: "#e10600",
  surface: "#121214",
  surfaceRaised: "#19191c",
  text: "#f5f4f2",
};

const sansFont = "Geist, Arial, Helvetica, sans-serif";
const monoFont = "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

export function PredictionShareImage({ share, variant }: PredictionShareImageProps) {
  const hero = getShareHero(share);

  return variant === "story"
    ? <PredictionShareFeedImage hero={hero} share={share} />
    : <PredictionShareOgImage hero={hero} share={share} />;
}

function PredictionShareFeedImage({
  hero,
  share,
}: {
  hero: ShareHero;
  share: PublicPredictionShare;
}) {
  const isQualification = share.scope === "qualification";

  return (
    <div
      style={{
        background: colors.background,
        color: colors.text,
        display: "flex",
        flexDirection: "column",
        fontFamily: sansFont,
        height: 1350,
        overflow: "hidden",
        position: "relative",
        width: 1080,
      }}
    >
      <ShareHeader share={share} story />
      <FeedHero hero={hero} share={share} showPick={!isQualification} />
      {isQualification ? (
        <QualificationBoard hero={hero} />
      ) : (
        <RacePredictionBoard hero={hero} share={share} />
      )}
      <AcquisitionFooter story />
    </div>
  );
}

function PredictionShareOgImage({
  hero,
  share,
}: {
  hero: ShareHero;
  share: PublicPredictionShare;
}) {
  const isQualification = share.scope === "qualification";

  return (
    <div
      style={{
        background: colors.background,
        color: colors.text,
        display: "flex",
        flexDirection: "column",
        fontFamily: sansFont,
        height: 630,
        overflow: "hidden",
        position: "relative",
        width: 1200,
      }}
    >
      <ShareHeader share={share} story={false} />
      {isQualification ? (
        <div
          style={{
            display: "flex",
            flex: 1,
            overflow: "hidden",
            padding: "4px 48px 0",
            position: "relative",
          }}
        >
          <HeroAccent accent={hero.accent} story={false} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              position: "relative",
              width: 690,
            }}
          >
            <RaceMeta story={false} />
            <RaceTitle name={share.race.name} story={false} />
            <AuthorLine share={share} story={false} />
            <HeroPick
              driver={hero.driver}
              label="Мой поул"
              position="POLE"
              story={false}
              team={hero.team}
            />
          </div>
          <HeroPortrait hero={hero} story={false} />
        </div>
      ) : (
        <RacePredictionOgContent hero={hero} share={share} />
      )}
      <AcquisitionFooter story={false} />
    </div>
  );
}

function ShareHeader({
  share,
  story,
}: {
  share: PublicPredictionShare;
  story: boolean;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flexShrink: 0,
        height: story ? 114 : 82,
        justifyContent: "space-between",
        padding: story ? "34px 56px 18px" : "24px 48px 12px",
        position: "relative",
      }}
    >
      <ShareLogo compact={!story} />
      <div style={{ alignItems: "center", display: "flex", gap: story ? 18 : 14 }}>
        <span
          style={{
            color: colors.muted,
            fontFamily: monoFont,
            fontSize: story ? 15 : 13,
            fontWeight: 700,
            letterSpacing: story ? 1.8 : 1.4,
          }}
        >
          {formatRaceMeta(share)}
        </span>
        <span
          style={{
            background: colors.primary,
            color: "#fff",
            display: "flex",
            fontFamily: monoFont,
            fontSize: story ? 15 : 13,
            fontWeight: 900,
            letterSpacing: story ? 1.6 : 1.3,
            padding: story ? "10px 13px" : "8px 11px",
          }}
        >
          {share.scope === "qualification" ? "КВАЛИФИКАЦИЯ" : "ГОНКА"}
        </span>
      </div>
    </div>
  );
}

function ShareLogo({ compact }: { compact: boolean }) {
  return (
    <RaceSideLogoSvg
      palette="dark"
      variant={compact ? "horizontal" : "signature"}
      width={compact ? 242 : 324}
    />
  );
}

function FeedHero({
  hero,
  share,
  showPick,
}: {
  hero: ShareHero;
  share: PublicPredictionShare;
  showPick: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexShrink: 0,
        height: 476,
        overflow: "hidden",
        padding: "20px 56px 0",
        position: "relative",
      }}
    >
      <HeroAccent accent={hero.accent} story />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "relative",
          width: 560,
        }}
      >
        <RaceMeta story />
        <RaceTitle name={share.race.name} story />
        <AuthorLine share={share} story />
        {showPick ? (
          <HeroPick
            driver={hero.driver}
            label="Победитель"
            position="P1"
            story
            team={hero.team}
          />
        ) : null}
      </div>
      <HeroPortrait hero={hero} story />
    </div>
  );
}

function RaceMeta({ story }: { story: boolean }) {
  return (
    <span
      style={{
        color: colors.primary,
        display: "flex",
        fontFamily: monoFont,
        fontSize: story ? 16 : 14,
        fontWeight: 900,
        letterSpacing: story ? 2.4 : 1.8,
      }}
    >
      МОЙ ПРОГНОЗ
    </span>
  );
}

function RaceTitle({ name, story }: { name: string; story: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: getRaceTitleFontSize(name, story),
        fontWeight: 900,
        letterSpacing: "-0.04em",
        lineHeight: 0.98,
        marginTop: story ? 13 : 9,
        maxHeight: story ? 118 : 102,
        maxWidth: story ? 545 : 640,
        overflow: "hidden",
      }}
    >
      {truncateText(name, 56)}
    </div>
  );
}

function AuthorLine({
  share,
  story,
}: {
  share: PublicPredictionShare;
  story: boolean;
}) {
  const author = truncateText(share.displayName, story ? 30 : 34);
  const league = share.leagueName ? truncateText(share.leagueName, story ? 30 : 32) : null;

  return (
    <div
      style={{
        color: colors.muted,
        display: "flex",
        flexDirection: "column",
        fontSize: story ? 20 : 16,
        lineHeight: 1.2,
        marginTop: story ? 17 : 12,
      }}
    >
      <span style={{ display: "flex" }}>Прогноз от {author}</span>
      {league ? (
        <span style={{ display: "flex", fontSize: story ? 15 : 13, marginTop: 6 }}>
          Лига «{league}»
        </span>
      ) : null}
    </div>
  );
}

function HeroPick({
  driver,
  label,
  position,
  story,
  team,
}: {
  driver: PredictionShareDriverPick | null;
  label: string;
  position: string;
  story: boolean;
  team: PredictionShareTeamPick | null;
}) {
  const name = getNameParts(driver?.name ?? "Не выбран");
  const driverTeam = driver?.team?.name ?? team?.name ?? "Команда не выбрана";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: story ? 30 : 20,
      }}
    >
      <span
        style={{
          color: colors.muted,
          fontFamily: monoFont,
          fontSize: story ? 14 : 12,
          fontWeight: 700,
          letterSpacing: story ? 2.1 : 1.7,
        }}
      >
        {label.toUpperCase()}
      </span>
      <div style={{ alignItems: "flex-end", display: "flex", gap: story ? 20 : 16, marginTop: story ? 7 : 5 }}>
        <span
          style={{
            color: colors.primary,
            fontFamily: monoFont,
            fontSize: story ? 82 : 58,
            fontWeight: 900,
            letterSpacing: "-0.06em",
            lineHeight: 0.86,
          }}
        >
          {position}
        </span>
        <div style={{ display: "flex", flexDirection: "column", paddingBottom: story ? 3 : 1 }}>
          {name.first ? (
            <span style={{ color: colors.muted, fontSize: story ? 21 : 16, lineHeight: 1 }}>
              {name.first}
            </span>
          ) : null}
          <span
            style={{
              fontSize: getHeroSurnameFontSize(name.last, story),
              fontWeight: 900,
              letterSpacing: "-0.035em",
              lineHeight: 0.95,
              marginTop: name.first ? 3 : 0,
            }}
          >
            {name.last}
          </span>
        </div>
      </div>
      <span style={{ color: colors.muted, display: "flex", fontSize: story ? 17 : 14, marginTop: story ? 10 : 7 }}>
        {truncateText(driverTeam, 30)}
      </span>
    </div>
  );
}

function HeroAccent({ accent, story }: { accent: string; story: boolean }) {
  return (
    <>
      <div
        style={{
          background: withAlpha(accent, story ? 0.18 : 0.2),
          bottom: story ? -110 : -90,
          display: "flex",
          position: "absolute",
          right: story ? -95 : -70,
          top: story ? -55 : -40,
          transform: "skewX(-13deg)",
          width: story ? 505 : 500,
        }}
      />
      <div
        style={{
          background: accent,
          bottom: 0,
          display: "flex",
          opacity: 0.9,
          position: "absolute",
          right: 12,
          top: 0,
          width: story ? 7 : 6,
        }}
      />
    </>
  );
}

function HeroPortrait({ hero, story }: { hero: ShareHero; story: boolean }) {
  const size = story ? 500 : 455;
  const fallback = hero.driver?.number ?? hero.driver?.code ?? hero.team?.code ?? "P1";

  return (
    <div
      style={{
        alignItems: "flex-end",
        bottom: 0,
        display: "flex",
        height: story ? 476 : 450,
        justifyContent: "center",
        overflow: "hidden",
        position: "absolute",
        right: story ? 18 : 35,
        width: story ? 500 : 500,
      }}
    >
      <span
        style={{
          color: withAlpha(hero.accent, 0.18),
          display: "flex",
          fontFamily: monoFont,
          fontSize: story ? 210 : 180,
          fontWeight: 900,
          letterSpacing: "-0.08em",
          lineHeight: 0.8,
          position: "absolute",
          right: story ? 30 : 26,
          top: story ? 48 : 32,
        }}
      >
        {hero.driver?.number ?? hero.driver?.code ?? "01"}
      </span>
      {hero.driver?.avatarUrl ? (
        <img
          alt=""
          height={size}
          src={hero.driver.avatarUrl}
          style={{
            bottom: story ? -16 : -55,
            height: size,
            objectFit: "contain",
            position: "absolute",
            right: story ? -2 : 4,
            width: size,
          }}
          width={size}
        />
      ) : (
        <div
          style={{
            alignItems: "center",
            border: `2px solid ${withAlpha(hero.accent, 0.72)}`,
            color: colors.text,
            display: "flex",
            flexDirection: "column",
            height: story ? 330 : 280,
            justifyContent: "center",
            marginBottom: story ? 28 : 12,
            width: story ? 330 : 280,
          }}
        >
          <span style={{ color: hero.accent, fontFamily: monoFont, fontSize: story ? 112 : 92, fontWeight: 900, lineHeight: 0.9 }}>
            {fallback}
          </span>
          <span style={{ color: colors.muted, fontFamily: monoFont, fontSize: story ? 18 : 15, fontWeight: 700, letterSpacing: 2, marginTop: 18 }}>
            ГЛАВНЫЙ ПИК
          </span>
        </div>
      )}
    </div>
  );
}

function RacePredictionOgContent({
  hero,
  share,
}: {
  hero: ShareHero;
  share: PublicPredictionShare;
}) {
  const grid = Array.from({ length: 10 }, (_, index) => share.picks.top10[index] ?? null);
  const winnerName = getSurname(hero.driver?.name ?? "Не выбран");
  const winnerTeam = hero.driver?.team?.name ?? hero.team?.name ?? "Команда не выбрана";

  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        flexDirection: "column",
        overflow: "hidden",
        padding: "4px 48px 0",
      }}
    >
      <div
        style={{
          alignItems: "center",
          borderBottom: `1px solid ${colors.border}`,
          display: "flex",
          flexShrink: 0,
          height: 116,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 676 }}>
          <RaceMeta story={false} />
          <span
            style={{
              display: "flex",
              fontSize: getOgRaceTitleFontSize(share.race.name),
              fontWeight: 900,
              letterSpacing: "-0.035em",
              lineHeight: 0.98,
              marginTop: 6,
              maxHeight: 66,
              overflow: "hidden",
            }}
          >
            {truncateText(share.race.name, 56)}
          </span>
          <div
            style={{
              alignItems: "center",
              color: colors.muted,
              display: "flex",
              fontSize: 14,
              marginTop: 7,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ display: "flex" }}>
              Прогноз от {truncateText(share.displayName, 28)}
            </span>
            {share.leagueName ? (
              <span style={{ display: "flex", fontSize: 12, marginLeft: 20 }}>
                Лига «{truncateText(share.leagueName, 24)}»
              </span>
            ) : null}
          </div>
        </div>

        <div
          style={{
            background: withAlpha(hero.accent, 0.12),
            borderLeft: `1px solid ${colors.border}`,
            display: "flex",
            height: 116,
            overflow: "hidden",
            position: "relative",
            width: 428,
          }}
        >
          <span
            style={{
              background: hero.accent,
              display: "flex",
              height: 3,
              left: 0,
              position: "absolute",
              right: 0,
              top: 0,
            }}
          />
          <span
            style={{
              color: withAlpha(hero.accent, hero.driver?.avatarUrl ? 0.18 : 0.38),
              display: "flex",
              fontFamily: monoFont,
              fontSize: hero.driver?.avatarUrl ? 78 : 72,
              fontWeight: 900,
              letterSpacing: "-0.08em",
              lineHeight: 0.9,
              position: "absolute",
              right: hero.driver?.avatarUrl ? 8 : 24,
              top: hero.driver?.avatarUrl ? 15 : 25,
            }}
          >
            {hero.driver?.number ?? hero.driver?.code ?? "P1"}
          </span>
          {hero.driver?.avatarUrl ? (
            <img
              alt=""
              height={164}
              src={hero.driver.avatarUrl}
              style={{
                bottom: -28,
                height: 164,
                objectFit: "contain",
                position: "absolute",
                right: -5,
                width: 164,
              }}
              width={164}
            />
          ) : null}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              paddingLeft: 26,
              position: "relative",
              width: 270,
            }}
          >
            <span style={{ color: colors.muted, display: "flex", fontFamily: monoFont, fontSize: 11, fontWeight: 700, letterSpacing: 1.4 }}>
              ПОБЕДИТЕЛЬ
            </span>
            <div style={{ alignItems: "flex-end", display: "flex", marginTop: 5 }}>
              <span style={{ color: hero.accent, display: "flex", fontFamily: monoFont, fontSize: 42, fontWeight: 900, letterSpacing: "-0.05em", lineHeight: 0.9 }}>
                P1
              </span>
              <span style={{ display: "flex", fontSize: getOgWinnerFontSize(winnerName), fontWeight: 900, lineHeight: 0.95, marginLeft: 15, maxWidth: 174, overflow: "hidden", whiteSpace: "nowrap" }}>
                {winnerName}
              </span>
            </div>
            <span style={{ color: colors.muted, display: "flex", fontSize: 12, marginTop: 5, maxWidth: 224, overflow: "hidden", whiteSpace: "nowrap" }}>
              {truncateText(winnerTeam, 34)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, flexDirection: "column", paddingTop: 12 }}>
        <div style={{ alignItems: "baseline", display: "flex", justifyContent: "space-between" }}>
          <span style={{ display: "flex", fontSize: 21, fontWeight: 900, letterSpacing: "-0.025em" }}>
            Мой топ-10
          </span>
          <span style={{ color: colors.muted, display: "flex", fontFamily: monoFont, fontSize: 11, fontWeight: 700, letterSpacing: 1.2 }}>
            ФИНИШНЫЙ ПОРЯДОК
          </span>
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 7 }}>
          <OgStartingGridColumn drivers={grid.slice(0, 5)} heroColor={hero.accent} startIndex={0} />
          <OgStartingGridColumn drivers={grid.slice(5, 10)} heroColor={hero.accent} startIndex={5} />
        </div>

        <span style={{ color: colors.muted, display: "flex", fontFamily: monoFont, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, marginTop: 10 }}>
          КЛЮЧЕВЫЕ ПИКИ
        </span>
        <div style={{ borderTop: `1px solid ${colors.border}`, display: "flex", marginTop: 7 }}>
          <OgSpecialPick
            accent={share.picks.fastestLap?.team?.color ?? hero.accent}
            label="Лучший круг"
            value={getCompactPickName(share.picks.fastestLap?.name ?? "Не выбран")}
          />
          <OgSpecialPick
            accent={share.picks.dnf?.team?.color ?? hero.accent}
            label="Первый сход"
            value={share.picks.dnfKind === "none" ? "Без схода" : getCompactPickName(share.picks.dnf?.name ?? "Не выбран")}
          />
          <OgSpecialPick
            accent={share.picks.topScoringTeam?.color ?? hero.accent}
            label="Команда этапа"
            value={truncateText(share.picks.topScoringTeam?.name ?? "Не выбрана", 20)}
          />
          <OgSpecialPick
            accent={share.picks.fastestPitStopTeam?.color ?? hero.accent}
            label="Быстрый пит-стоп"
            last
            value={truncateText(share.picks.fastestPitStopTeam?.name ?? "Не выбрана", 20)}
          />
        </div>
      </div>
    </div>
  );
}

function OgStartingGridColumn({
  drivers,
  heroColor,
  startIndex,
}: {
  drivers: Array<PredictionShareDriverPick | null>;
  heroColor: string;
  startIndex: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 540 }}>
      {drivers.map((driver, index) => (
        <OgStartingGridRow
          driver={driver}
          heroColor={heroColor}
          key={`${driver?.id ?? "empty"}-og-${startIndex + index}`}
          position={startIndex + index + 1}
        />
      ))}
    </div>
  );
}

function OgStartingGridRow({
  driver,
  heroColor,
  position,
}: {
  driver: PredictionShareDriverPick | null;
  heroColor: string;
  position: number;
}) {
  const accent = normalizeColor(driver?.team?.color ?? heroColor);

  return (
    <div
      style={{
        alignItems: "center",
        borderBottom: `1px solid ${colors.border}`,
        display: "flex",
        height: 35,
        width: "100%",
      }}
    >
      <span style={{ color: position === 1 ? normalizeColor(heroColor) : colors.muted, display: "flex", fontFamily: monoFont, fontSize: 14, fontWeight: 900, width: 35 }}>
        P{position}
      </span>
      <span style={{ background: accent, display: "flex", height: 21, marginRight: 11, width: 3 }} />
      <span style={{ display: "flex", fontSize: Math.min(19, getGridNameFontSize(driver?.name ?? "Не выбран")), fontWeight: 900, lineHeight: 1, maxWidth: 390, overflow: "hidden", whiteSpace: "nowrap" }}>
        {driver ? getSurname(driver.name) : "Не выбран"}
      </span>
      <span style={{ color: colors.muted, display: "flex", fontFamily: monoFont, fontSize: 10, fontWeight: 700, marginLeft: "auto" }}>
        {driver ? getTeamCode(driver.team) : "--"}
      </span>
    </div>
  );
}

function OgSpecialPick({
  accent,
  label,
  last = false,
  value,
}: {
  accent: string | null | undefined;
  label: string;
  last?: boolean;
  value: string;
}) {
  return (
    <div
      style={{
        borderRight: last ? "none" : `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        height: 66,
        justifyContent: "center",
        padding: "0 13px",
        position: "relative",
        width: "25%",
      }}
    >
      <span style={{ background: normalizeColor(accent ?? colors.primary), bottom: 13, display: "flex", left: 0, position: "absolute", top: 13, width: 3 }} />
      <span style={{ color: colors.muted, display: "flex", fontFamily: monoFont, fontSize: 10, fontWeight: 700, letterSpacing: 0.6, whiteSpace: "nowrap" }}>
        {label.toUpperCase()}
      </span>
      <span style={{ display: "flex", fontSize: getOgSpecialValueFontSize(value), fontWeight: 900, lineHeight: 1.05, marginTop: 5, maxWidth: "100%", overflow: "hidden", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

function RacePredictionBoard({
  hero,
  share,
}: {
  hero: ShareHero;
  share: PublicPredictionShare;
}) {
  const grid = Array.from({ length: 10 }, (_, index) => share.picks.top10[index] ?? null);
  const hasTop10Picks = share.picks.top10.length > 0;

  return (
    <div
      style={{
        background: colors.surface,
        borderTop: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        height: 590,
        padding: "27px 56px 0",
        position: "relative",
      }}
    >
      <div style={{ alignItems: "baseline", display: "flex", justifyContent: "space-between" }}>
        <span style={{ display: "flex", fontSize: 25, fontWeight: 900, letterSpacing: "-0.025em" }}>
          Мой топ-10
        </span>
        <span style={{ color: colors.muted, display: "flex", fontFamily: monoFont, fontSize: 13, fontWeight: 700, letterSpacing: 1.4 }}>
          ФИНИШНЫЙ ПОРЯДОК
        </span>
      </div>

      {hasTop10Picks ? (
        <div style={{ display: "flex", gap: 30, marginTop: 15 }}>
          <StartingGridColumn drivers={grid.slice(0, 5)} heroColor={hero.accent} startIndex={0} />
          <StartingGridColumn drivers={grid.slice(5, 10)} heroColor={hero.accent} startIndex={5} />
        </div>
      ) : (
        <EmptyStartingGrid />
      )}

      <span
        style={{
          color: colors.muted,
          display: "flex",
          fontFamily: monoFont,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 1.5,
          marginTop: 21,
        }}
      >
        КЛЮЧЕВЫЕ ПИКИ
      </span>

      <div style={{ borderTop: `1px solid ${colors.border}`, display: "flex", marginTop: 10 }}>
        <SpecialPick
          accent={share.picks.fastestLap?.team?.color ?? hero.accent}
          label="Лучший круг"
          value={share.picks.fastestLap?.name ?? "Не выбран"}
          width="50%"
        />
        <SpecialPick
          accent={share.picks.dnf?.team?.color ?? hero.accent}
          last
          label="Первый сход"
          value={share.picks.dnfKind === "none" ? "Без схода" : share.picks.dnf?.name ?? "Не выбран"}
          width="50%"
        />
      </div>
      <div style={{ borderTop: `1px solid ${colors.border}`, display: "flex" }}>
        <SpecialPick
          accent={share.picks.topScoringTeam?.color ?? hero.accent}
          label="Команда этапа"
          value={share.picks.topScoringTeam?.name ?? "Не выбрана"}
          width="50%"
        />
        <SpecialPick
          accent={share.picks.fastestPitStopTeam?.color ?? hero.accent}
          last
          label="Быстрый пит-стоп"
          value={share.picks.fastestPitStopTeam?.name ?? "Не выбрана"}
          width="50%"
        />
      </div>
    </div>
  );
}

function EmptyStartingGrid() {
  return (
    <div
      style={{
        alignItems: "center",
        borderBottom: `1px solid ${colors.border}`,
        borderTop: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        height: 225,
        justifyContent: "center",
        marginTop: 15,
      }}
    >
      <span style={{ display: "flex", fontSize: 28, fontWeight: 900, letterSpacing: "-0.025em" }}>
        Топ-10 ещё не собран
      </span>
      <span style={{ color: colors.muted, display: "flex", fontSize: 16, marginTop: 10 }}>
        Пики можно дополнить до старта гонки
      </span>
    </div>
  );
}

function StartingGridColumn({
  drivers,
  heroColor,
  startIndex,
}: {
  drivers: Array<PredictionShareDriverPick | null>;
  heroColor: string;
  startIndex: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 469 }}>
      {drivers.map((driver, index) => (
        <StartingGridRow
          driver={driver}
          heroColor={heroColor}
          key={`${driver?.id ?? "empty"}-${startIndex + index}`}
          position={startIndex + index + 1}
        />
      ))}
    </div>
  );
}

function StartingGridRow({
  driver,
  heroColor,
  position,
}: {
  driver: PredictionShareDriverPick | null;
  heroColor: string;
  position: number;
}) {
  const accent = normalizeColor(driver?.team?.color ?? heroColor);

  return (
    <div
      style={{
        alignItems: "center",
        borderBottom: `1px solid ${colors.border}`,
        display: "flex",
        height: 45,
        width: "100%",
      }}
    >
      <span style={{ color: position === 1 ? colors.primary : colors.muted, fontFamily: monoFont, fontSize: 16, fontWeight: 900, width: 43 }}>
        P{position}
      </span>
      <span style={{ background: accent, display: "flex", height: 24, marginRight: 13, width: 3 }} />
      <span style={{ display: "flex", fontSize: getGridNameFontSize(driver?.name ?? "Не выбран"), fontWeight: 900, lineHeight: 1, maxWidth: 315, overflow: "hidden", whiteSpace: "nowrap" }}>
        {driver ? getSurname(driver.name) : "Не выбран"}
      </span>
      <span style={{ color: colors.muted, display: "flex", fontFamily: monoFont, fontSize: 12, fontWeight: 700, marginLeft: "auto" }}>
        {driver ? getTeamCode(driver.team) : "--"}
      </span>
    </div>
  );
}

function SpecialPick({
  accent,
  label,
  last = false,
  value,
  width,
}: {
  accent: string | null | undefined;
  label: string;
  last?: boolean;
  value: string;
  width: string;
}) {
  return (
    <div
      style={{
        borderRight: last ? "none" : `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        height: 66,
        justifyContent: "center",
        padding: "0 16px",
        position: "relative",
        width,
      }}
    >
      <span style={{ background: normalizeColor(accent ?? colors.primary), bottom: 13, display: "flex", left: 0, position: "absolute", top: 13, width: 3 }} />
      <span style={{ color: colors.muted, display: "flex", fontFamily: monoFont, fontSize: 11, fontWeight: 700, letterSpacing: 0.8 }}>
        {label.toUpperCase()}
      </span>
      <span style={{ display: "flex", fontSize: getSpecialValueFontSize(value), fontWeight: 900, lineHeight: 1.05, marginTop: 5, maxWidth: "100%", overflow: "hidden", whiteSpace: "nowrap" }}>
        {getCompactPickName(value)}
      </span>
    </div>
  );
}

function QualificationBoard({ hero }: { hero: ShareHero }) {
  const name = getNameParts(hero.driver?.name ?? "Не выбран");
  const teamName = hero.driver?.team?.name ?? hero.team?.name ?? "Команда не выбрана";

  return (
    <div
      style={{
        background: colors.surface,
        borderTop: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        height: 590,
        overflow: "hidden",
        padding: "46px 56px",
        position: "relative",
      }}
    >
      <span
        style={{
          color: withAlpha(hero.accent, 0.08),
          display: "flex",
          fontFamily: monoFont,
          fontSize: 224,
          fontWeight: 900,
          letterSpacing: "-0.08em",
          lineHeight: 0.82,
          position: "absolute",
          right: 42,
          top: 76,
        }}
      >
        POLE
      </span>
      <span style={{ color: colors.primary, display: "flex", fontFamily: monoFont, fontSize: 15, fontWeight: 900, letterSpacing: 2.2, position: "relative" }}>
        МОЙ ВЫБОР НА ПОУЛ
      </span>
      <div style={{ alignItems: "flex-end", display: "flex", gap: 25, marginTop: 40, position: "relative" }}>
        <span style={{ color: colors.primary, display: "flex", fontFamily: monoFont, fontSize: 108, fontWeight: 900, letterSpacing: "-0.07em", lineHeight: 0.82 }}>
          POLE
        </span>
        <div style={{ display: "flex", flexDirection: "column", paddingBottom: 5 }}>
          {name.first ? <span style={{ color: colors.muted, display: "flex", fontSize: 27 }}>{name.first}</span> : null}
          <span style={{ display: "flex", fontSize: getHeroSurnameFontSize(name.last, true), fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 0.95, marginTop: 5 }}>
            {name.last}
          </span>
        </div>
      </div>
      <div style={{ alignItems: "center", borderTop: `1px solid ${colors.border}`, display: "flex", marginTop: 54, paddingTop: 26, position: "relative" }}>
        <span style={{ background: hero.accent, display: "flex", height: 42, marginRight: 18, width: 5 }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ color: colors.muted, display: "flex", fontFamily: monoFont, fontSize: 12, fontWeight: 700, letterSpacing: 1.2 }}>
            КОМАНДА
          </span>
          <span style={{ display: "flex", fontSize: 24, fontWeight: 900, marginTop: 5 }}>
            {truncateText(teamName, 34)}
          </span>
        </div>
      </div>
      <div
        style={{
          borderTop: `1px solid ${colors.border}`,
          display: "flex",
          flexDirection: "column",
          marginTop: "auto",
          paddingTop: 22,
        }}
      >
        <span style={{ display: "flex", fontSize: 30, fontWeight: 900, letterSpacing: "-0.025em" }}>
          Мой выбор сделан
        </span>
        <span style={{ color: colors.muted, display: "flex", fontSize: 18, marginTop: 8 }}>
          Теперь твой ход
        </span>
      </div>
    </div>
  );
}

function AcquisitionFooter({ story }: { story: boolean }) {
  return (
    <div
      style={{
        alignItems: "center",
        background: colors.primary,
        color: "#fff",
        display: "flex",
        flexShrink: 0,
        height: story ? 170 : 102,
        justifyContent: "space-between",
        padding: story ? "0 56px" : "0 48px",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ display: "flex", fontSize: story ? 42 : 31, fontWeight: 900, letterSpacing: "-0.035em", lineHeight: 1 }}>
          Сможешь точнее?
        </span>
        <span style={{ display: "flex", fontSize: story ? 19 : 15, fontWeight: 700, marginTop: story ? 11 : 7 }}>
          Собери свой прогноз на RaceSide
        </span>
      </div>
      <div style={{ alignItems: "flex-end", display: "flex", flexDirection: "column" }}>
        <span style={{ display: "flex", fontFamily: monoFont, fontSize: story ? 22 : 17, fontWeight: 900 }}>
          raceside.online/fantasy
        </span>
        <span style={{ display: "flex", fontFamily: monoFont, fontSize: story ? 13 : 10, fontWeight: 700, letterSpacing: story ? 1.6 : 1.2, marginTop: story ? 8 : 5, opacity: 0.76 }}>
          СРАВНИ ПИКИ С ДРУЗЬЯМИ
        </span>
      </div>
    </div>
  );
}

function getShareHero(share: PublicPredictionShare): ShareHero {
  const driver = share.scope === "qualification"
    ? share.heroDriver ?? share.picks.pole
    : share.heroDriver
      ?? share.picks.top10[0]
      ?? null;
  const driverTeam = driver?.team
    ? {
        code: driver.team.code,
        color: driver.team.color,
        id: driver.id,
        name: driver.team.name,
      }
    : null;
  const team = driverTeam;
  const accent = normalizeColor(driver?.team?.color ?? share.heroColor ?? colors.primary);

  return { accent, driver, team };
}

function formatRaceMeta(share: PublicPredictionShare) {
  return share.race.round
    ? `${share.race.season} / ЭТАП ${share.race.round}`
    : String(share.race.season);
}

function getRaceTitleFontSize(name: string, story: boolean) {
  const length = Array.from(name).length;

  if (story) {
    if (length > 40) return 43;
    if (length > 28) return 49;
    return 57;
  }

  if (length > 40) return 36;
  if (length > 28) return 42;
  return 49;
}

function getOgRaceTitleFontSize(name: string) {
  const length = Array.from(name).length;

  if (length > 40) return 27;
  if (length > 28) return 31;
  return 35;
}

function getOgWinnerFontSize(name: string) {
  const length = Array.from(name).length;

  if (length > 15) return 22;
  if (length > 11) return 25;
  return 29;
}

function getHeroSurnameFontSize(name: string, story: boolean) {
  const length = Array.from(name).length;

  if (story) {
    if (length > 15) return 37;
    if (length > 11) return 43;
    return 49;
  }

  if (length > 15) return 28;
  if (length > 11) return 33;
  return 38;
}

function getGridNameFontSize(name: string) {
  const length = Array.from(getSurname(name)).length;

  if (length > 15) return 16;
  if (length > 11) return 18;
  return 20;
}

function getSpecialValueFontSize(value: string) {
  const length = Array.from(getCompactPickName(value)).length;

  if (length > 17) return 14;
  if (length > 12) return 16;
  return 18;
}

function getOgSpecialValueFontSize(value: string) {
  const length = Array.from(value).length;

  if (length > 17) return 13;
  if (length > 12) return 15;
  return 17;
}

function getNameParts(name: string) {
  const parts = truncateText(name.trim() || "Не выбран", 34).split(/\s+/);
  const last = parts.pop() ?? "Не выбран";

  return {
    first: parts.join(" "),
    last,
  };
}

function getSurname(name: string) {
  return getNameParts(name).last;
}

function getCompactPickName(value: string) {
  if (value === "Не выбран" || value === "Не выбрана" || value === "Без схода") {
    return value;
  }

  return getSurname(value);
}

function getTeamCode(team: PredictionShareDriverPick["team"]) {
  const explicit = team?.code?.trim();

  if (explicit) {
    return truncateText(explicit.toUpperCase(), 5);
  }

  return team?.name
    ? truncateText(team.name.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase(), 4)
    : "--";
}

function truncateText(value: string, maxLength: number) {
  const characters = Array.from(value.trim());

  return characters.length > maxLength
    ? `${characters.slice(0, Math.max(1, maxLength - 1)).join("")}…`
    : characters.join("");
}

function normalizeColor(value: string) {
  const normalized = value.trim();

  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    return normalized;
  }

  if (/^#[0-9a-f]{3}$/i.test(normalized)) {
    return `#${normalized.slice(1).split("").map((part) => `${part}${part}`).join("")}`;
  }

  return colors.primary;
}

function withAlpha(color: string, alpha: number) {
  const normalized = normalizeColor(color).slice(1);
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red},${green},${blue},${alpha})`;
}
