import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authToken, AuthenticatedRequest } from '../../middleware/authToken';

const router = Router();

const createCollectionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const updateCollectionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

// GET /collections - Listar coleções do usuário
router.get('/', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;

    const collections = await prisma.collection.findMany({
      where: { userId },
      include: {
        articleCollections: {
          include: {
            article: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: collections });
  } catch (error) {
    next(error);
  }
});

// GET /collections/:id - Buscar coleção específica
router.get('/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const collectionId = req.params.id;

    const collection = await prisma.collection.findFirst({
      where: {
        id: collectionId,
        userId,
      },
      include: {
        articleCollections: {
          include: {
            article: {
              include: {
                articleTags: {
                  include: {
                    tag: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!collection) {
      return res.status(404).json({ error: 'Coleção não encontrada' });
    }

    res.json({ data: collection });
  } catch (error) {
    next(error);
  }
});

// POST /collections - Criar coleção
router.post('/', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const body = createCollectionSchema.parse(req.body);

    const collection = await prisma.collection.create({
      data: {
        name: body.name,
        description: body.description,
        userId,
      },
    });

    res.status(201).json({ data: collection });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    next(error);
  }
});

// PATCH /collections/:id - Atualizar coleção
router.patch('/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const collectionId = req.params.id;
    const body = updateCollectionSchema.parse(req.body);

    const collection = await prisma.collection.findFirst({
      where: {
        id: collectionId,
        userId,
      },
    });

    if (!collection) {
      return res.status(404).json({ error: 'Coleção não encontrada' });
    }

    const updated = await prisma.collection.update({
      where: { id: collectionId },
      data: body,
    });

    res.json({ data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    next(error);
  }
});

// DELETE /collections/:id - Deletar coleção
router.delete('/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const collectionId = req.params.id;

    const collection = await prisma.collection.findFirst({
      where: {
        id: collectionId,
        userId,
      },
    });

    if (!collection) {
      return res.status(404).json({ error: 'Coleção não encontrada' });
    }

    await prisma.collection.delete({
      where: { id: collectionId },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// POST /collections/:id/articles - Adicionar artigo à coleção
router.post('/:id/articles', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const collectionId = req.params.id;
    const { articleId } = req.body;

    if (!articleId) {
      return res.status(400).json({ error: 'articleId é obrigatório' });
    }

    // Verify collection belongs to user
    const collection = await prisma.collection.findFirst({
      where: {
        id: collectionId,
        userId,
      },
    });

    if (!collection) {
      return res.status(404).json({ error: 'Coleção não encontrada' });
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

    // Check if already in collection
    const existing = await prisma.articleCollection.findFirst({
      where: {
        articleId,
        collectionId,
      },
    });

    if (existing) {
      return res.status(409).json({ error: 'Artigo já está na coleção' });
    }

    const articleCollection = await prisma.articleCollection.create({
      data: {
        articleId,
        collectionId,
      },
    });

    res.status(201).json({ data: articleCollection });
  } catch (error) {
    next(error);
  }
});

// DELETE /collections/:id/articles/:articleId - Remover artigo da coleção
router.delete('/:id/articles/:articleId', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const collectionId = req.params.id;
    const articleId = req.params.articleId;

    // Verify collection belongs to user
    const collection = await prisma.collection.findFirst({
      where: {
        id: collectionId,
        userId,
      },
    });

    if (!collection) {
      return res.status(404).json({ error: 'Coleção não encontrada' });
    }

    const articleCollection = await prisma.articleCollection.findFirst({
      where: {
        articleId,
        collectionId,
      },
    });

    if (!articleCollection) {
      return res.status(404).json({ error: 'Artigo não está na coleção' });
    }

    await prisma.articleCollection.delete({
      where: { id: articleCollection.id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;

