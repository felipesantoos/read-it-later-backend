import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';

// Rotas
import tokensRoutes from './modules/tokens/routes';
import articlesRoutes from './modules/articles/routes';
import collectionsRoutes from './modules/collections/routes';
import tagsRoutes from './modules/tags/routes';
import highlightsRoutes from './modules/highlights/routes';
import searchRoutes from './modules/search/routes';
import analyticsRoutes from './modules/analytics/routes';
import settingsRoutes from './modules/settings/routes';

const app = express();

// Middlewares globais
app.use(cors({
  origin: env.corsOrigin || '*',
  credentials: true,
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rotas da API
app.use('/api/tokens', tokensRoutes);
app.use('/api/articles', articlesRoutes);
app.use('/api/collections', collectionsRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/highlights', highlightsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);

// Error handler (deve ser o último middleware)
app.use(errorHandler);

const PORT = env.port || 4000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📊 Ambiente: ${env.nodeEnv}`);
});

