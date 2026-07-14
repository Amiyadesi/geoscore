import { fetchWithTimeout, type HttpFetcher } from './http';

export interface SubrequestBudgetSnapshot {
  scope: string;
  limit: number;
  used: number;
  remaining: number;
  children: SubrequestBudgetSnapshot[];
}

export interface SubrequestBudgetLike {
  consume(label: string): void;
  snapshot(): SubrequestBudgetSnapshot;
}

export class SubrequestBudgetExceeded extends Error {
  readonly code = 'SUBREQUEST_BUDGET_EXCEEDED';

  constructor(
    readonly scope: string,
    readonly limit: number,
    readonly label: string,
  ) {
    super(`External request budget exhausted for ${scope} while requesting ${label}`);
    this.name = 'SubrequestBudgetExceeded';
  }
}

/**
 * Per-invocation external request budget.
 *
 * Child budgets consume their own allowance and the shared parent allowance in
 * one synchronous step, so concurrent modules cannot oversubscribe the Worker.
 */
export class SubrequestBudget implements SubrequestBudgetLike {
  private used = 0;
  private readonly children: SubrequestBudget[] = [];

  constructor(
    readonly limit: number,
    readonly scope = 'audit',
    private readonly parent?: SubrequestBudget,
  ) {
    if (!Number.isInteger(limit) || limit < 0) throw new Error('Subrequest budget limit must be a non-negative integer');
  }

  child(scope: string, limit: number): SubrequestBudget {
    const child = new SubrequestBudget(limit, `${this.scope}.${scope}`, this);
    this.children.push(child);
    return child;
  }

  consume(label: string): void {
    if (this.used >= this.limit) {
      throw new SubrequestBudgetExceeded(this.scope, this.limit, label);
    }
    this.parent?.consume(`${this.scope}:${label}`);
    this.used += 1;
  }

  snapshot(): SubrequestBudgetSnapshot {
    return {
      scope: this.scope,
      limit: this.limit,
      used: this.used,
      remaining: Math.max(0, this.limit - this.used),
      children: this.children.map(child => child.snapshot()),
    };
  }
}

export function budgetedFetcher(
  budget: SubrequestBudgetLike,
  fetcher: HttpFetcher = fetchWithTimeout,
  labelPrefix = 'fetch',
): HttpFetcher {
  return (url, options = {}) => {
    const upstreamHook = options.onSubrequest;
    return fetcher(url, {
      ...options,
      onSubrequest: nextUrl => {
        upstreamHook?.(nextUrl);
        let label = nextUrl;
        try {
          const parsed = new URL(nextUrl);
          label = `${parsed.hostname}${parsed.pathname}`;
        } catch { /* retain the original URL for diagnostics */ }
        budget.consume(`${labelPrefix}:${label}`);
      },
    });
  };
}
