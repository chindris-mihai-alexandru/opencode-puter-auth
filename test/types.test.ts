import { describe, it, expect } from 'vitest';
import { 
  PuterAccountSchema, 
  PuterAccountsStorageSchema, 
  PuterConfigSchema,
  PUTER_CLAUDE_MODELS,
  PUTER_GPT_MODELS,
  PUTER_GEMINI_MODELS,
} from '../src/types.js';

describe('Zod Schemas', () => {
  describe('PuterAccountSchema', () => {
    it('should validate a valid account', () => {
      const account = {
        username: 'testuser',
        authToken: 'abc123',
        addedAt: Date.now(),
      };
      
      const result = PuterAccountSchema.safeParse(account);
      expect(result.success).toBe(true);
    });

    it('should accept optional email', () => {
      const account = {
        username: 'testuser',
        email: 'test@example.com',
        authToken: 'abc123',
        addedAt: Date.now(),
      };
      
      const result = PuterAccountSchema.safeParse(account);
      expect(result.success).toBe(true);
    });

    it('should reject invalid email format', () => {
      const account = {
        username: 'testuser',
        email: 'not-an-email',
        authToken: 'abc123',
        addedAt: Date.now(),
      };
      
      const result = PuterAccountSchema.safeParse(account);
      expect(result.success).toBe(false);
    });

    it('should default isTemporary to false', () => {
      const account = {
        username: 'testuser',
        authToken: 'abc123',
        addedAt: Date.now(),
      };
      
      const result = PuterAccountSchema.parse(account);
      expect(result.isTemporary).toBe(false);
    });
  });

  describe('PuterAccountsStorageSchema', () => {
    it('should validate storage with accounts', () => {
      const storage = {
        version: 1,
        accounts: [
          {
            username: 'user1',
            authToken: 'token1',
            addedAt: Date.now(),
          },
        ],
        activeIndex: 0,
      };
      
      const result = PuterAccountsStorageSchema.safeParse(storage);
      expect(result.success).toBe(true);
    });

    it('should default to version 1', () => {
      const storage = {
        accounts: [],
        activeIndex: 0,
      };
      
      const result = PuterAccountsStorageSchema.parse(storage);
      expect(result.version).toBe(1);
    });
  });

  describe('PuterConfigSchema', () => {
    it('should use default values', () => {
      const config = PuterConfigSchema.parse({});
      
      expect(config.quiet_mode).toBe(false);
      expect(config.debug).toBe(false);
      expect(config.api_base_url).toBe('https://api.puter.com');
      expect(config.api_timeout_ms).toBe(120000);
      expect(config.max_retries).toBe(3);
    });

    it('should override defaults', () => {
      const config = PuterConfigSchema.parse({
        debug: true,
        api_timeout_ms: 60000,
      });
      
      expect(config.debug).toBe(true);
      expect(config.api_timeout_ms).toBe(60000);
    });
  });
});

describe('Model Constants', () => {
  it('should have Claude models', () => {
    expect(PUTER_CLAUDE_MODELS).toContain('claude-opus-4-5');
    expect(PUTER_CLAUDE_MODELS).toContain('claude-sonnet-4-5');
    expect(PUTER_CLAUDE_MODELS.length).toBeGreaterThanOrEqual(4);
  });

  it('should have GPT models', () => {
    expect(PUTER_GPT_MODELS).toContain('gpt-5.2');
    expect(PUTER_GPT_MODELS).toContain('o3-mini');
    expect(PUTER_GPT_MODELS.length).toBeGreaterThanOrEqual(5);
  });

  it('should have Gemini models', () => {
    expect(PUTER_GEMINI_MODELS).toContain('gemini-2.5-pro');
    expect(PUTER_GEMINI_MODELS).toContain('gemini-2.5-flash');
    expect(PUTER_GEMINI_MODELS.length).toBeGreaterThanOrEqual(2);
  });
});
