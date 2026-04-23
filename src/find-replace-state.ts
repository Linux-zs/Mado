export type FindMatchLike =
  | {
      kind: 'rendered';
      from: number;
      to: number;
    }
  | {
      kind: 'source';
      start: number;
      end: number;
    };

export type FindMatchDirection = -1 | 1;

export type ComputeFindMatchActiveIndexOptions<TMatch extends FindMatchLike> = {
  resetActive?: boolean;
  previousActiveIndex: number;
  previousActiveMatch?: TMatch | null;
  anchorPosition?: number | null;
  direction?: FindMatchDirection;
};

export function getFindMatchStart(match: FindMatchLike): number {
  return match.kind === 'source' ? match.start : match.from;
}

function getFindMatchEnd(match: FindMatchLike): number {
  return match.kind === 'source' ? match.end : match.to;
}

function findFindMatchIndex<TMatch extends FindMatchLike>(matches: TMatch[], target: TMatch): number {
  if (target.kind === 'source') {
    return matches.findIndex(
      (candidate) =>
        candidate.kind === 'source' &&
        candidate.start === target.start &&
        candidate.end === target.end
    );
  }

  return matches.findIndex(
    (candidate) =>
      candidate.kind === 'rendered' &&
      candidate.from === target.from &&
      candidate.to === target.to
  );
}

export function findNearestFindMatchIndex<TMatch extends FindMatchLike>(
  matches: TMatch[],
  anchorPosition: number,
  direction: FindMatchDirection
): number {
  if (matches.length === 0) {
    return -1;
  }

  if (direction < 0) {
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index]!;

      if (getFindMatchEnd(match) <= anchorPosition) {
        return index;
      }
    }

    return matches.length - 1;
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;

    if (getFindMatchStart(match) >= anchorPosition) {
      return index;
    }
  }

  return matches.length - 1;
}

export function computeFindMatchActiveIndex<TMatch extends FindMatchLike>(
  matches: TMatch[],
  options: ComputeFindMatchActiveIndexOptions<TMatch>
): number {
  if (matches.length === 0) {
    return -1;
  }

  if (options.resetActive) {
    return 0;
  }

  const previousActiveMatch = options.previousActiveMatch ?? null;

  if (previousActiveMatch) {
    const exactMatchIndex = findFindMatchIndex(matches, previousActiveMatch);

    if (exactMatchIndex >= 0) {
      return exactMatchIndex;
    }
  }

  const anchorPosition =
    options.anchorPosition ??
    (previousActiveMatch ? getFindMatchStart(previousActiveMatch) : null);

  if (anchorPosition !== null) {
    return findNearestFindMatchIndex(matches, anchorPosition, options.direction ?? 1);
  }

  if (options.previousActiveIndex >= 0) {
    return Math.min(options.previousActiveIndex, matches.length - 1);
  }

  return 0;
}
