import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function createToken(email?: string) {
  try {
    // Criar ou buscar usuário
    let user;
    if (email) {
      user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email },
      });
    } else {
      user = await prisma.user.create({
        data: {},
      });
    }

    // Gerar token único
    const token = crypto.randomBytes(32).toString('hex');

    // Criar access token
    const accessToken = await prisma.accessToken.create({
      data: {
        token,
        userId: user.id,
      },
    });

    console.log('✅ Token criado com sucesso!');
    console.log(`Token: ${accessToken.token}`);
    console.log(`User ID: ${user.id}`);
    if (email) {
      console.log(`Email: ${email}`);
    }
  } catch (error) {
    console.error('Erro ao criar token:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2];
createToken(email);

