/**
 * Error Handling Patterns for opencode-puter-auth
 *
 * This example demonstrates how to handle various error scenarios
 * when using the Puter API for AI completions.
 */

import { PuterClient } from 'opencode-puter-auth';
import type { PuterChatMessage, PuterChatStreamChunk } from 'opencode-puter-auth';

// ============================================================================
// 1. BASIC ERROR HANDLING
// ============================================================================

/**
 * Handle common API errors with informative messages
 */
async function handleBasicErrors(client: PuterClient): Promise<void> {
  try {
    const response = await client.chat([{ role: 'user', content: 'Hello!' }]);
    console.log('Success:', response.message.content);
  } catch (error) {
    if (error instanceof Error) {
      // Parse the error message for status codes
      const message = error.message;

      if (message.includes('(401)')) {
        console.error('❌ Authentication failed. Your token may have expired.');
        console.log('   → Run puter_login to get a new token');
      } else if (message.includes('(429)')) {
        console.error('⏳ Rate limit exceeded. Waiting before retry...');
        // Implement retry logic (see below)
      } else if (message.includes('(500)')) {
        console.error('🔥 Server error. The Puter API may be experiencing issues.');
        console.log('   → Check https://status.puter.com for updates');
      } else if (message.includes('(503)')) {
        console.error('🛠️ Service unavailable. Try again in a few minutes.');
      } else if (message.includes('fetch')) {
        console.error('🌐 Network error. Check your internet connection.');
      } else {
        console.error('❓ Unexpected error:', message);
      }
    }
  }
}

// ============================================================================
// 2. EXPONENTIAL BACKOFF RETRY LOGIC
// ============================================================================

interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoff(attempt: number, options: RetryOptions): number {
  const exponentialDelay = options.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // Add 0-30% jitter
  return Math.min(exponentialDelay + jitter, options.maxDelayMs);
}

/**
 * Retry a function with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on authentication errors - they won't succeed without re-login
      if (lastError.message.includes('(401)')) {
        throw lastError;
      }

      // Only retry on rate limits, server errors, or network issues
      const isRetryable =
        lastError.message.includes('(429)') ||
        lastError.message.includes('(500)') ||
        lastError.message.includes('(503)') ||
        lastError.message.includes('fetch');

      if (!isRetryable) {
        throw lastError;
      }

      if (attempt < opts.maxRetries - 1) {
        const delay = calculateBackoff(attempt, opts);
        console.log(`Retry ${attempt + 1}/${opts.maxRetries} after ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Example: Chat with automatic retry
 */
async function chatWithRetry(
  client: PuterClient,
  messages: PuterChatMessage[]
): Promise<string> {
  const response = await withRetry(() => client.chat(messages), {
    maxRetries: 3,
    baseDelayMs: 1000,
  });

  return response.message.content || '';
}

// ============================================================================
// 3. STREAMING ERROR HANDLING
// ============================================================================

/**
 * Handle errors during streaming with graceful degradation
 */
async function handleStreamingErrors(client: PuterClient): Promise<void> {
  const messages: PuterChatMessage[] = [
    { role: 'user', content: 'Write a short story about a robot.' },
  ];

  let fullContent = '';
  let streamFailed = false;

  try {
    for await (const chunk of client.chatStream(messages)) {
      if (chunk.text) {
        fullContent += chunk.text;
        process.stdout.write(chunk.text);
      }

      if (chunk.done) {
        console.log('\n✅ Stream completed successfully');
      }
    }
  } catch (error) {
    streamFailed = true;
    console.error('\n⚠️ Streaming failed, attempting non-streaming fallback...');

    // Fallback to non-streaming request
    try {
      const response = await client.chat(messages);
      fullContent = response.message.content || '';
      console.log('Fallback response:', fullContent);
    } catch (fallbackError) {
      console.error('❌ Fallback also failed:', fallbackError);
      throw fallbackError;
    }
  }

  console.log(`\nTotal content length: ${fullContent.length} characters`);
  if (streamFailed) {
    console.log('⚠️ Response obtained via non-streaming fallback');
  }
}

