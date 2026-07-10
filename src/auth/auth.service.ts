import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async login(userId: string): Promise<{ accessToken: string }> {
    const accessToken = await this.jwtService.signAsync({ sub: userId });
    return { accessToken };
  }
}
