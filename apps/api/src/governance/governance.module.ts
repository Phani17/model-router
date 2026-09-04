import { Global, Module } from '@nestjs/common';
import { TokenGovernanceService } from './token-governance.service.js';

@Global()
@Module({ providers: [TokenGovernanceService], exports: [TokenGovernanceService] })
export class GovernanceModule {}
