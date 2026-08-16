import { Module } from '@nestjs/common';
import { ReadingController } from './reading.controller';
import { ReadingService } from './reading.service';

@Module({
  controllers: [ReadingController],
  providers: [ReadingService],
})
export class ReadingModule {}
