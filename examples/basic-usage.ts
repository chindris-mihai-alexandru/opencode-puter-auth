/**
 * Basic Usage Example for opencode-puter-auth
 * 
 * This example demonstrates how to use the Puter client directly
 * for chat completions outside of OpenCode.
 * 
 * NOTE: To run this example, first build the package:
 *   npm run build
 * 
 * Then run with:
 *   npx tsx examples/basic-usage.ts
 */

// When using as npm package, import like this:
// import { PuterClient } from 'opencode-puter-auth';

// For local development, import from built output:
import { PuterClient } from '../dist/index.js';
import type { PuterChatMessage } from '../dist/index.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Helper to load stored accounts
async function loadStoredAccounts() {
  const configDir = process.env.XDG_CONFIG_HOME 
    ? path.join(process.env.XDG_CONFIG_HOME, 'opencode')
    : path.join(os.homedir(), '.config', 'opencode');
  
  const accountsPath = path.join(configDir, 'puter-accounts.json');
  
  try {
    const data = await fs.readFile(accountsPath, 'utf-8');
    const storage = JSON.parse(data);
    return storage.accounts || [];
  } catch {
    return [];
  }
}

async function main() {
  // Load stored accounts from ~/.config/opencode/puter-accounts.json
  const accounts = await loadStoredAccounts();
  
  if (accounts.length === 0) {
    console.error('No Puter accounts found. Please authenticate first using OpenCode.');
    console.log('Run: opencode auth login and select Puter');
    process.exit(1);
  }

  // Get the first (default) account
  const account = accounts[0];
  
  console.log(`Using account: ${account.email || account.username}`);

  // Create a Puter client with the auth token
  const client = new PuterClient(account.authToken);

  // Example 1: Simple chat completion (non-streaming)
  console.log('\n--- Example 1: Non-streaming chat ---');
  try {
    const messages: PuterChatMessage[] = [
      { role: 'user', content: 'What is 2 + 2? Reply with just the number.' }
    ];

    const response = await client.chat(messages, {
      model: 'claude-sonnet-4',
    });

    console.log('Response:', response.message.content);
  } catch (error) {
    console.error('Error:', error);
  }

  // Example 2: Streaming chat completion
  console.log('\n--- Example 2: Streaming chat ---');
  try {
    const messages: PuterChatMessage[] = [
      { role: 'user', content: 'Write a haiku about coding.' }
    ];

    const stream = client.chatStream(messages, {
      model: 'claude-sonnet-4-5',
    });

    process.stdout.write('Response: ');
    for await (const chunk of stream) {
      if (chunk.text) {
        process.stdout.write(chunk.text);
      }
    }
    console.log('\n');
  } catch (error) {
    console.error('Error:', error);
  }

  // Example 3: Using GPT-5 model
  console.log('\n--- Example 3: Using GPT-5 ---');
  try {
    const messages: PuterChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Explain quantum computing in one sentence.' }
    ];

    const response = await client.chat(messages, {
      model: 'gpt-5-nano',
    });

    console.log('Response:', response.message.content);
  } catch (error) {
    console.error('Error:', error);
  }

  // Example 4: Multi-turn conversation
  console.log('\n--- Example 4: Multi-turn conversation ---');
  const conversation: PuterChatMessage[] = [
    { role: 'user', content: 'My name is Alex.' },
  ];

  try {
    const response1 = await client.chat(conversation, {
      model: 'claude-haiku-4-5',
    });

    console.log('Assistant:', response1.message.content);
    
    // Add assistant response to conversation
    conversation.push({ 
      role: 'assistant', 
      content: response1.message.content || '' 
    });
    conversation.push({ role: 'user', content: 'What is my name?' });

    const response2 = await client.chat(conversation, {
      model: 'claude-haiku-4-5',
    });

    console.log('Assistant:', response2.message.content);
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n✅ All examples completed!');
}

main().catch(console.error);
