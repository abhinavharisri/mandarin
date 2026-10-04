import app from './app.js';
import { config } from './config.js';

const server = app.listen(config.PORT, () => console.log(`Mandarin Orchid API listening on port ${config.PORT}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
