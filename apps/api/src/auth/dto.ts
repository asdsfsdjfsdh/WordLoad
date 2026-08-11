import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

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