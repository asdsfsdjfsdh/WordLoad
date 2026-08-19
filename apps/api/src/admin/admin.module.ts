import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { FeedbackModule } from '../feedback/feedback.module';

@Module({
  imports: [FeedbackModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
