import 'reflect-metadata';
import { env } from './config/env.js';
import { createApp } from './app.js';

const app = await createApp();
await app.listen(env.PORT, env.HOST);
