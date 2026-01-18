/**
 * Puter Chat Language Model
 * 
 * Implements the AI SDK LanguageModelV3 interface using the official @heyputer/puter.js SDK.
 * This enables Puter to work as a proper AI SDK provider in OpenCode.
 */

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3Usage,
  LanguageModelV3Message,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultPart,
  LanguageModelV3FunctionTool,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { PuterChatSettings, PuterChatConfig } from './puter-chat-settings.js';

// Type definitions for Puter SDK responses
interface PuterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
}

interface PuterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// Content block from Claude-style response
interface PuterContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  // For tool_use blocks
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface PuterChatResponse {
  index?: number;
  message?: {
    role: string;
    // Content can be a string OR an array of content blocks (Claude-style)
    content: string | PuterContentBlock[] | null;
    tool_calls?: PuterToolCall[];
    refusal?: string | null;
  };
  finish_reason?: string;
  usage?: PuterUsage;
  via_ai_chat_service?: boolean;
  toString?: () => string;
  valueOf?: () => string;
}

interface PuterStreamChunk {
  type?: string;
  text?: string;
  usage?: PuterUsage;
}

// Puter SDK message format
interface PuterSDKMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | PuterSDKContentPart[];
  tool_call_id?: string;
  tool_calls?: PuterToolCall[];
}

interface PuterSDKContentPart {
  type: 'text' | 'tool_result';
  text?: string;
  tool_use_id?: string;
  content?: string;
}

interface PuterSDKTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface PuterSDKOptions {
  model: string;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop?: string[];
  tools?: PuterSDKTool[];
}

// Type for the Puter SDK instance
interface PuterSDK {
  ai: {
    chat: (
      messages: string | PuterSDKMessage[],
      options?: PuterSDKOptions
    ) => Promise<PuterChatResponse | AsyncIterable<PuterStreamChunk>>;
  };
  setAuthToken: (token: string) => void;
  print: (message: unknown) => void;
}

/**
 * Puter Chat Language Model implementing LanguageModelV3.
 * Uses the official @heyputer/puter.js SDK for all API calls.
 */
