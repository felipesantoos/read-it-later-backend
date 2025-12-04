import { NextFunction, Request, Response } from "express";

// Middleware simples de tratamento de erros
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  // TODO: aqui podemos expandir para logs estruturados
  console.error(err);
  return res.status(500).json({ error: "Erro interno do servidor" });
};

