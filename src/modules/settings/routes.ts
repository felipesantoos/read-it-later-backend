import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authToken, AuthenticatedRequest } from '../../middleware/authToken';

const router = Router();

const themeSchema = z.enum(['light', 'dark', 'sepia']);

// GET /settings/theme - Buscar tema do usuário
router.get('/theme', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { theme: true },
    });

    // Retorna 'light' como padrão se não existir
    const theme = user?.theme || 'light';

    res.json({ data: { theme } });
  } catch (error) {
    next(error);
  }
});

// PUT /settings/theme - Salvar tema do usuário
router.put('/theme', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const body = z.object({ theme: themeSchema }).parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { theme: body.theme },
      select: { theme: true },
    });

    res.json({ data: { theme: user.theme || 'light' } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    next(error);
  }
});

export default router;

