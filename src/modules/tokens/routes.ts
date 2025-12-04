import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authToken, AuthenticatedRequest } from '../../middleware/authToken';
import { env } from '../../config/env';
import crypto from 'crypto';

const router = Router();

const createTokenSchema = z.object({
  email: z.string().email().optional(),
});

// GET /tokens - Listar tokens do usuário
router.get('/', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const tokens = await prisma.accessToken.findMany({
      where: {
        userId,
        revokedAt: null,
      },
      select: {
        id: true,
        token: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json({ data: tokens });
  } catch (error) {
    next(error);
  }
});

// POST /tokens - Criar novo token
router.post('/', async (req, res, next) => {
  try {
    const body = createTokenSchema.parse(req.body);
    
    // Verificar se admin secret está configurado
    if (!env.tokenAdminSecret) {
      return res.status(500).json({ error: 'Token admin secret não configurado' });
    }

    // Verificar admin secret no header
    const adminSecret = req.headers['x-admin-secret'];
    if (adminSecret !== env.tokenAdminSecret) {
      return res.status(401).json({ error: 'Admin secret inválido' });
    }

    // Criar ou buscar usuário
    let user;
    if (body.email) {
      user = await prisma.user.upsert({
        where: { email: body.email },
        update: {},
        create: { email: body.email },
      });
    } else {
      // Criar usuário sem email
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

    res.status(201).json({
      data: {
        token: accessToken.token,
        userId: user.id,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    next(error);
  }
});

// DELETE /tokens/:id - Revogar token
router.delete('/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const tokenId = req.params.id;

    const token = await prisma.accessToken.findFirst({
      where: {
        id: tokenId,
        userId,
      },
    });

    if (!token) {
      return res.status(404).json({ error: 'Token não encontrado' });
    }

    await prisma.accessToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });

    res.json({ data: { message: 'Token revogado com sucesso' } });
  } catch (error) {
    next(error);
  }
});

export default router;

