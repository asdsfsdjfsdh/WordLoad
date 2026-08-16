import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(3, 32)
  username!: string;

  @IsString()
  @Length(6, 64)
  password!: string;
}

export class LoginDto {
  @IsString()
  @Length(3, 32)
  username!: string;

  @IsString()
  @Length(6, 64)
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

// 角色初始三围
export class InitCharDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  hpLv!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  atkLv!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  defLv!: number;
}

// 强化三围
export class StrengthenDto {
  @IsString()
  @IsIn(['hp', 'atk', 'def']) // 非法 stat 直接 400，不再落入 500
  stat!: 'hp' | 'atk' | 'def';
}

// 角色特化（斩杀词根 / 复习专精）
export class SpecializeDto {
  @IsString()
  @IsIn(['execute', 'vampire']) // 非法 spec 直接 400
  spec!: 'execute' | 'vampire';
}