export class PuterChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider: string;
  readonly modelId: string;
  
  private readonly settings: PuterChatSettings;
  private readonly config: PuterChatConfig;
  private puterInstance: PuterSDK | null = null;

  constructor(
    modelId: string,
    settings: PuterChatSettings,
    config: PuterChatConfig
  ) {
    this.modelId = modelId;
    this.settings = settings;
    this.config = config;
    this.provider = config.provider;
  }

  /**
   * Initialize the Puter SDK with auth token.
   */
  private async initPuterSDK(): Promise<PuterSDK> {
    if (this.puterInstance) {
      return this.puterInstance;
    }

    // Dynamically import the Puter SDK init function
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const { init } = require('@heyputer/puter.js/src/init.cjs') as { init: (token?: string) => PuterSDK };

    // Get auth token from config headers
    const headers = await this.config.headers();
    const authHeader = headers['Authorization'] || '';
    const authToken = authHeader.replace('Bearer ', '');

    if (!authToken) {
      throw new Error(
        'Puter auth token is required. Please authenticate with `npx opencode-puter-auth login` or set PUTER_AUTH_TOKEN.'
      );
    }

    // Initialize the SDK with the auth token
    this.puterInstance = init(authToken);
    return this.puterInstance;
  }

  /**
   * Supported URL patterns for native file handling.
   * Puter doesn't natively handle URLs, so we return an empty map.
   */
  get supportedUrls(): Record<string, RegExp[]> {
    return {};
  }

  /**
   * Convert AI SDK prompt to Puter SDK message format.
   */
  private convertPromptToMessages(prompt: LanguageModelV3Message[]): PuterSDKMessage[] {
    const messages: PuterSDKMessage[] = [];

    for (const message of prompt) {
      if (message.role === 'system') {
        messages.push({
          role: 'system',
          content: message.content,
        });
      } else if (message.role === 'user') {
        // Extract text from user message parts
        const textParts = message.content
          .filter((part): part is LanguageModelV3TextPart => part.type === 'text')
          .map(part => part.text);
        
        messages.push({
          role: 'user',
          content: textParts.join('\n'),
        });
      } else if (message.role === 'assistant') {
        // Handle assistant messages with potential tool calls
        const textParts = message.content
          .filter((part): part is LanguageModelV3TextPart => part.type === 'text')
          .map(part => part.text);
        
        const toolCallParts = message.content
          .filter((part): part is LanguageModelV3ToolCallPart => part.type === 'tool-call');

        const puterMessage: PuterSDKMessage = {
          role: 'assistant',
          content: textParts.join('\n') || '',
        };

        if (toolCallParts.length > 0) {
          puterMessage.tool_calls = toolCallParts.map(tc => ({
            id: tc.toolCallId,
            type: 'function' as const,
            function: {
              name: tc.toolName,
              arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input),
            },
          }));
        }

        messages.push(puterMessage);
      } else if (message.role === 'tool') {
        // Handle tool results
        for (const part of message.content) {
          if (part.type === 'tool-result') {
            const toolResultPart = part as LanguageModelV3ToolResultPart;
            const output = toolResultPart.output;
            let contentStr: string;
            if (typeof output === 'string') {
              contentStr = output;
            } else if (Array.isArray(output)) {
              // Handle array of output parts
              contentStr = output.map(p => {
                if (p.type === 'text') return p.text;
                return JSON.stringify(p);
              }).join('\n');
            } else {
              contentStr = JSON.stringify(output);
            }
            messages.push({
              role: 'tool',
              content: contentStr,
              tool_call_id: toolResultPart.toolCallId,
            });
          }
        }
      }
    }

    return messages;
  }

  /**
   * Convert AI SDK tools to Puter SDK tool format.
   */
  private convertTools(tools: LanguageModelV3FunctionTool[] | undefined): PuterSDKTool[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.inputSchema as Record<string, unknown>,
      },
    }));
  }

  /**
   * Build options for Puter SDK chat call.
   */
  private buildSDKOptions(options: LanguageModelV3CallOptions, streaming: boolean): PuterSDKOptions {
    // Filter to only function tools
    const functionTools = options.tools?.filter(
      (tool): tool is LanguageModelV3FunctionTool => tool.type === 'function'
    );
    const tools = this.convertTools(functionTools);

    const sdkOptions: PuterSDKOptions = {
      model: this.modelId,
      stream: streaming,
    };

    // Only add optional params if they have values
    const maxTokens = options.maxOutputTokens ?? this.settings.maxTokens;
    if (maxTokens !== undefined) sdkOptions.max_tokens = maxTokens;

    const temperature = options.temperature ?? this.settings.temperature;
    if (temperature !== undefined) sdkOptions.temperature = temperature;

    const topP = options.topP ?? this.settings.topP;
    if (topP !== undefined) sdkOptions.top_p = topP;

    const topK = options.topK ?? this.settings.topK;
    if (topK !== undefined) sdkOptions.top_k = topK;

    const stop = options.stopSequences ?? this.settings.stopSequences;
    if (stop !== undefined) sdkOptions.stop = stop;

    if (tools !== undefined) sdkOptions.tools = tools;

    return sdkOptions;
  }

  /**
   * Map Puter finish reason to AI SDK format.
   */
  private mapFinishReason(reason?: string): LanguageModelV3FinishReason {
    const unified = (() => {
      if (!reason) return 'other';
      if (reason === 'stop' || reason === 'end_turn') return 'stop';
      if (reason === 'length' || reason === 'max_tokens') return 'length';
      if (reason === 'tool_calls' || reason === 'tool_use') return 'tool-calls';
      if (reason === 'content_filter') return 'content-filter';
      return 'other';
    })();

    return {
      unified,
      raw: reason,
    };
  }

  /**
   * Map Puter usage to AI SDK format.
   */
  private mapUsage(usage?: PuterUsage): LanguageModelV3Usage {
    return {
      inputTokens: {
        total: usage?.prompt_tokens,
        noCache: undefined,
        cacheRead: usage?.cached_tokens,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: usage?.completion_tokens,
        text: undefined,
        reasoning: undefined,
      },
    };
  }

  /**
   * Extract text from response content (handles both string and array formats).
   */
  private extractTextContent(content: string | PuterContentBlock[] | null | undefined): string {
    if (!content) return '';
    
    if (typeof content === 'string') {
      return content;
    }
    
    if (Array.isArray(content)) {
      return content
        .filter((block): block is PuterContentBlock => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('');
    }
    
    return '';
  }

  /**
   * Non-streaming generation using Puter SDK.
   */
  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const puter = await this.initPuterSDK();
    const messages = this.convertPromptToMessages(options.prompt);
    const sdkOptions = this.buildSDKOptions(options, false);
    const warnings: SharedV3Warning[] = [];

    const response = await puter.ai.chat(messages, sdkOptions) as PuterChatResponse;

    const content: LanguageModelV3Content[] = [];

    // Extract text content (handles both string and array formats)
    const textContent = this.extractTextContent(response.message?.content);
    if (textContent) {
      content.push({
        type: 'text',
        text: textContent,
      });
    }

    // Handle tool use from Claude-style content blocks
    if (Array.isArray(response.message?.content)) {
      for (const block of response.message.content) {
        if (block.type === 'tool_use' && block.id && block.name) {
          content.push({
            type: 'tool-call',
            toolCallId: block.id,
            toolName: block.name,
            input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
          });
        }
      }
    }

    // Add tool calls from legacy format
    if (response.message?.tool_calls) {
      for (const tc of response.message.tool_calls) {
        content.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.function.name,
          input: tc.function.arguments,
        });
      }
    }

    return {
      content,
      finishReason: this.mapFinishReason(response.finish_reason),
      usage: this.mapUsage(response.usage),
      warnings,
      request: { body: { messages, options: sdkOptions } },
      response: {
        body: response,
      },
    };
  }

  /**
   * Streaming generation using Puter SDK.
   */
  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const puter = await this.initPuterSDK();
    const messages = this.convertPromptToMessages(options.prompt);
    const sdkOptions = this.buildSDKOptions(options, true);
    const warnings: SharedV3Warning[] = [];
    const generateId = this.config.generateId;

    const streamResponse = await puter.ai.chat(messages, sdkOptions) as AsyncIterable<PuterStreamChunk>;

    // Create a transform stream to convert Puter chunks to AI SDK format
    const self = this;
    let textId: string | null = null;
    let fullText = '';
    let finalUsage: PuterUsage | undefined;

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        // Emit stream-start
        controller.enqueue({
          type: 'stream-start',
          warnings,
        });

        try {
          for await (const chunk of streamResponse) {
            // Handle text content
            if (chunk.text) {
              if (!textId) {
                textId = generateId();
                controller.enqueue({
                  type: 'text-start',
                  id: textId,
                });
              }
              fullText += chunk.text;
              controller.enqueue({
                type: 'text-delta',
                id: textId,
                delta: chunk.text,
              });
            }

            // Handle usage (usually at the end)
            if (chunk.usage) {
              finalUsage = chunk.usage;
            }
          }

          // Close text stream if we had one
          if (textId) {
            controller.enqueue({
              type: 'text-end',
              id: textId,
            });
          }

          // Emit finish
          controller.enqueue({
            type: 'finish',
            usage: self.mapUsage(finalUsage),
            finishReason: self.mapFinishReason('stop'),
          });

          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return {
      stream,
      request: { body: { messages, options: sdkOptions } },
    };
  }
}
