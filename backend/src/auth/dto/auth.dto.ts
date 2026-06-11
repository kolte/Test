import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

/** Shape of the `user` object embedded in /auth/login and returned by /auth/me
 * — matches `AuthUser` in Models/WorkModels.cs (camelCase via JsonSerializerDefaults.Web). */
export class AuthUserDto {
  id!: string;
  organizationId!: string;
  email!: string;
  name!: string;
  roles!: string[];
}

/** Matches `LoginResponse` in Models/WorkModels.cs. */
export class LoginResponseDto {
  accessToken!: string;
  refreshToken!: string;
  user!: AuthUserDto;
}

/** Response for POST /auth/refresh — a fresh access/refresh token pair
 * (refresh tokens are rotated on use; see AuthService.refresh). */
export class RefreshResponseDto {
  accessToken!: string;
  refreshToken!: string;
}
