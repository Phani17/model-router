import { Global, Module } from '@nestjs/common';
import { FingerprintService } from './fingerprint.service.js';
import { InFlightDeduplicationService } from './in-flight-deduplication.service.js';
import { TtlPolicyService } from './ttl-policy.service.js';

@Global()
@Module({
  providers: [FingerprintService, InFlightDeduplicationService, TtlPolicyService],
  exports: [FingerprintService, InFlightDeduplicationService, TtlPolicyService]
})
export class CacheModule {}
