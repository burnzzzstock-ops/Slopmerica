// STUB — owned by the Cast & Feed workstream (replace wholesale).
import type { FeedContext, FeedEventKind, FeedPost } from '../contracts';

/** A post reacting to a game event, or null to stay quiet. rnd() is 0..1. */
export function postFor(kind: FeedEventKind, ctx: FeedContext, rnd: () => number): FeedPost | null {
  const text =
    kind === 'laneAdded' ? `just one more lane bro. ${ctx.road ?? 'the stroad'} is gonna be FINE`
    : kind === 'crash' ? `another wreck on ${ctx.road ?? 'the stroad'} lmao 💀`
    : kind === 'gameStart' ? `welcome to ${ctx.city}. population: ${ctx.population}. vibes: pristine (for now)`
    : `${ctx.city} is so back`;
  return { name: 'Slop Citizen', handle: 'slopcitizen', badge: 'blue', avatar: { bg: '#ff3ea5', emoji: '🐷' }, text, likes: Math.floor(rnd() * 900), reposts: Math.floor(rnd() * 90), views: Math.floor(rnd() * 20000) };
}

/** Background meme chatter when nothing is happening. */
export function ambientPost(ctx: FeedContext, rnd: () => number): FeedPost {
  return postFor('ambient', ctx, rnd)!;
}
