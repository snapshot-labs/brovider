import { join } from 'path';
import { config } from 'dotenv';

// Load test environment variables before any modules are imported
// Use override: true to override empty values from .env.test
config({ path: join(__dirname, '.env.local.test'), override: true });
