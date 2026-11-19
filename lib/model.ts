// Token Launch Radar — the value model (radar-2).
//
// One sealed snapshot in, one ranked board out. The board ranks every pre-token protocol the
// snapshot records that is not a wrapped, staked or bridged product of a token that already
// trades and not an exchange: the watchlist is the floor, and the radar adds every other
// rankable pre-token protocol below it. Live-token protocols are never ranked; they are set
// aside and shown with the market's own capitalisation.
//
// The implied value of a protocol is what its token would be worth if the protocol's record
// stayed as it is, priced the way the market already prices live tokens:
//
//   implied = tvl_usd x categoryMultiple x growthMultiplier x maturityMultiplier
//
//   categoryMultiple  The median market-cap-to-TVL ratio of the live-token protocols in the
//                     same category (at least three of them), or the median across every
//                     live-token protocol when the category has too few to price against.
//                     It is computed from this snapshot at run time: no name, no category
//                     and no protocol is ever given a number by hand.
//   growthMultiplier  1 + 0.6 x clamp(change_7d, -50, +100) / 100, floored at 0.5: a
//                     protocol whose TVL grew 100% in a week prices 1.6x, one that fell
//                     50% prices 0.7x.
//   maturityMultiplier 0.65 + 0.35 x sqrt(min(age_days, 1460) / 1460): a protocol that has
//                     run longer with no token is worth more of its base, with diminishing
//                     returns; an unknown listing date counts as 365 days.
//
// A farm plan is built from the protocol's own record too: its category picks the action, its
// TVL tier picks the capital, its age picks the holding time. Every step states what it costs
// and how long it takes.

/** One protocol exactly as the sealed snapshot records it. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants: every number the dashboard prints, none of them per-protocol. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_min: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  min_live_samples: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  growth_min: 0.5,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1460,
  unknown_age_days: 365,
  min_live_samples: 3,
};

export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's "already trading" view carries. */
export const LIVE_ROWS = 24;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    multiple_source: string;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One live-token protocol, shown with the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One board row as the dashboard reads it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  multiple_source: string;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  global_multiple: number;
  multiples: Record<string, number>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why a snapshot cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** The median of a sorted list of numbers. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, or null when the listing date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// The house watchlist's own exclusion rule, applied to every candidate the board ranks: a
// wrapped, staked or bridged product of a token that already trades, an exchange, or a
// versioned pool is not a protocol still waiting on a launch of its own.
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a pre-token protocol may be ranked: not an exchange, bridge, staked or versioned product. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) if (p.name.startsWith(prefix)) return false;
  return true;
}

/**
 * The market's price of one dollar of TVL, per category: the median market-cap-to-TVL ratio of
 * the live-token protocols in that category (at least `minSamples` of them), plus the median
 * across every live-token protocol as the fallback. Computed from the snapshot, never written
 * by hand.
 */
export function categoryMultiples(
  snapshot: Snapshot,
  minSamples: number,
): { byCategory: Map<string, number>; global: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  all.sort((a, b) => a - b);
  const global = median(all);
  const multiples = new Map<string, number>();
  for (const [category, ratios] of byCategory) {
    if (ratios.length < minSamples) continue;
    ratios.sort((a, b) => a - b);
    multiples.set(category, median(ratios));
  }
  return { byCategory: multiples, global };
}

/** The three factors and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: { byCategory: Map<string, number>; global: number },
): {
  implied: number;
  multiple: number;
  multipleSource: string;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const multiple = protocol.category !== null && multiples.byCategory.has(protocol.category)
    ? multiples.byCategory.get(protocol.category)!
    : multiples.global;
  const multipleSource = protocol.category !== null && multiples.byCategory.has(protocol.category)
    ? `median of live ${protocol.category} tokens`
    : 'median of all live tokens';
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = Math.max(model.growth_min, 1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    model.maturity_range * Math.sqrt(Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, multipleSource, growthPct, growthMult, maturityMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model.min_live_samples);
  const chosen = snapshot.protocols.filter(isRankable);
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, multiples);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      category_multiple: round4(s.v.multiple),
      multiple_source: s.v.multipleSource,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(joinStep),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One farm step as a single string: the action, then its cost and its time. */
export function joinStep(step: { text: string; cost: string; time: string }): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page for updates.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, from the protocol's own TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** The holding time, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main farming action, in words a reader can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and leave the deposit earning for the full hold.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm') || c.includes('liquidity manager')) {
    return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the position in range.`;
  }
  if (c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its app.`;
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position on ${chain}.`;
  }
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in an active market on ${chain}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares for the full hold.`;
  }
  if (c.includes('stable') || c.includes('wrapper')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and keep the balance.`;
  }
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it for the full hold.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('payment') || c.includes('card')) {
    return `Spend $${capital} through ${name} on ${chain} across at least three separate transactions.`;
  }
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote in its next governance round.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${name} and use it in one of its native apps.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index on ${chain} and hold the shares.`;
  if (c.includes('otc')) return `Complete one $${capital} trade through ${name} on ${chain} and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly recurring action, so the farm reads as activity, not a single deposit. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return 'Adjust the deposit once a week: add a little, borrow a little against it, then repay, so the position moves.';
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('farm') || c.includes('liquidity manager')) {
    return 'Rebalance the liquidity position once a week and claim any fees or rewards back into the pool.';
  }
  if (c.includes('bridge')) return 'Bridge a small amount through the protocol once a week, alternating direction when the route allows it.';
  if (c.includes('stak') || c.includes('restak')) return 'Restake the staking rewards once a week instead of letting them sit unclaimed.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return 'Close and reopen a small hedged position once a week so the account shows steady trading activity.';
  }
  if (c.includes('prediction')) return 'Settle one market position a week and open the next, keeping a position live at all times.';
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return 'Check the vault allocation once a week and move a small amount between vaults when the mix changes.';
  }
  if (c.includes('stable') || c.includes('wrapper')) return 'Swap a small amount in and out of the stable asset once a week to keep the address active.';
  if (c.includes('rwa')) return 'Check the yield accrual once a week and reinvest the yield into the same asset.';
  if (c.includes('insurance')) return 'Review the cover once a week and renew or top it up before it lapses.';
  if (c.includes('payment') || c.includes('card')) return 'Make at least one payment through the protocol every week.';
  if (c.includes('governance')) return 'Vote on every proposal that opens while the position is held.';
  if (c.includes('chain')) return 'Use one native app on the chain every week with the bridged funds.';
  if (c.includes('index')) return 'Rebalance the index holding once a week when its weights shift.';
  if (c.includes('otc')) return 'Complete one small trade a week through the protocol.';
  return 'Do one qualifying action each week: a deposit, a swap, a vote or a claim, and keep a record of it.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
): { text: string; cost: string; time: string }[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: 'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's "already trading" view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** One board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    multiple_source: row.model.multiple_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot, model.min_live_samples);
  const byCategory: Record<string, number> = {};
  for (const [category, value] of [...multiples.byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    byCategory[category] = round4(value);
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    global_multiple: round4(multiples.global),
    multiples: byCategory,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100 to 4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
