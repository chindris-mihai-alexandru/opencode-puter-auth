/**
 * Puter API Client
 * 
 * Handles all communication with Puter.com's AI API
 */

import type {
  PuterChatMessage,
  PuterChatOptions,
  PuterChatResponse,
  PuterChatStreamChunk,
  PuterModelInfo,
  PuterConfig,
} from './types.js';

const DEFAULT_API_URL = 'https://api.puter.com';
const DEFAULT_TIMEOUT = 120000;

export class PuterClient {
  private authToken: string;
  private config: Partial<PuterConfig>;

  constructor(authToken: string, config: Partial<PuterConfig> = {}) {
    this.authToken = authToken;
    this.config = config;
  }

  /**
   * Get the API base URL
   */
  private get apiUrl(): string {
    return this.config.api_base_url || DEFAULT_API_URL;
  }

  /**
   * Get the request timeout
   */
  private get timeout(): number {
    return this.config.api_timeout_ms || DEFAULT_TIMEOUT;
  }

  /**
   * Update the auth token
   */
  public setAuthToken(token: string): void {
    this.authToken = token;
  }

  /**
   * Send a chat completion request (non-streaming)
   */
  public async chat(
    messages: PuterChatMessage[],
    options: PuterChatOptions = {}
  ): Promise<PuterChatResponse> {
    const response = await this.makeRequest('complete', {
      messages,
      model: options.model || 'gpt-5-nano',
      stream: false,
      max_tokens: options.max_tokens,
      temperature: options.temperature,
      tools: options.tools,
    });

    return response.result as PuterChatResponse;
  }

  /**
   * Send a streaming chat completion request
   */
  public async *chatStream(
    messages: PuterChatMessage[],
    options: PuterChatOptions = {}
  ): AsyncGenerator<PuterChatStreamChunk> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.apiUrl}/drivers/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          interface: 'puter-chat-completion',
          service: 'ai-chat',
          method: 'complete',
          args: {
            messages,
            model: options.model || 'gpt-5-nano',
            stream: true,
            max_tokens: options.max_tokens,
            temperature: options.temperature,
            tools: options.tools,
          },
          auth_token: this.authToken,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Puter API error (${response.status}): ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const chunk = JSON.parse(line) as PuterChatStreamChunk;
            yield chunk;
            
            if (chunk.done) {
              return;
            }
          } catch {
            // Skip malformed JSON lines
            continue;
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer) as PuterChatStreamChunk;
          yield chunk;
        } catch {
          // Ignore
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * List available models
   */
  public async listModels(): Promise<PuterModelInfo[]> {
    try {
      const response = await fetch(`${this.apiUrl}/puterai/chat/models/details`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = await response.json();
      return data.models || data || [];
    } catch (error) {
      // Return default models if API fails
      return this.getDefaultModels();
    }
  }

  /**
   * Get default model list (fallback)
   */
  private getDefaultModels(): PuterModelInfo[] {
    return [
      // Claude Models
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic', context_window: 200000, max_output_tokens: 64000, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic', context_window: 200000, max_output_tokens: 64000, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic', context_window: 200000, max_output_tokens: 64000, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', context_window: 200000, max_output_tokens: 64000, supports_streaming: true, supports_tools: true, supports_vision: true },
      
      // GPT Models
      { id: 'gpt-5-nano', name: 'GPT-5 Nano', provider: 'openai', context_window: 128000, max_output_tokens: 16384, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'openai', context_window: 128000, max_output_tokens: 32768, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', context_window: 128000, max_output_tokens: 16384, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'o3-mini', name: 'o3-mini', provider: 'openai', context_window: 128000, max_output_tokens: 32768, supports_streaming: true, supports_tools: true, supports_vision: false },
      
      // Gemini Models
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', context_window: 1000000, max_output_tokens: 65536, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', context_window: 1000000, max_output_tokens: 65536, supports_streaming: true, supports_tools: true, supports_vision: true },
    ];
  }

  /**
   * Make a generic API request to the drivers endpoint
   */
  private async makeRequest(
    method: string,
    args: Record<string, unknown>
  ): Promise<{ result: unknown }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.apiUrl}/drivers/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          interface: 'puter-chat-completion',
          service: 'ai-chat',
          method,
          args,
          auth_token: this.authToken,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Puter API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Test the connection and auth token
   */
  public async testConnection(): Promise<boolean> {
    try {
      const response = await this.chat(
        [{ role: 'user', content: 'Say "OK" and nothing else.' }],
        { model: 'gpt-5-nano', max_tokens: 10 }
      );
      return !!response.message?.content;
    } catch {
      return false;
    }
  }
}
