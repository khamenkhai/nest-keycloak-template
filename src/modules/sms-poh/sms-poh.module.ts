import { Module } from '@nestjs/common';
import { SmsPohService } from './sms-poh.service';

@Module({
  controllers: [],
  providers: [SmsPohService],
  exports: [SmsPohService],
})
export class SmsPohModule {}
