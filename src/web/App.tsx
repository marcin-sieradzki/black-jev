import { Button, FactList, Meter, Section, Stat, Tag, Text } from "@mylder/perron";
import pauseIcon from "@mylder/perron/icons/pause.svg?raw";
import playIcon from "@mylder/perron/icons/play.svg?raw";
import { useState } from "react";
import { formatTotal, handTotal, type Card } from "../engine/cards.js";
import type { Outcome } from "../engine/game.js";
import { money } from "../engine/narrate.js";
import { RULES } from "../engine/rules.js";
import type { HandRecord, State } from "../engine/state.js";
import type { Table } from "./playback.js";
import { useRound, type Status } from "./useRound.js";

function Icon({ svg }: { svg: string }) {
  return <span className="icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

const RED = new Set(["♥", "♦"]);

/** A card. It slides in from the shoe when dealt; `flip` turns it over instead, for the hole card. */
function PlayingCard({ card, flip = false }: { card: Card | null; flip?: boolean }) {
  if (!card) return <span className="card card-back" role="img" aria-label="Face-down card" />;
  return (
    <span
      className={`card${RED.has(card.suit) ? " card-red" : ""}${flip ? " card-flip" : ""}`}
      role="img"
      aria-label={`${card.rank}${card.suit}`}
    >
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{card.suit}</span>
    </span>
  );
}

const OUTCOMES: Record<Outcome, { label: string; color: "success" | "neutral" | "danger" | "warning" }> = {
  blackjack: { label: "Blackjack", color: "success" },
  win: { label: "Win", color: "success" },
  push: { label: "Push", color: "neutral" },
  lose: { label: "Lose", color: "danger" },
  bust: { label: "Bust", color: "danger" },
  surrender: { label: "Surrender", color: "warning" },
};

const STATUS: Record<Status, { label: string; color: "success" | "neutral" | "info" | "danger" }> = {
  connecting: { label: "Sitting down", color: "info" },
  playing: { label: "Playing", color: "success" },
  waiting: { label: "Dealing", color: "info" },
  paused: { label: "Paused", color: "neutral" },
  hidden: { label: "Paused", color: "neutral" },
  offline: { label: "Can't reach the table", color: "danger" },
};

const signed = (amount: number) => `${amount > 0 ? "+" : ""}${money(amount)}`;

/** The words printed on the felt, along an arc under the dealer as on a real table. */
function FeltPrint() {
  return (
    <svg className="felt-print" viewBox="0 0 400 56" aria-hidden="true">
      <path id="felt-arc" d="M 20 14 Q 200 70 380 14" fill="none" />
      <text>
        <textPath href="#felt-arc" startOffset="50%" textAnchor="middle">
          Blackjack pays 3 to 2 · Dealer stands on soft 17
        </textPath>
      </text>
    </svg>
  );
}

function TableView({ table }: { table: Table }) {
  const dealerCards: (Card | null)[] = table.holeHidden && table.dealer.length === 1 ? [table.dealer[0]!, null] : table.dealer;
  const dealerTotal = table.holeHidden ? (table.dealer[0] ? formatTotal(table.dealer) : null) : formatTotal(table.dealer);
  return (
    <div className="felt" data-hands={table.hands.length || 1}>
      <div className="seat seat-dealer">
        <div className="cards">
          {dealerCards.length ? (
            dealerCards.map((card, i) =>
              // The hole card gets a new key when it's turned over, so it flips rather than sliding in.
              i === 1 ? <PlayingCard key={card ? "hole-up" : "hole-down"} card={card} flip /> : <PlayingCard key={i} card={card} />,
            )
          ) : (
            <span className="card card-empty" />
          )}
        </div>
        <Text variant="overline" emphasis="secondary">
          Dealer {dealerTotal ? `· ${dealerTotal}` : ""}
        </Text>
      </div>
      <span className="shoe" aria-hidden="true" />
      <FeltPrint />
      <div className="hands">
        {table.hands.length === 0 && (
          <div className="seat">
            <div className="cards">
              <span className="card card-empty" />
            </div>
            <div className="hand-meta">
              <Text variant="overline" emphasis="secondary">
                Jev
              </Text>
              <Text variant="data" emphasis="tertiary">
                —
              </Text>
            </div>
          </div>
        )}
        {table.hands.map((hand, i) => {
          const outcome = hand.outcome ? OUTCOMES[hand.outcome] : null;
          const bust = handTotal(hand.cards).total > 21;
          return (
            <div key={i} className="seat" data-active={table.active === i || undefined}>
              <div className="cards">
                {hand.cards.map((card, j) => (
                  <PlayingCard key={j} card={card} />
                ))}
              </div>
              <div className="hand-meta">
                <Text variant="overline" emphasis="secondary">
                  {table.hands.length > 1 ? `Jev ${i + 1}` : "Jev"}
                </Text>
                <Text variant="data" color={bust ? "danger" : "neutral"}>
                  {formatTotal(hand.cards)}
                </Text>
                <Text variant="data-sm" emphasis="secondary">
                  {money(hand.bet)}
                </Text>
              </div>
              {outcome && (
                <span className="result pop">
                  <Tag color={outcome.color}>
                    {outcome.label} {signed(hand.net ?? 0)}
                  </Tag>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A small countdown to the next move: the seconds left until it comes. */
function NextMove({ status, nextMoveAt, serverNow }: { status: Status; nextMoveAt: number | null; serverNow: number }) {
  const left = nextMoveAt === null ? null : Math.max(0, nextMoveAt - serverNow);
  const label =
    status === "paused" || status === "hidden" ? "Paused"
    : status === "playing" && left !== null ? `Next move in ${Math.ceil(left / 1000)} s`
    : "Dealing";
  return (
    <Text variant="data-sm" emphasis="secondary" role="timer" aria-live="off">
      {label}
    </Text>
  );
}

function DecisionView({ table }: { table: Table }) {
  const call = table.decision;
  if (!call) {
    return (
      <Section title="Jev's call">
        <Text emphasis="secondary">Jev decides when it's its turn.</Text>
      </Section>
    );
  }
  const { decision } = call;
  const options = Object.entries(decision.probabilities as Record<string, number>).sort(([, a], [, b]) => b - a);
  return (
    <Section
      title={call.kind === "insurance" ? "Jev's call on insurance" : "Jev's call"}
      action={
        decision.source === "typesafe" ? <Tag color="info">TypeSafe API</Tag>
        : decision.fallback ? <Tag color="warning">Stand-in</Tag>
        : <Tag>Stand-in</Tag>
      }
    >
      <div className="decision">
        <span key={`${call.kind}-${call.hand}-${table.hands[call.hand]?.cards.length ?? 0}`} className="pop">
          <Text variant="data-xl">{decision.choice}</Text>
        </span>
        <Stat label="Confidence">{decision.confidence.toFixed(2)}</Stat>
      </div>
      <div className="options">
        {options.map(([option, p]) => (
          <Meter key={option} label={option} value={p * 100} color={option === decision.choice ? "info" : "neutral"} />
        ))}
      </div>
      {decision.fallback && (
        <Text variant="caption" emphasis="secondary">
          The API didn't answer ({decision.fallback}), so the stand-in decided.
        </Text>
      )}
    </Section>
  );
}

function StatsView({ state }: { state: State | null }) {
  if (!state) return null;
  const { stats } = state;
  const edge = stats.wagered ? (stats.net / stats.wagered) * 100 : 0;
  const o = stats.outcomes;
  return (
    <>
      <Section title="Bankroll">
        <Stat label="Jev has">{money(state.bankroll)}</Stat>
        <FactList
          items={[
            { label: "Rounds", value: stats.hands.toLocaleString("en-US") },
            { label: "Net", value: signed(stats.net) },
            { label: "Wagered", value: money(stats.wagered) },
            { label: "Return", value: `${edge >= 0 ? "+" : ""}${edge.toFixed(2)}%` },
            { label: "Peak", value: money(stats.peak) },
            { label: "Low", value: money(stats.trough) },
            { label: "Rebuys", value: String(state.rebuys) },
          ]}
        />
      </Section>
      <Section title="Hands">
        <FactList
          items={[
            { label: "Blackjacks", value: String(o.blackjack) },
            { label: "Wins", value: String(o.win) },
            { label: "Pushes", value: String(o.push) },
            { label: "Losses", value: String(o.lose) },
            { label: "Busts", value: String(o.bust) },
            { label: "Surrenders", value: String(o.surrender) },
          ]}
        />
      </Section>
    </>
  );
}

function cardsText(cards: readonly Card[]) {
  return cards.map((c) => `${c.rank}${c.suit}`).join(" ");
}

function HistoryView({ history }: { history: HandRecord[] }) {
  return (
    <Section
      title="Last rounds"
      action={
        <a className="download" href="/api/history?format=jsonl" download>
          Download all
        </a>
      }
    >
      {history.length === 0 ? (
        <Text emphasis="secondary">No rounds yet.</Text>
      ) : (
        <div className="history-scroll">
          <table className="history">
            <thead>
              <tr>
                <th scope="col">Round</th>
                <th scope="col">Jev</th>
                <th scope="col">Dealer</th>
                <th scope="col">Result</th>
                <th scope="col" className="num">
                  Net
                </th>
                <th scope="col" className="num">
                  Bankroll
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((round) => (
                <tr key={round.id}>
                  <td>{round.id.toLocaleString("en-US")}</td>
                  <td>{round.hands.map((h) => cardsText(h.cards)).join(" | ")}</td>
                  <td>{cardsText(round.dealer)}</td>
                  <td>{round.hands.map((h) => OUTCOMES[h.outcome].label).join(", ")}</td>
                  <td className="num">{signed(round.net)}</td>
                  <td className="num">{money(round.bankroll)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function App() {
  const [paused, setPaused] = useState(false);
  const { status, error, round, table, step, state, history, nextMoveAt, serverNow } = useRound(paused);
  const badge = STATUS[status];

  return (
    <div className="page">
      <header className="top">
        <div>
          <Text variant="heading-lg" render={<h1 />}>
            Black Jev
          </Text>
          <Text emphasis="secondary">
            Jev, TypeSafe AI's decision model, at a {RULES.decks}-deck Blackjack table. It plays only while someone
            watches: one move every {round ? round.stepMs / 1000 : 5} seconds.
          </Text>
        </div>
        <div className="controls">
          <Tag color={badge.color}>{badge.label}</Tag>
          <Button
            variant="outline"
            size="small"
            startIcon={<Icon svg={paused ? playIcon : pauseIcon} />}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </header>
      {error && (
        <Text color="danger" render={<p />}>
          {error} Trying again in a few seconds.
        </Text>
      )}
      {status === "hidden" && (
        <Text emphasis="secondary" render={<p />}>
          Jev waits while this tab is in the background.
        </Text>
      )}

      <div className="arena">
        <div className="round-head">
          <Text variant="heading-sm" render={<h2 />}>
            {round ? `Round ${round.id.toLocaleString("en-US")}` : "Waiting for the first deal"}
          </Text>
          {round && (
            <Text variant="data-sm" emphasis="secondary">
              move {Math.max(step + 1, 1)} of {round.steps.length}
            </Text>
          )}
          <NextMove status={status} nextMoveAt={nextMoveAt} serverNow={serverNow} />
        </div>
        <TableView table={table} />
      </div>

      <main className="layout">
        <div className="main-column">
          <DecisionView table={table} />
          <Section title="This round">
            <ol className="log">
              {table.log.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </Section>
        </div>
        <aside className="side-column">
          <StatsView state={state} />
        </aside>
      </main>
      <HistoryView history={history} />
      <footer>
        <Text variant="caption" emphasis="tertiary">
          Dealer stands on soft 17 · blackjack pays 3:2 · insurance 2:1 · double any two, also after a split · split to
          4 hands · late surrender. Play money only.
        </Text>
      </footer>
    </div>
  );
}
