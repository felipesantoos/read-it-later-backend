import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authToken, AuthenticatedRequest } from '../../middleware/authToken';

const router = Router();

const createTagSchema = z.object({
  name: z.string().min(1),
});

// GET /tags - Listar tags do usuário
router.get('/', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;

    const tags = await prisma.tag.findMany({
      where: { userId },
      include: {
        articleTags: {
          include: {
            article: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ data: tags });
  } catch (error) {
    next(error);
  }
});

// POST /tags - Criar tag
router.post('/', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const body = createTagSchema.parse(req.body);

    // Check if tag already exists for this user
    const existing = await prisma.tag.findUnique({
      where: {
        userId_name: {
          userId,
          name: body.name,
        },
      },
    });

    if (existing) {
      return res.json({ data: existing });
    }

    const tag = await prisma.tag.create({
      data: {
        name: body.name,
        userId,
      },
    });

    res.status(201).json({ data: tag });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    next(error);
  }
});

// DELETE /tags/:id - Deletar tag
router.delete('/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const tagId = req.params.id;

    const tag = await prisma.tag.findFirst({
      where: {
        id: tagId,
        userId,
      },
    });

    if (!tag) {
      return res.status(404).json({ error: 'Tag não encontrada' });
    }

    await prisma.tag.delete({
      where: { id: tagId },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// POST /tags/:id/articles - Adicionar tag a artigo
router.post('/:id/articles', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const tagId = req.params.id;
    const { articleId } = req.body;

    if (!articleId) {
      return res.status(400).json({ error: 'articleId é obrigatório' });
    }

    // Verify tag belongs to user
    const tag = await prisma.tag.findFirst({
      where: {
        id: tagId,
        userId,
      },
    });

    if (!tag) {
      return res.status(404).json({ error: 'Tag não encontrada' });
    }

    // Verify article belongs to user
    const article = await prisma.article.findFirst({
      where: {
        id: articleId,
        userId,
      },
    });

    if (!article) {
      return res.status(404).json({ error: 'Artigo não encontrado' });
    }

    // Check if already tagged
    const existing = await prisma.articleTag.findFirst({
      where: {
        articleId,
        tagId,
      },
    });

    if (existing) {
      return res.status(409).json({ error: 'Artigo já tem esta tag' });
    }

    const articleTag = await prisma.articleTag.create({
      data: {
        articleId,
        tagId,
      },
    });

    res.status(201).json({ data: articleTag });
  } catch (error) {
    next(error);
  }
});

// DELETE /tags/:id/articles/:articleId - Remover tag de artigo
router.delete('/:id/articles/:articleId', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const tagId = req.params.id;
    const articleId = req.params.articleId;

    // Verify tag belongs to user
    const tag = await prisma.tag.findFirst({
      where: {
        id: tagId,
        userId,
      },
    });

    if (!tag) {
      return res.status(404).json({ error: 'Tag não encontrada' });
    }

    const articleTag = await prisma.articleTag.findFirst({
      where: {
        articleId,
        tagId,
      },
    });

    if (!articleTag) {
      return res.status(404).json({ error: 'Tag não está no artigo' });
    }

    await prisma.articleTag.delete({
      where: { id: articleTag.id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;

