import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { Public } from '../auth/auth.decorators.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  @Public()
  getHealth() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  async getReadiness() {
    if (!(await this.database.ready())) {
      throw new ServiceUnavailableException({ status: 'not_ready', database: 'unavailable' });
    }
    return { status: 'ready', database: this.database.enabled ? 'connected' : 'disabled' };
  }
}