// ============================================================================
// 4. TIMEOUT HANDLING
// ============================================================================

/**
 * Custom timeout wrapper for long-running requests
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Example: Chat with custom timeout
 */
async function chatWithTimeout(
  client: PuterClient,
  messages: PuterChatMessage[],
  timeoutMs = 60000
): Promise<string> {
  try {
    const response = await withTimeout(
      client.chat(messages),
      timeoutMs,
      `Request timed out after ${timeoutMs / 1000} seconds`
    );
    return response.message.content || '';
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) {
      console.error('⏱️ Request took too long. Consider:');
      console.log('   → Using a faster model (gpt-5-nano, claude-haiku-4-5)');
      console.log('   → Reducing max_tokens');
      console.log('   → Simplifying the prompt');
    }
    throw error;
  }
}

// ============================================================================
// 5. GRACEFUL DEGRADATION WITH MODEL FALLBACK
// ============================================================================

/**
 * Try multiple models in order of preference, falling back on errors
 */
async function chatWithModelFallback(
  client: PuterClient,
  messages: PuterChatMessage[]
): Promise<{ content: string; model: string }> {
  const modelPreference = [
    'claude-opus-4-5',      // Best quality, but might be rate-limited
    'claude-sonnet-4-5',    // Great quality, usually available
    'gpt-5-nano',           // Fast fallback
    'gemini-2.5-flash',     // Alternative provider
  ];

  for (const model of modelPreference) {
    try {
      console.log(`Trying model: ${model}...`);
      const response = await client.chat(messages, { model });
      console.log(`✅ Success with ${model}`);
      return {
        content: response.message.content || '',
        model,
      };
    } catch (error) {
      console.warn(`⚠️ ${model} failed, trying next...`);
      continue;
    }
  }

  throw new Error('All models failed');
}

// ============================================================================
// 6. TOKEN EXPIRY HANDLING
// ============================================================================

/**
 * Wrapper that detects token expiry and provides guidance
 */
async function safeChat(
  client: PuterClient,
  messages: PuterChatMessage[]
): Promise<string> {
  try {
    const response = await client.chat(messages);
    return response.message.content || '';
  } catch (error) {
    if (error instanceof Error && error.message.includes('(401)')) {
      console.error('\n🔐 Authentication Error');
      console.log('═'.repeat(50));
      console.log('Your Puter token has expired or is invalid.\n');
      console.log('To fix this:');
      console.log('1. In OpenCode, run the puter_login tool');
      console.log('2. Complete the authentication in your browser');
      console.log('3. Try your request again\n');
      console.log('═'.repeat(50));
    }
    throw error;
  }
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

async function main(): Promise<void> {
  // In real usage, get token from PuterAuth.getActiveAccount()
  const MOCK_TOKEN = 'your-auth-token';
  const client = new PuterClient(MOCK_TOKEN);

  const messages: PuterChatMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the meaning of life?' },
  ];

  console.log('Example 1: Basic error handling');
  await handleBasicErrors(client);

  console.log('\nExample 2: Chat with retry');
  const retryResult = await chatWithRetry(client, messages);
  console.log('Result:', retryResult);

  console.log('\nExample 3: Streaming with fallback');
  await handleStreamingErrors(client);

  console.log('\nExample 4: Chat with timeout');
  const timeoutResult = await chatWithTimeout(client, messages, 30000);
  console.log('Result:', timeoutResult);

  console.log('\nExample 5: Model fallback');
  const fallbackResult = await chatWithModelFallback(client, messages);
  console.log(`Result from ${fallbackResult.model}:`, fallbackResult.content);
}

// Run if executed directly
main().catch(console.error);

export {
  handleBasicErrors,
  withRetry,
  chatWithRetry,
  handleStreamingErrors,
  withTimeout,
  chatWithTimeout,
  chatWithModelFallback,
  safeChat,
};
