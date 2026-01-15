/**
 * Tests for Puter AI SDK Provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPuter, PuterChatLanguageModel } from '../src/ai-provider/index.js';
import type { LanguageModelV3CallOptions, LanguageModelV3Message } from '@ai-sdk/provider';

// Mock fetch
const mockFetch = vi.fn();

describe('Puter AI SDK Provider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createPuter', () => {
    it('should create a provider instance', () => {
      const provider = createPuter({
        authToken: 'test-token',
      });

      expect(provider).toBeDefined();
      expect(typeof provider).toBe('function');
      expect(typeof provider.languageModel).toBe('function');
      expect(typeof provider.chat).toBe('function');
    });

    it('should create a language model when called as function', () => {
      const provider = createPuter({
        authToken: 'test-token',
      });

      const model = provider('claude-opus-4-5');

      expect(model).toBeInstanceOf(PuterChatLanguageModel);
      expect(model.modelId).toBe('claude-opus-4-5');
      expect(model.provider).toBe('puter');
      expect(model.specificationVersion).toBe('v3');
    });

    it('should create a language model via languageModel method', () => {
      const provider = createPuter({
        authToken: 'test-token',
      });

      const model = provider.languageModel('gpt-4o');

      expect(model).toBeInstanceOf(PuterChatLanguageModel);
      expect(model.modelId).toBe('gpt-4o');
    });

    it('should create a language model via chat method', () => {
      const provider = createPuter({
        authToken: 'test-token',
      });

      const model = provider.chat('gemini-2.5-pro');

      expect(model).toBeInstanceOf(PuterChatLanguageModel);
      expect(model.modelId).toBe('gemini-2.5-pro');
    });

    it('should use custom base URL', () => {
      const provider = createPuter({
        authToken: 'test-token',
        baseURL: 'https://custom.api.com',
      });

      const model = provider('claude-opus-4-5');
      expect(model).toBeInstanceOf(PuterChatLanguageModel);
    });

    it('should throw when called with new keyword', () => {
      const provider = createPuter({
        authToken: 'test-token',
      });

      expect(() => {
        // @ts-expect-error - Testing runtime behavior
        new provider('claude-opus-4-5');
      }).toThrow('cannot be called with the new keyword');
    });

    it('should throw for unsupported model types', () => {
      const provider = createPuter({
        authToken: 'test-token',
      });

      expect(() => {
        (provider as any).embeddingModel('test');
      }).toThrow('does not support embedding models');

      expect(() => {
        (provider as any).imageModel('test');
      }).toThrow('does not support image models');
    });
  });

  describe('PuterChatLanguageModel', () => {
    it('should have correct specification version', () => {
      const provider = createPuter({
        authToken: 'test-token',
      });

      const model = provider('claude-opus-4-5');

      expect(model.specificationVersion).toBe('v3');
    });

    it('should return empty supportedUrls', () => {
      const provider = createPuter({
        authToken: 'test-token',
      });

      const model = provider('claude-opus-4-5');

      expect(model.supportedUrls).toEqual({});
    });

    describe('doGenerate', () => {
      it('should make a non-streaming request to Puter API', async () => {
        const mockResponse = {
          success: true,
          result: {
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you?',
            },
            finish_reason: 'stop',
            usage: {
              prompt_tokens: 10,
              completion_tokens: 8,
              total_tokens: 18,
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        });

        const provider = createPuter({
          authToken: 'test-token',
          fetch: mockFetch,
        });

        const model = provider('claude-opus-4-5');

        const prompt: LanguageModelV3Message[] = [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        ];

        const result = await model.doGenerate({
          prompt,
          maxOutputTokens: 1000,
        } as LanguageModelV3CallOptions);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.puter.com/drivers/call',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
            }),
          })
        );

        // Check request body
        const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(requestBody.interface).toBe('puter-chat-completion');
        expect(requestBody.args.model).toBe('claude-opus-4-5');
        expect(requestBody.args.stream).toBe(false);
        expect(requestBody.args.messages).toHaveLength(1);
        expect(requestBody.args.messages[0].role).toBe('user');
        expect(requestBody.args.messages[0].content).toBe('Hello');

        // Check result
        expect(result.content).toHaveLength(1);
        expect(result.content[0]).toEqual({
          type: 'text',
          text: 'Hello! How can I help you?',
        });
        expect(result.finishReason.unified).toBe('stop');
        expect(result.usage.inputTokens.total).toBe(10);
        expect(result.usage.outputTokens.total).toBe(8);
      });

      it('should handle tool calls in response', async () => {
        const mockResponse = {
          success: true,
          result: {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "San Francisco"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
            usage: {
              prompt_tokens: 20,
              completion_tokens: 15,
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        });

        const provider = createPuter({
          authToken: 'test-token',
          fetch: mockFetch,
        });

        const model = provider('claude-opus-4-5');

        const result = await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'What is the weather?' }] }],
        } as LanguageModelV3CallOptions);

        expect(result.content).toHaveLength(1);
        expect(result.content[0]).toEqual({
          type: 'tool-call',
          toolCallId: 'call_123',
          toolName: 'get_weather',
          input: '{"location": "San Francisco"}',
        });
        expect(result.finishReason.unified).toBe('tool-calls');
      });

      it('should handle API errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        });

        const provider = createPuter({
          authToken: 'test-token',
          fetch: mockFetch,
        });

        const model = provider('claude-opus-4-5');

        await expect(
          model.doGenerate({
            prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
          } as LanguageModelV3CallOptions)
        ).rejects.toThrow('Puter API error (500)');
      });

      it('should handle Puter error responses', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            error: {
              message: 'Rate limit exceeded',
              code: 'rate_limit',
            },
          }),
        });

        const provider = createPuter({
          authToken: 'test-token',
          fetch: mockFetch,
        });

        const model = provider('claude-opus-4-5');

        await expect(
          model.doGenerate({
            prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
          } as LanguageModelV3CallOptions)
        ).rejects.toThrow('Rate limit exceeded');
      });
    });

    describe('doStream', () => {
      it('should make a streaming request to Puter API', async () => {
        // Create a mock readable stream
        const chunks = [
          JSON.stringify({ text: 'Hello' }) + '\n',
          JSON.stringify({ text: ' world!' }) + '\n',
          JSON.stringify({ done: true, finish_reason: 'stop', usage: { prompt_tokens: 5, completion_tokens: 2 } }) + '\n',
        ];

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
          },
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          body: stream,
        });

        const provider = createPuter({
          authToken: 'test-token',
          fetch: mockFetch,
          generateId: () => 'test-id',
        });

        const model = provider('claude-opus-4-5');

        const result = await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        } as LanguageModelV3CallOptions);

        expect(result.stream).toBeDefined();

        // Read all stream parts
        const reader = result.stream.getReader();
        const parts: any[] = [];
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
        }

        // Check stream parts
        expect(parts.length).toBeGreaterThan(0);
        expect(parts[0].type).toBe('stream-start');
        
        // Find text parts
        const textParts = parts.filter(p => p.type === 'text-delta');
        expect(textParts.length).toBe(2);
        expect(textParts[0].delta).toBe('Hello');
        expect(textParts[1].delta).toBe(' world!');

        // Find finish part
        const finishPart = parts.find(p => p.type === 'finish');
        expect(finishPart).toBeDefined();
        expect(finishPart.finishReason.unified).toBe('stop');
      });

      it('should handle streaming errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable',
        });

        const provider = createPuter({
          authToken: 'test-token',
          fetch: mockFetch,
        });

        const model = provider('claude-opus-4-5');

        await expect(
          model.doStream({
            prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
          } as LanguageModelV3CallOptions)
        ).rejects.toThrow('Puter API error (503)');
      });

      it('should handle missing response body', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          body: null,
        });

        const provider = createPuter({
          authToken: 'test-token',
          fetch: mockFetch,
        });

        const model = provider('claude-opus-4-5');

        await expect(
          model.doStream({
            prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
          } as LanguageModelV3CallOptions)
        ).rejects.toThrow('No response body for streaming');
      });
    });

    describe('message conversion', () => {
      it('should convert system messages', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            result: { message: { content: 'OK' }, finish_reason: 'stop' },
          }),
        });

        const provider = createPuter({
          authToken: 'test-token',
          fetch: mockFetch,
        });

        const model = provider('claude-opus-4-5');

        await model.doGenerate({
          prompt: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
          ],
        } as LanguageModelV3CallOptions);

        const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(requestBody.args.messages[0]).toEqual({
          role: 'system',
          content: 'You are a helpful assistant.',
        });
      });

      it('should convert tool results', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            result: { message: { content: 'The weather is sunny.' }, finish_reason: 'stop' },
          }),
        });

        const provider = createPuter({
          authToken: 'test-token',
          fetch: mockFetch,
        });

        const model = provider('claude-opus-4-5');

        await model.doGenerate({
          prompt: [
            { role: 'user', content: [{ type: 'text', text: 'What is the weather?' }] },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCallId: 'call_123',
                  toolName: 'get_weather',
                  input: { location: 'San Francisco' },
                },
              ],
            },
            {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId: 'call_123',
                  toolName: 'get_weather',
                  output: 'Sunny, 72°F',
                },
              ],
            },
          ],
        } as LanguageModelV3CallOptions);

        const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        
        // Check assistant message with tool call
        expect(requestBody.args.messages[1].role).toBe('assistant');
        expect(requestBody.args.messages[1].tool_calls).toHaveLength(1);
        expect(requestBody.args.messages[1].tool_calls[0].function.name).toBe('get_weather');

        // Check tool result message
        expect(requestBody.args.messages[2].role).toBe('tool');
        expect(requestBody.args.messages[2].tool_call_id).toBe('call_123');
        expect(requestBody.args.messages[2].content).toBe('Sunny, 72°F');
      });

      it('should convert tools to Puter format', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            result: { message: { content: 'OK' }, finish_reason: 'stop' },
          }),
        });

        const provider = createPuter({
          authToken: 'test-token',
          fetch: mockFetch,
        });

        const model = provider('claude-opus-4-5');

        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
          tools: [
            {
              type: 'function',
              name: 'get_weather',
              description: 'Get the current weather',
              inputSchema: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
                required: ['location'],
              },
            },
          ],
        } as LanguageModelV3CallOptions);

        const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(requestBody.args.tools).toHaveLength(1);
        expect(requestBody.args.tools[0]).toEqual({
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
              required: ['location'],
            },
          },
        });
      });
    });

    describe('finish reason mapping', () => {
      const testCases = [
        { input: 'stop', expected: 'stop' },
        { input: 'end_turn', expected: 'stop' },
        { input: 'length', expected: 'length' },
        { input: 'max_tokens', expected: 'length' },
        { input: 'tool_calls', expected: 'tool-calls' },
        { input: 'tool_use', expected: 'tool-calls' },
        { input: 'content_filter', expected: 'content-filter' },
        { input: 'unknown', expected: 'other' },
        { input: undefined, expected: 'other' },
      ];

      for (const { input, expected } of testCases) {
        it(`should map "${input}" to "${expected}"`, async () => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              result: { message: { content: 'OK' }, finish_reason: input },
            }),
          });

          const provider = createPuter({
            authToken: 'test-token',
            fetch: mockFetch,
          });

          const model = provider('claude-opus-4-5');

          const result = await model.doGenerate({
            prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
          } as LanguageModelV3CallOptions);

          expect(result.finishReason.unified).toBe(expected);
          expect(result.finishReason.raw).toBe(input);
        });
      }
    });
  });
});
