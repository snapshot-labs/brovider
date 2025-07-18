import { join } from 'path';
import { config } from 'dotenv';

// Load environment variables from root .env file first
config({ path: join(__dirname, '..', '.env') });
// Then load test .env.test file, allowing it to override root values
config({ path: join(__dirname, '.env.test'), override: true });
