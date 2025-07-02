import { join } from 'path';
import { config } from 'dotenv';

// Load environment variables from root .env file before any modules are imported
config({ path: join(__dirname, '..', '.env'), override: true });
