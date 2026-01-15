/**
 * Tests for Puter Provider Integration
 * 
 * Tests the request/response transformation between Google Generative Language API
 * format and Puter's API format.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isPuterRequest,
  extractModelFromUrl,
  isStreamingRequest,
  transformRequestToPuter,
  transformPuterResponseToGoogle,
  transformPuterStreamChunkToGoogle,
  createPuterFetch,
} from '../src/provider.js';

describe('Provider', () => {
  describe('isPuterRequest', () => {
    it('should detect puter- prefix in model URL', () => {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/puter-claude-opus-4-5:generateContent';
      expect(isPuterRequest(url)).toBe(true);
    });

    it('should detect localhost:8080 URL', () => {
      expect(isPuterRequest('http://localhost:8080/v1/models/claude-opus-4-5:generateContent')).toBe(true);
    });

    it('should detect localhost:8080 with path', () => {
      expect(isPuterRequest('http://localhost:8080/v1/chat/completions')).toBe(true);
    });

    it('should not detect non-puter URLs', () => {
      expect(isPuterRequest('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent')).toBe(false);
    });

    it('should not detect antigravity URLs', () => {
      expect(isPuterRequest('https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-opus-4-5:generateContent')).toBe(false);
    });

    it('should handle Request objects', () => {
      const request = new Request('https://generativelanguage.googleapis.com/v1beta/models/puter-gpt-4o:generateContent');
      expect(isPuterRequest(request)).toBe(true);
    });

    it('should handle URL objects', () => {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models/puter-gemini-2.5-pro:streamGenerateContent');
      expect(isPuterRequest(url)).toBe(true);
    });
  });

  describe('extractModelFromUrl', () => {
    it('should extract model and strip puter- prefix', () => {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/puter-claude-opus-4-5:generateContent';
      expect(extractModelFromUrl(url)).toBe('claude-opus-4-5');
    });

    it('should handle streaming URLs', () => {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/puter-gpt-4o:streamGenerateContent?alt=sse';
      expect(extractModelFromUrl(url)).toBe('gpt-4o');
    });

    it('should handle models without puter- prefix', () => {
      const url = 'https://puter.local/v1/models/claude-sonnet-4:generateContent';
      expect(extractModelFromUrl(url)).toBe('claude-sonnet-4');
    });

    it('should return default model if no match', () => {
      const url = 'https://api.example.com/chat';
      // Default is 'puter-claude-opus-4-5' but prefix is stripped
      expect(extractModelFromUrl(url)).toBe('claude-opus-4-5');
    });
  });

  describe('isStreamingRequest', () => {
    it('should detect streamGenerateContent', () => {
      expect(isStreamingRequest('https://api.example.com/models/test:streamGenerateContent')).toBe(true);
    });

    it('should detect alt=sse parameter', () => {
      expect(isStreamingRequest('https://api.example.com/models/test:generateContent?alt=sse')).toBe(true);
    });

    it('should not detect non-streaming requests', () => {
      expect(isStreamingRequest('https://api.example.com/models/test:generateContent')).toBe(false);
    });
  });

  describe('transformRequestToPuter', () => {
    it('should transform basic chat request', () => {
      const googleBody = {
        contents: [
          { role: 'user', parts: [{ text: 'Hello!' }] },
        ],
      };

      const result = transformRequestToPuter(googleBody, 'claude-opus-4-5', false, 'test-token');

      expect(result.interface).toBe('puter-chat-completion');
      expect(result.service).toBe('ai-chat');
      expect(result.method).toBe('complete');
      expect(result.auth_token).toBe('test-token');
      expect(result.args.model).toBe('claude-opus-4-5');
      expect(result.args.stream).toBe(false);
      expect(result.args.messages).toHaveLength(1);
      expect(result.args.messages[0]).toEqual({
        role: 'user',
        content: 'Hello!',
      });
    });

    it('should transform system instruction', () => {
      const googleBody = {
        systemInstruction: 'You are a helpful assistant.',
        contents: [
          { role: 'user', parts: [{ text: 'Hi' }] },
        ],
      };

      const result = transformRequestToPuter(googleBody, 'gpt-4o', false, 'token');

      expect(result.args.messages).toHaveLength(2);
      expect(result.args.messages[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant.',
      });
    });

    it('should transform system instruction with parts', () => {
      const googleBody = {
        systemInstruction: {
          parts: [{ text: 'Part 1' }, { text: 'Part 2' }],
        },
        contents: [
          { role: 'user', parts: [{ text: 'Hi' }] },
        ],
      };

      const result = transformRequestToPuter(googleBody, 'gpt-4o', false, 'token');

      expect(result.args.messages[0].content).toBe('Part 1\nPart 2');
    });

    it('should transform model role to assistant', () => {
      const googleBody = {
        contents: [
          { role: 'user', parts: [{ text: 'Hi' }] },
          { role: 'model', parts: [{ text: 'Hello!' }] },
        ],
      };

      const result = transformRequestToPuter(googleBody, 'claude-sonnet-4', false, 'token');

      expect(result.args.messages[1].role).toBe('assistant');
    });

    it('should transform function declarations to tools', () => {
      const googleBody = {
        contents: [{ role: 'user', parts: [{ text: 'Get weather' }] }],
        tools: [{
          functionDeclarations: [{
            name: 'get_weather',
            description: 'Get current weather',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
            },
          }],
        }],
      };

      const result = transformRequestToPuter(googleBody, 'gpt-4o', false, 'token');

      expect(result.args.tools).toHaveLength(1);
      expect(result.args.tools![0]).toEqual({
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
          },
        },
      });
    });

    it('should transform generation config', () => {
      const googleBody = {
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.7,
        },
      };

      const result = transformRequestToPuter(googleBody, 'claude-opus-4-5', false, 'token');

      expect(result.args.max_tokens).toBe(1000);
      expect(result.args.temperature).toBe(0.7);
    });

    it('should handle streaming flag', () => {
      const googleBody = {
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
      };

      const result = transformRequestToPuter(googleBody, 'gpt-4o', true, 'token');

      expect(result.args.stream).toBe(true);
    });

    it('should transform function calls in content', () => {
      const googleBody = {
        contents: [{
          role: 'model',
          parts: [{
            functionCall: {
              name: 'get_weather',
              args: { location: 'NYC' },
            },
          }],
        }],
      };

      const result = transformRequestToPuter(googleBody, 'gpt-4o', false, 'token');

      expect(result.args.messages[0].role).toBe('assistant');
      expect(result.args.messages[0].tool_calls).toHaveLength(1);
      expect(result.args.messages[0].tool_calls![0].function.name).toBe('get_weather');
    });

    it('should transform function responses', () => {
      const googleBody = {
        contents: [{
          role: 'user',
          parts: [{
            functionResponse: {
              name: 'get_weather',
              response: { temp: 72 },
              id: 'call_123',
            },
          }],
        }],
      };

      const result = transformRequestToPuter(googleBody, 'gpt-4o', false, 'token');

      expect(result.args.messages[0].role).toBe('tool');
      expect(result.args.messages[0].tool_call_id).toBe('call_123');
    });
  });

  describe('transformPuterResponseToGoogle', () => {
    it('should transform basic response', () => {
      const puterResponse = {
        message: {
          role: 'assistant',
          content: 'Hello there!',
        },
        finish_reason: 'stop',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const result = transformPuterResponseToGoogle(puterResponse);

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].content.role).toBe('model');
      expect(result.candidates[0].content.parts).toHaveLength(1);
      expect(result.candidates[0].content.parts[0]).toEqual({ text: 'Hello there!' });
      expect(result.candidates[0].finishReason).toBe('STOP');
      expect(result.usageMetadata).toEqual({
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      });
    });

    it('should transform tool_calls finish reason', () => {
      const puterResponse = {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"location":"NYC"}',
            },
          }],
        },
        finish_reason: 'tool_calls',
      };

      const result = transformPuterResponseToGoogle(puterResponse);

      expect(result.candidates[0].finishReason).toBe('TOOL_CALLS');
      expect(result.candidates[0].content.parts).toHaveLength(1);
      expect(result.candidates[0].content.parts[0]).toHaveProperty('functionCall');
    });

    it('should transform length finish reason', () => {
      const puterResponse = {
        message: {
          role: 'assistant',
          content: 'Truncated...',
        },
        finish_reason: 'length',
      };

      const result = transformPuterResponseToGoogle(puterResponse);

      expect(result.candidates[0].finishReason).toBe('MAX_TOKENS');
    });

    it('should handle null content', () => {
      const puterResponse = {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'test',
              arguments: '{}',
            },
          }],
        },
        finish_reason: 'tool_calls',
      };

      const result = transformPuterResponseToGoogle(puterResponse);

      // Should only have function call, no text part
      expect(result.candidates[0].content.parts).toHaveLength(1);
      expect(result.candidates[0].content.parts[0]).toHaveProperty('functionCall');
    });
  });

  describe('transformPuterStreamChunkToGoogle', () => {
    it('should transform text chunk', () => {
      const chunk = {
        text: 'Hello',
      };

      const result = transformPuterStreamChunkToGoogle(chunk);

      expect(result).toContain('data: ');
      const parsed = JSON.parse(result.replace('data: ', '').trim());
      expect(parsed.candidates[0].content.parts[0]).toEqual({ text: 'Hello' });
    });

    it('should transform reasoning chunk', () => {
      const chunk = {
        reasoning: 'Let me think...',
      };

      const result = transformPuterStreamChunkToGoogle(chunk);

      const parsed = JSON.parse(result.replace('data: ', '').trim());
      expect(parsed.candidates[0].content.parts[0]).toEqual({
        thought: true,
        text: 'Let me think...',
      });
    });

    it('should transform done chunk', () => {
      const chunk = {
        done: true,
        finish_reason: 'stop',
      };

      const result = transformPuterStreamChunkToGoogle(chunk);

      const parsed = JSON.parse(result.replace('data: ', '').trim());
      expect(parsed.candidates[0].finishReason).toBe('STOP');
    });

    it('should transform tool_calls chunk', () => {
      const chunk = {
        tool_calls: [{
          id: 'call_1',
          type: 'function' as const,
          function: {
            name: 'test',
            arguments: '{}',
          },
        }],
        finish_reason: 'tool_calls',
      };

      const result = transformPuterStreamChunkToGoogle(chunk);

      const parsed = JSON.parse(result.replace('data: ', '').trim());
      expect(parsed.candidates[0].content.parts[0]).toHaveProperty('functionCall');
      expect(parsed.candidates[0].finishReason).toBe('TOOL_CALLS');
    });
  });

  describe('createPuterFetch', () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it('should pass through non-puter requests', async () => {
      const mockResponse = new Response('OK');
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const puterFetch = createPuterFetch('test-token');
      const result = await puterFetch('https://example.com/api');

      expect(global.fetch).toHaveBeenCalledWith('https://example.com/api', undefined);
      expect(result).toBe(mockResponse);
    });

    it('should intercept puter requests', async () => {
      const mockPuterResponse = {
        result: {
          message: {
            role: 'assistant',
            content: 'Hello!',
          },
          finish_reason: 'stop',
        },
      };

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockPuterResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const puterFetch = createPuterFetch('test-token');
      const result = await puterFetch(
        'https://generativelanguage.googleapis.com/v1beta/models/puter-claude-opus-4-5:generateContent',
        {
          method: 'POST',
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          }),
        }
      );

      // Should call Puter API
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.puter.com/drivers/call',
        expect.objectContaining({
          method: 'POST',
        })
      );

      // Response should be transformed to Google format
      const responseBody = await result.json();
      expect(responseBody.candidates).toBeDefined();
      expect(responseBody.candidates[0].content.parts[0].text).toBe('Hello!');
    });
  });
});
