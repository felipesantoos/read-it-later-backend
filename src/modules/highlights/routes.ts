import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authToken, AuthenticatedRequest } from '../../middleware/authToken';

const router = Router();

const createHighlightSchema = z.object({
  articleId: z.string(),
  text: z.string().min(1),
  position: z.string().optional(),
  color: z.string().optional(),
});

const updateHighlightSchema = z.object({
  text: z.string().min(1).optional(),
  color: z.string().optional(),
});

const createNoteSchema = z.object({
  content: z.string().min(1),
  highlightId: z.string().optional(),
  articleId: z.string().optional(),
});

// GET /highlights - Listar highlights do usuário
router.get('/', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const articleId = req.query.articleId as string | undefined;

    const where: any = { userId };
    if (articleId) {
      where.articleId = articleId;
    }

    const highlights = await prisma.highlight.findMany({
      where,
      include: {
        article: true,
        notes: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: highlights });
  } catch (error) {
    next(error);
  }
});

// GET /highlights/:id - Buscar highlight específico
router.get('/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const highlightId = req.params.id;

    const highlight = await prisma.highlight.findFirst({
      where: {
        id: highlightId,
        userId,
      },
      include: {
        article: true,
        notes: true,
      },
    });

    if (!highlight) {
      return res.status(404).json({ error: 'Highlight não encontrado' });
    }

    res.json({ data: highlight });
  } catch (error) {
    next(error);
  }
});

// POST /highlights - Criar highlight
router.post('/', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const body = createHighlightSchema.parse(req.body);

    // Verify article belongs to user
    const article = await prisma.article.findFirst({
      where: {
        id: body.articleId,
        userId,
      },
    });

    if (!article) {
      return res.status(404).json({ error: 'Artigo não encontrado' });
    }

    const highlight = await prisma.highlight.create({
      data: {
        text: body.text,
        position: body.position,
        color: body.color,
        articleId: body.articleId,
        userId,
      },
      include: {
        article: true,
      },
    });

    res.status(201).json({ data: highlight });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    next(error);
  }
});

// PATCH /highlights/:id - Atualizar highlight
router.patch('/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const highlightId = req.params.id;
    const body = updateHighlightSchema.parse(req.body);

    const highlight = await prisma.highlight.findFirst({
      where: {
        id: highlightId,
        userId,
      },
    });

    if (!highlight) {
      return res.status(404).json({ error: 'Highlight não encontrado' });
    }

    const updated = await prisma.highlight.update({
      where: { id: highlightId },
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

// DELETE /highlights/:id - Deletar highlight
router.delete('/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const highlightId = req.params.id;

    const highlight = await prisma.highlight.findFirst({
      where: {
        id: highlightId,
        userId,
      },
    });

    if (!highlight) {
      return res.status(404).json({ error: 'Highlight não encontrado' });
    }

    await prisma.highlight.delete({
      where: { id: highlightId },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// POST /highlights/:id/notes - Criar nota para highlight
router.post('/:id/notes', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const highlightId = req.params.id;
    const body = createNoteSchema.parse(req.body);

    const highlight = await prisma.highlight.findFirst({
      where: {
        id: highlightId,
        userId,
      },
    });

    if (!highlight) {
      return res.status(404).json({ error: 'Highlight não encontrado' });
    }

    const note = await prisma.note.create({
      data: {
        content: body.content,
        highlightId,
        articleId: highlight.articleId,
        userId,
      },
    });

    res.status(201).json({ data: note });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    next(error);
  }
});

// POST /notes - Criar nota (pode ser para artigo ou highlight)
router.post('/notes', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const body = createNoteSchema.parse(req.body);

    if (!body.articleId && !body.highlightId) {
      return res.status(400).json({ error: 'articleId ou highlightId é obrigatório' });
    }

    // Verify article belongs to user if provided
    if (body.articleId) {
      const article = await prisma.article.findFirst({
        where: {
          id: body.articleId,
          userId,
        },
      });

      if (!article) {
        return res.status(404).json({ error: 'Artigo não encontrado' });
      }
    }

    // Verify highlight belongs to user if provided
    if (body.highlightId) {
      const highlight = await prisma.highlight.findFirst({
        where: {
          id: body.highlightId,
          userId,
        },
      });

      if (!highlight) {
        return res.status(404).json({ error: 'Highlight não encontrado' });
      }
    }

    const note = await prisma.note.create({
      data: {
        content: body.content,
        highlightId: body.highlightId,
        articleId: body.articleId,
        userId,
      },
    });

    res.status(201).json({ data: note });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    next(error);
  }
});

// GET /notes - Listar notas do usuário
router.get('/notes', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const articleId = req.query.articleId as string | undefined;
    const highlightId = req.query.highlightId as string | undefined;

    const where: any = { userId };
    if (articleId) {
      where.articleId = articleId;
    }
    if (highlightId) {
      where.highlightId = highlightId;
    }

    const notes = await prisma.note.findMany({
      where,
      include: {
        article: true,
        highlight: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: notes });
  } catch (error) {
    next(error);
  }
});

// PATCH /notes/:id - Atualizar nota
router.patch('/notes/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const noteId = req.params.id;
    const { content } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content é obrigatório' });
    }

    const note = await prisma.note.findFirst({
      where: {
        id: noteId,
        userId,
      },
    });

    if (!note) {
      return res.status(404).json({ error: 'Nota não encontrada' });
    }

    const updated = await prisma.note.update({
      where: { id: noteId },
      data: { content },
    });

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

// DELETE /notes/:id - Deletar nota
router.delete('/notes/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const noteId = req.params.id;

    const note = await prisma.note.findFirst({
      where: {
        id: noteId,
        userId,
      },
    });

    if (!note) {
      return res.status(404).json({ error: 'Nota não encontrada' });
    }

    await prisma.note.delete({
      where: { id: noteId },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;

