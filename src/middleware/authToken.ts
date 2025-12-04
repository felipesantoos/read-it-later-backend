import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export const authToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;

    let token: string | undefined;

    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.substring("Bearer ".length).trim();
    } else if (queryToken) {
      token = queryToken;
    }

    if (!token) {
      return res.status(401).json({ error: "Token ausente" });
    }

    const accessToken = await prisma.accessToken.findFirst({
      where: {
        token,
        revokedAt: null,
      },
    });

    if (!accessToken) {
      return res.status(401).json({ error: "Token inválido" });
    }

    req.userId = accessToken.userId;

    await prisma.accessToken.update({
      where: { id: accessToken.id },
      data: { lastUsedAt: new Date() },
    });

    return next();
  } catch (err) {
    // Não vaza detalhes de erro aqui
    return res.status(500).json({ error: "Erro de autenticação" });
  }
};

