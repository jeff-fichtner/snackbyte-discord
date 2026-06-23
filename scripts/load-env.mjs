/**
 * Loads .env into process.env with variable expansion, for local development only.
 * Production reads real environment variables injected by the platform; this file is
 * imported by the dev and build scripts, never by the running server.
 *
 * Safe when .env is absent (e.g. CI, containers): dotenv simply finds nothing.
 */
import dotenv from 'dotenv';
import { expand } from 'dotenv-expand';

expand(dotenv.config());
