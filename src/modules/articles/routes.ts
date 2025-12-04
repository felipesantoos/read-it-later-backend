import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authToken, AuthenticatedRequest } from '../../middleware/authToken';
import { extractContent, generateUrlHash, type ExtractedMetadata } from '../../services/contentExtractor';

const router = Router();

const createArticleSchema = z.object({
  url: z.string().url(),
  contentType: z.enum(['ARTICLE', 'BLOG', 'PDF', 'YOUTUBE', 'TWITTER', 'NEWSLETTER', 'BOOK', 'EBOOK']).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  favicon: z.string().url().optional(),
  coverImage: z.string().url().optional(),
  siteName: z.string().optional(),
  content: z.string().optional(),
  attributes: z.record(z.any()).optional(),
});

const updateArticleSchema = z.object({
  status: z.enum(['UNREAD', 'READING', 'FINISHED', 'ARCHIVED']).optional(),
  isFavorited: z.boolean().optional(),
  readingProgress: z.number().min(0).max(1).optional(),
  totalPages: z.number().int().positive().nullable().optional(),
  currentPage: z.number().int().min(0).nullable().optional(),
  attributes: z.record(z.any()).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
});

// POST /articles - Criar artigo (pode ser público com token no body ou header)
router.post('/', async (req, res, next) => {
  try {
    const body = createArticleSchema.parse(req.body);
    const url = body.url;

    // Get token from header or body
    const authHeader = req.headers.authorization;
    const bodyToken = (req.body as any).token;
    
    let token: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring('Bearer '.length).trim();
    } else if (bodyToken) {
      token = bodyToken;
    }

    if (!token) {
      return res.status(401).json({ error: 'Token ausente' });
    }

    // Verify token
    const accessToken = await prisma.accessToken.findFirst({
      where: {
        token,
        revokedAt: null,
      },
    });

    if (!accessToken) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const userId = accessToken.userId;

    // Generate URL hash for duplicate detection
    const urlHash = generateUrlHash(url);

    // Check for duplicate
    const existing = await prisma.article.findFirst({
      where: {
        urlHash,
        userId,
      },
    });

    if (existing) {
      return res.status(409).json({ 
        error: 'Artigo já existe',
        data: existing,
      });
    }

    // Extract content if not provided
    let metadata: ExtractedMetadata;
    if (body.title && body.description) {
      // Use provided metadata
      metadata = {
        contentType: body.contentType || 'ARTICLE',
        title: body.title,
        description: body.description,
        favicon: body.favicon,
        coverImage: body.coverImage,
        siteName: body.siteName,
        content: body.content,
      };
    } else {
      // Extract from URL
      try {
        metadata = await extractContent(url);
      } catch (error) {
        console.error('Error extracting content:', error);
        // Use provided values or defaults
        metadata = {
          contentType: body.contentType || 'ARTICLE',
          title: body.title || extractTitleFromUrl(url),
          description: body.description,
          favicon: body.favicon,
          coverImage: body.coverImage,
          siteName: body.siteName,
          content: body.content,
        };
      }
    }

    // Merge attributes with extracted metadata
    const attributes: Record<string, any> = {
      ...(body.attributes || {}),
    };
    
    if ('author' in metadata && metadata.author) {
      attributes.author = metadata.author;
    }
    if ('publishedDate' in metadata && metadata.publishedDate) {
      attributes.publishedDate = metadata.publishedDate;
    }
    if ('images' in metadata && Array.isArray(metadata.images) && metadata.images.length > 0) {
      attributes.images = metadata.images;
    }

    // Create article
    const article = await prisma.article.create({
      data: {
        url,
        urlHash,
        userId,
        title: metadata.title || body.title,
        description: metadata.description || body.description,
        favicon: metadata.favicon || body.favicon,
        coverImage: metadata.coverImage || body.coverImage,
        siteName: metadata.siteName || body.siteName,
        content: metadata.content || body.content,
        contentType: metadata.contentType,
        wordCount: metadata.wordCount,
        readingTime: metadata.readingTime,
        totalPages: metadata.totalPages,
        attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      },
    });

    res.status(201).json({ data: article });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    next(error);
  }
});

