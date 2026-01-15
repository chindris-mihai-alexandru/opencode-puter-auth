#!/usr/bin/env node
import { PuterAuthManager } from './auth.js';
import { homedir } from 'os';
import { join } from 'path';

const configDir = join(homedir(), '.config', 'opencode');
const authManager = new PuterAuthManager(configDir);

await authManager.init();
const result = await authManager.login();

if (result.success) {
  console.log('✅ Authentication successful!');
  console.log('Account:', result.account?.username);
} else {
  console.error('❌ Authentication failed:', result.error);
  process.exit(1);
}
