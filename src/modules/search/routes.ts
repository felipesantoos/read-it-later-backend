import { Router } from 'express';
import { prisma } from '../../config/prisma';
import { authToken, AuthenticatedRequest } from '../../middleware/authToken';

const router = Router();

// GET /search - Buscar artigos, highlights, etc.
router.get('/', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const query = req.query.q as string;
    const type = req.query.type as string | undefined; // 'articles', 'highlights', 'all'

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Query de busca é obrigatória' });
    }

    const searchQuery = query.trim();

    const results: any = {
      articles: [],
      highlights: [],
    };

    // Search articles
    if (!type || type === 'articles' || type === 'all') {
      const articles = await prisma.article.findMany({
        where: {
          userId,
          OR: [
            { title: { contains: searchQuery, mode: 'insensitive' } },
            { description: { contains: searchQuery, mode: 'insensitive' } },
            { url: { contains: searchQuery, mode: 'insensitive' } },
            { content: { contains: searchQuery, mode: 'insensitive' } },
            { siteName: { contains: searchQuery, mode: 'insensitive' } },
          ],
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
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      results.articles = articles;
    }

    // Search highlights
    if (!type || type === 'highlights' || type === 'all') {
      const highlights = await prisma.highlight.findMany({
        where: {
          userId,
          text: { contains: searchQuery, mode: 'insensitive' },
        },
        include: {
          article: true,
          notes: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      results.highlights = highlights;
    }

    res.json({ data: results });
  } catch (error) {
    next(error);
  }
});

export default router;

