import { Router } from 'express';
import { prisma } from '../../config/prisma';
import { authToken, AuthenticatedRequest } from '../../middleware/authToken';

const router = Router();

// GET /analytics - Obter estatísticas do usuário
router.get('/', authToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.userId!;

    const [
      totalSaved,
      totalRead,
      totalFinished,
      totalArchived,
      totalFavorited,
      totalHighlights,
      totalCollections,
      totalTags,
      articlesByStatus,
      readingTimeToday,
    ] = await Promise.all([
      // Total saved
      prisma.article.count({
        where: { userId },
      }),
      // Total read (reading or finished)
      prisma.article.count({
        where: {
          userId,
          status: { in: ['READING', 'FINISHED'] },
        },
      }),
      // Total finished
      prisma.article.count({
        where: {
          userId,
          status: 'FINISHED',
        },
      }),
      // Total archived
      prisma.article.count({
        where: {
          userId,
          status: 'ARCHIVED',
        },
      }),
      // Total favorited
      prisma.article.count({
        where: {
          userId,
          isFavorited: true,
        },
      }),
      // Total highlights
      prisma.highlight.count({
        where: { userId },
      }),
      // Total collections
      prisma.collection.count({
        where: { userId },
      }),
      // Total tags
      prisma.tag.count({
        where: { userId },
      }),
      // Articles by status
      prisma.article.groupBy({
        by: ['status'],
        where: { userId },
        _count: true,
      }),
      // Reading time today (sum of readingTime for articles read today)
      prisma.article.aggregate({
        where: {
          userId,
          lastReadAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
        _sum: {
          readingTime: true,
        },
      }),
    ]);

    // Calculate completion rate
    const completionRate = totalSaved > 0 ? (totalFinished / totalSaved) * 100 : 0;

    res.json({
      data: {
        totalSaved,
        totalRead,
        totalFinished,
        totalArchived,
        totalFavorited,
        totalHighlights,
        totalCollections,
        totalTags,
        completionRate: Math.round(completionRate * 100) / 100,
        readingTimeToday: readingTimeToday._sum.readingTime || 0,
        articlesByStatus: articlesByStatus.reduce((acc, item) => {
          acc[item.status] = item._count;
          return acc;
        }, {} as Record<string, number>),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;