// GET /articles - Listar artigos do usuário
router.get('/', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const status = req.query.status as string | undefined;
    const isFavorited = req.query.isFavorited as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.page as string) || 1;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (status) {
      where.status = status;
    }
    if (isFavorited !== undefined) {
      where.isFavorited = isFavorited === 'true';
    }

    const [articles, total] = await Promise.all([
      prisma.article.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
        include: {
          articleTags: {
            include: {
              tag: true,
            },
          },
          articleCollections: {
            include: {
              collection: true,
            },
          },
        },
      }),
      prisma.article.count({ where }),
    ]);

    res.json({
      data: articles,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /articles/counts - Obter contagens por status
router.get('/counts', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;

    const [countsByStatus, total] = await Promise.all([
      prisma.article.groupBy({
        by: ['status'],
        where: { userId },
        _count: true,
      }),
      prisma.article.count({
        where: { userId },
      }),
    ]);

    // Inicializar contagens com zero para todos os status
    const counts = {
      UNREAD: 0,
      READING: 0,
      FINISHED: 0,
      ARCHIVED: 0,
      total,
    };

    // Preencher contagens reais
    countsByStatus.forEach((item) => {
      counts[item.status as keyof typeof counts] = item._count;
    });

    res.json({ data: counts });
  } catch (error) {
    next(error);
  }
});

// GET /articles/export - Exportar artigos como JSON ou CSV
router.get('/export', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const format = req.query.format as string || 'json';

    const articles = await prisma.article.findMany({
      where: { userId },
      include: {
        articleTags: {
          include: {
            tag: true,
          },
        },
        articleCollections: {
          include: {
            collection: true,
          },
        },
        highlights: {
          include: {
            notes: true,
          },
        },
        notes: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (format === 'csv') {
      // CSV export
      const headers = ['Title', 'URL', 'Status', 'Reading Progress', 'Created At', 'Tags', 'Collections'];
      const rows = articles.map(article => [
        article.title || '',
        article.url,
        article.status,
        (article.readingProgress * 100).toFixed(0) + '%',
        article.createdAt.toISOString(),
        article.articleTags.map(at => at.tag.name).join('; '),
        article.articleCollections.map(ac => ac.collection.name).join('; '),
      ]);

      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=articles.csv');
      res.send(csv);
    } else {
      // JSON export
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=articles.json');
      res.json({ data: articles });
    }
  } catch (error) {
    next(error);
  }
});

// GET /articles/:id - Buscar artigo específico
router.get('/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const articleId = req.params.id;

    const article = await prisma.article.findFirst({
      where: {
        id: articleId,
        userId,
      },
      include: {
        articleTags: {
          include: {
            tag: true,
          },
        },
        articleCollections: {
          include: {
            collection: true,
          },
        },
        highlights: true,
        notes: true,
      },
    });

    if (!article) {
      return res.status(404).json({ error: 'Artigo não encontrado' });
    }

    res.json({ data: article });
  } catch (error) {
    next(error);
  }
});

