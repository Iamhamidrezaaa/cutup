export interface MemoryHit {
  id: string;
  text: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryRetrieveParams {
  query: string;
  sessionId: string;
  limit?: number;
}

/**
 * Pluggable memory (vector DB, Instalogist memory service, etc.).
 */
export interface MemoryRetriever {
  retrieve(params: MemoryRetrieveParams): Promise<MemoryHit[]>;
}

/** In-process store for tests and single-node demos. */
export class InMemoryRetriever implements MemoryRetriever {
  private readonly store = new Map<string, MemoryHit[]>();

  constructor(seed?: Record<string, MemoryHit[]>) {
    if (seed) for (const [k, v] of Object.entries(seed)) this.store.set(k, v);
  }

  /** Add or replace session memories */
  setSessionMemories(sessionId: string, hits: MemoryHit[]): void {
    this.store.set(sessionId, hits);
  }

  async retrieve(params: MemoryRetrieveParams): Promise<MemoryHit[]> {
    const limit = params.limit ?? 6;
    const all = this.store.get(params.sessionId) ?? [];
    if (!params.query.trim()) return all.slice(0, limit);
    const q = params.query.toLowerCase();
    const scored = all
      .map((h) => ({
        hit: h,
        score: simpleScore(h.text.toLowerCase(), q)
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => ({ ...x.hit, score: x.score }));
    return scored.length ? scored : all.slice(0, limit);
  }
}

function simpleScore(text: string, q: string): number {
  let s = 0;
  for (const word of q.split(/\s+/).filter(Boolean)) {
    if (text.includes(word)) s += 1;
  }
  return s;
}
