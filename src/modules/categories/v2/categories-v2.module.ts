import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories.module';
import { CategoriesV2Controller } from './categories-v2.controller';

@Module({
  imports: [CategoriesModule],
  controllers: [CategoriesV2Controller],
})
export class CategoriesV2Module {}
