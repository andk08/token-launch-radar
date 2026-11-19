# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/andk08/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/andk08/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Which protocol launches next — and what would its token be worth? This radar reads a sealed
snapshot of 758 protocols, prices every pre-token protocol the way the market already prices
live tokens, ranks them by that implied value, and gives a farm plan for each one.

Built for the [make.fun](https://make.fun/r/xp78qg6d) bounty **Build the best token launch
radar** (`token-radar-01`). Referral code: `xp78qg6d`.

## The model (radar-2)

```
implied value = TVL × category multiple × growth × maturity
```

- **Category multiple** — the median market-cap-to-TVL ratio of the live-token protocols in
  the same category (at least three of them), or the median across every live token when the
  category has too few to price against. It is computed from the snapshot at run time: no
  name, category or protocol is ever given a number by hand.
- **Growth** — the protocol's seven-day TVL change, clamped to −50%…+100% and weighted 0.6.
- **Maturity** — how long the protocol has run with no token, with diminishing returns
  (square root over four years; an unknown listing date counts as one year).

The board ranks every pre-token protocol that is not a wrapped, staked or bridged product of
a token that already trades, not an exchange, and not a versioned pool. The 40-protocol
watchlist is the floor, never the ceiling: the board adds every other rankable pre-token
protocol below it. Live-token protocols are set aside and shown with the market's own
capitalisation, never mixed into the ranking.

A protocol is shown as pre-token when its DefiLlama record carries no token. The record is
not proof it has none. An implied value is this radar's claim, never make.fun's, and it says
nothing about whether or when a token is issued.

## Farm plans

Each row carries six steps, built from the protocol's own record: its category picks the
action, its TVL tier picks the capital, its age picks the holding time. Every step states
what it costs and how long it takes. Never pay to claim an airdrop.

## Run it

Node.js 22 or later, standard library only — nothing to install.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

`main.ts` writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`
into the output directory. Open `dashboard/index.html` in a browser (it reads `data.js`
beside it) to use the board: search, filter by category or chain, sort, and open a
protocol's detail view for its value breakdown and farm plan.

## Layout

```
main.ts                  the entrypoint: snapshot in, board + dashboard + dossier out
lib/model.ts             the radar-2 model, the farm plans and the board checks
vendor/makefun-board.ts  make.fun's dossier library (vendored, as the kit ships it)
dashboard/               index.html, app.css, app.js — a static page, no network
screenshots/             board, detail view and filtered view
```

## License

MIT. See [LICENSE](LICENSE).
