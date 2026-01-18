import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PuterClient } from '../src/client.js';

describe('PuterClient', () => {
  let originalFetch: typeof fetch;
  
  beforeEach(() => {
    originalFetch = global.fetch;
  });
  
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should create a client instance', () => {
    const client = new PuterClient('test-token');
    expect(client).toBeDefined();
  });

  it('should have default models as fallback', async () => {
    // Use max_retries: 0 to disable retries for this test
    const client = new PuterClient('test-token', { max_retries: 0 });
    
    // Mock fetch to simulate API failure (401 is not retried)
    const mockFetch = vi.fn().mockRejectedValue(new Error('Puter API error (401): Unauthorized'));
    global.fetch = mockFetch;
    
    const models = await client.listModels();
    
    expect(models.length).toBeGreaterThan(0);
    expect(models.some(m => m.id === 'claude-opus-4-5')).toBe(true);
    expect(models.some(m => m.id === 'gpt-5.2')).toBe(true);
    expect(models.some(m => m.id === 'gemini-2.5-pro')).toBe(true);
  });

  it('should include Claude models in defaults', async () => {
    // Use max_retries: 0 to disable retries for this test
    const client = new PuterClient('test-token', { max_retries: 0 });
    
    // Force fallback with non-retryable error
    global.fetch = vi.fn().mockRejectedValue(new Error('Puter API error (401): Unauthorized'));
    
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
  
  describe('Model Caching', () => {
    it('should cache model list and return cached results', async () => {
      const client = new PuterClient('test-token', { max_retries: 0, cache_ttl_ms: 60000 });
      
      let fetchCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        fetchCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: 'model-1', name: 'Model 1', provider: 'test' },
            { id: 'model-2', name: 'Model 2', provider: 'test' },
          ]),
        });
      });
      
      // First call should fetch from API
      const models1 = await client.listModels();
      expect(fetchCount).toBe(1);
      expect(models1.length).toBe(2);
      
      // Second call should use cache
      const models2 = await client.listModels();
      expect(fetchCount).toBe(1); // No additional fetch
      expect(models2.length).toBe(2);
      
      // Third call should also use cache
      const models3 = await client.listModels();
      expect(fetchCount).toBe(1); // Still no additional fetch
      expect(models3).toEqual(models2);
    });
    
    it('should bypass cache when forceRefresh is true', async () => {
      const client = new PuterClient('test-token', { max_retries: 0, cache_ttl_ms: 60000 });
      
      let fetchCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        fetchCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: `model-${fetchCount}`, name: `Model ${fetchCount}`, provider: 'test' },
          ]),
        });
      });
      
      // First call
      const models1 = await client.listModels();
      expect(fetchCount).toBe(1);
      expect(models1[0].id).toBe('model-1');
      
      // Force refresh
      const models2 = await client.listModels(true);
      expect(fetchCount).toBe(2);
      expect(models2[0].id).toBe('model-2');
    });
    
    it('should invalidate cache when auth token changes', async () => {
      const client = new PuterClient('test-token', { max_retries: 0, cache_ttl_ms: 60000 });
      
      let fetchCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        fetchCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: 'model-1', name: 'Model 1', provider: 'test' },
          ]),
        });
      });
      
      // First call populates cache
      await client.listModels();
      expect(fetchCount).toBe(1);
      
      // Second call uses cache
      await client.listModels();
      expect(fetchCount).toBe(1);
      
      // Change token - should invalidate cache
      client.setAuthToken('new-token');
      
      // Third call should fetch again
      await client.listModels();
      expect(fetchCount).toBe(2);
    });
    
    it('should invalidate cache when invalidateModelCache is called', async () => {
      const client = new PuterClient('test-token', { max_retries: 0, cache_ttl_ms: 60000 });
      
      let fetchCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        fetchCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: 'model-1', name: 'Model 1', provider: 'test' },
          ]),
        });
      });
      
      // First call populates cache
      await client.listModels();
      expect(fetchCount).toBe(1);
      
      // Manually invalidate
      client.invalidateModelCache();
      
      // Should fetch again
      await client.listModels();
      expect(fetchCount).toBe(2);
    });
    
    it('should expire cache after TTL', async () => {
      // Use very short TTL for testing
      const client = new PuterClient('test-token', { max_retries: 0, cache_ttl_ms: 50 });
      
      let fetchCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        fetchCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: 'model-1', name: 'Model 1', provider: 'test' },
          ]),
        });
      });
      
      // First call populates cache
      await client.listModels();
      expect(fetchCount).toBe(1);
      
      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 60));
      
      // Should fetch again
      await client.listModels();
      expect(fetchCount).toBe(2);
    });
  });
});
