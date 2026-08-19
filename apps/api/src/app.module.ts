import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { QuestionsModule } from './questions/questions.module';
import { SessionsModule } from './sessions/sessions.module';
import { BanksModule } from './banks/banks.module';
import { CollectionsModule } from './collections/collections.module';
import { SettingsModule } from './settings/settings.module';
import { StatsModule } from './stats/stats.module';
import { MaterialsModule } from './materials/materials.module';
import { RunsModule } from './runs/runs.module';
import { ReadingModule } from './reading/reading.module';
import { AdminModule } from './admin/admin.module';
import { FeedbackModule } from './feedback/feedback.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    PrismaModule,
    AuthModule,
    QuestionsModule,
    SessionsModule,
    BanksModule,
    CollectionsModule,
    SettingsModule,
    StatsModule,
    MaterialsModule,
    RunsModule,
    ReadingModule,
    AdminModule,
    FeedbackModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
