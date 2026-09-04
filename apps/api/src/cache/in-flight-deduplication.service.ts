import { Injectable } from '@nestjs/common';

// Holds only unresolved promises. Completed responses are never retained.
@Injectable()
export class InFlightDeduplicationService {
  private readonly active = new Map<string, Promise<unknown>>();

  run<T>(fingerprint: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.active.get(fingerprint) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = operation().finally(() => this.active.delete(fingerprint));
    this.active.set(fingerprint, pending);
    return pending;
  }

  get activeCount(): number {
    return this.active.size;
  }
}
