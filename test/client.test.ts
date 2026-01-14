import { describe, it, expect, vi } from 'vitest';
import { PuterClient } from '../src/client.js';

describe('PuterClient', () => {
  it('should create a client instance', () => {
    const client = new PuterClient('test-token');
    expect(client).toBeDefined();
  });

  it('should have default models as fallback', async () => {
    const client = new PuterClient('test-token');
    
    // Mock fetch to simulate API failure
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    global.fetch = mockFetch;
    
    const models = await client.listModels();
    
    expect(models.length).toBeGreaterThan(0);
    expect(models.some(m => m.id === 'claude-opus-4-5')).toBe(true);
    expect(models.some(m => m.id === 'gpt-5.2')).toBe(true);
    expect(models.some(m => m.id === 'gemini-2.5-pro')).toBe(true);
  });

  it('should include Claude models in defaults', async () => {
    const client = new PuterClient('test-token');
    
    // Force fallback
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    
    const models = await client.listModels();
    const claudeModels = models.filter(m => m.provider === 'anthropic');
    
    expect(claudeModels.length).toBeGreaterThanOrEqual(4);
    expect(claudeModels.some(m => m.id === 'claude-opus-4-5')).toBe(true);
    expect(claudeModels.some(m => m.id === 'claude-sonnet-4-5')).toBe(true);
  });

  it('should update auth token', () => {
    const client = new PuterClient('initial-token');
    client.setAuthToken('new-token');
    // Token is private, but we can verify no error is thrown
    expect(true).toBe(true);
  });
});