// PATCH /articles/:id - Atualizar artigo
router.patch('/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const articleId = req.params.id;
    const body = updateArticleSchema.parse(req.body);

    const article = await prisma.article.findFirst({
      where: {
        id: articleId,
        userId,
      },
    });

    if (!article) {
      return res.status(404).json({ error: 'Artigo não encontrado' });
    }

    const updateData: any = {};
    if (body.status !== undefined) {
      updateData.status = body.status;
      if (body.status === 'FINISHED') {
        updateData.finishedAt = new Date();
      }
    }
    if (body.isFavorited !== undefined) {
      updateData.isFavorited = body.isFavorited;
    }
    
    // Handle page tracking and sync with readingProgress
    if (body.totalPages !== undefined) {
      updateData.totalPages = body.totalPages;
    }
    if (body.currentPage !== undefined) {
      updateData.currentPage = body.currentPage;
      updateData.lastReadAt = new Date();
      updateData.readCount = { increment: 1 };
      
      // Sync readingProgress if totalPages is available and currentPage is not null
      if (body.currentPage !== null) {
        const totalPages = body.totalPages !== undefined ? body.totalPages : article.totalPages;
        if (totalPages && totalPages > 0) {
          const newProgress = Math.min(body.currentPage / totalPages, 1);
          updateData.readingProgress = newProgress;
          
          // Update status based on progress
          if (newProgress >= 0.95 || body.currentPage >= totalPages) {
            updateData.status = 'FINISHED';
            updateData.finishedAt = new Date();
          } else if (newProgress > 0 && article.status === 'UNREAD') {
            updateData.status = 'READING';
          }
        }
        
        // Validate currentPage doesn't exceed totalPages
        const finalTotalPages = body.totalPages !== undefined ? body.totalPages : article.totalPages;
        if (finalTotalPages && body.currentPage > finalTotalPages) {
          return res.status(400).json({ error: 'Página atual não pode ser maior que o total de páginas' });
        }
      }
    }
    
    if (body.readingProgress !== undefined) {
      updateData.readingProgress = body.readingProgress;
      updateData.lastReadAt = new Date();
      updateData.readCount = { increment: 1 };
      
      // Sync currentPage if totalPages is available
      const totalPages = article.totalPages;
      if (totalPages && totalPages > 0) {
        updateData.currentPage = Math.round(body.readingProgress * totalPages);
      }
      
      // Update status based on progress
      if (body.readingProgress >= 0.95) {
        updateData.status = 'FINISHED';
        updateData.finishedAt = new Date();
      } else if (body.readingProgress > 0 && article.status === 'UNREAD') {
        updateData.status = 'READING';
      }
    }
    
    if (body.attributes !== undefined) {
      updateData.attributes = body.attributes;
    }
    if (body.title !== undefined) {
      updateData.title = body.title;
    }
    if (body.description !== undefined) {
      updateData.description = body.description;
    }

    const updated = await prisma.article.update({
      where: { id: articleId },
      data: updateData,
    });

    res.json({ data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    next(error);
  }
});

// DELETE /articles/:id - Deletar artigo
router.delete('/:id', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const articleId = req.params.id;

    const article = await prisma.article.findFirst({
      where: {
        id: articleId,
        userId,
      },
    });

    if (!article) {
      return res.status(404).json({ error: 'Artigo não encontrado' });
    }

    await prisma.article.delete({
      where: { id: articleId },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// POST /articles/:id/read - Atualizar progresso de leitura
router.post('/:id/read', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const articleId = req.params.id;
    const { progress, currentPage } = req.body;

    const article = await prisma.article.findFirst({
      where: {
        id: articleId,
        userId,
      },
    });

    if (!article) {
      return res.status(404).json({ error: 'Artigo não encontrado' });
    }

    const updateData: any = {
      lastReadAt: new Date(),
    };

    // Handle page-based update
    if (typeof currentPage === 'number' && currentPage >= 0) {
      if (article.totalPages && currentPage > article.totalPages) {
        return res.status(400).json({ error: 'Página atual não pode ser maior que o total de páginas' });
      }
      
      updateData.currentPage = currentPage;
      updateData.readCount = { increment: 1 };
      
      // Calculate readingProgress from currentPage
      if (article.totalPages && article.totalPages > 0) {
        const calculatedProgress = Math.min(currentPage / article.totalPages, 1);
        updateData.readingProgress = calculatedProgress;
        
        if (calculatedProgress >= 0.95 || currentPage >= article.totalPages) {
          updateData.status = 'FINISHED';
          updateData.finishedAt = new Date();
        } else if (calculatedProgress > 0 && article.status === 'UNREAD') {
          updateData.status = 'READING';
        }
      }
    }
    // Handle percentage-based update
    else if (typeof progress === 'number' && progress >= 0 && progress <= 1) {
      updateData.readingProgress = progress;
      updateData.readCount = { increment: 1 };
      
      // Sync currentPage if totalPages is available
      if (article.totalPages && article.totalPages > 0) {
        updateData.currentPage = Math.round(progress * article.totalPages);
      }
      
      if (progress === 1) {
        updateData.status = 'FINISHED';
        updateData.finishedAt = new Date();
      } else if (progress > 0 && article.status === 'UNREAD') {
        updateData.status = 'READING';
      }
    } else {
      return res.status(400).json({ error: 'Deve fornecer progress (0-1) ou currentPage (número >= 0)' });
    }

    const updated = await prisma.article.update({
      where: { id: articleId },
      data: updateData,
    });

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

function extractTitleFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return 'Untitled';
  }
}

export default router;
