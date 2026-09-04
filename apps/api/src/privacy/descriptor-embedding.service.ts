import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';

// Embeds only the fixed-vocabulary descriptor, never prompt or response content.
@Injectable()
export class DescriptorEmbeddingService {
  create(descriptor: string): number[] {
    const vector = Array<number>(1536).fill(0);
    for (const token of descriptor.split(/[;:+]/).filter(Boolean)) {
      const digest = crypto.createHash('sha256').update(token).digest();
      for (let offset = 0; offset < digest.length - 1; offset += 2) {
        const index = digest.readUInt16BE(offset) % vector.length;
        vector[index] += digest[offset] % 2 === 0 ? 1 : -1;
      }
    }
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map(value => Math.round((value / magnitude) * 1_000_000) / 1_000_000);
  }
}
