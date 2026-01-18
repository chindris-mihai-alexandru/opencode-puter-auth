/**
 * Tests for AccountRotationManager
 * 
 * Tests the automatic account rotation functionality when rate limits are encountered.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AccountRotationManager,
  AllAccountsOnCooldownError,
  DEFAULT_ACCOUNT_COOLDOWN_MS,
  getGlobalAccountRotationManager,
  resetGlobalAccountRotationManager,
  type IAuthManager,
  type AccountRotationOptions,
} from '../src/account-rotation.js';
import type { PuterAccount } from '../src/types.js';
import { nullLogger } from '../src/logger.js';

/**
 * Create a mock auth manager for testing
 */
function createMockAuthManager(accounts: PuterAccount[], activeIndex: number = 0): IAuthManager {
  let currentIndex = activeIndex;
  
  return {
    getActiveAccount: () => accounts[currentIndex] ?? null,
    getAllAccounts: () => accounts,
    switchAccount: vi.fn(async (index: number) => {
      if (index >= 0 && index < accounts.length) {
        currentIndex = index;
        return true;
      }
      return false;
    }),
    isAuthenticated: () => accounts.length > 0,
  };
}

/**
 * Create a test account
 */
function createTestAccount(username: string, overrides?: Partial<PuterAccount>): PuterAccount {
  return {
    username,
    authToken: `token-${username}`,
    addedAt: Date.now(),
    lastUsed: Date.now(),
    isTemporary: false,
    ...overrides,
  };
}

describe('AccountRotationManager', () => {
  let manager: AccountRotationManager;
  let mockAuthManager: IAuthManager;
  let accounts: PuterAccount[];

  beforeEach(() => {
    accounts = [
      createTestAccount('user1'),
      createTestAccount('user2'),
      createTestAccount('user3'),
    ];
    mockAuthManager = createMockAuthManager(accounts);
    manager = new AccountRotationManager(mockAuthManager, {
      cooldownMs: 1000, // 1 second for faster tests
    });
  });

  describe('constructor', () => {
    it('should use default values when no options provided', () => {
      const defaultManager = new AccountRotationManager(mockAuthManager);
      const config = defaultManager.getConfig();
      
      expect(config.cooldownMs).toBe(DEFAULT_ACCOUNT_COOLDOWN_MS);
      expect(config.enabled).toBe(true);
      expect(config.strategy).toBe('round-robin');
    });

    it('should accept custom options', () => {
      const customManager = new AccountRotationManager(mockAuthManager, {
        cooldownMs: 5000,
        enabled: false,
        strategy: 'least-recently-used',
      });
      const config = customManager.getConfig();
      
      expect(config.cooldownMs).toBe(5000);
      expect(config.enabled).toBe(false);
      expect(config.strategy).toBe('least-recently-used');
    });
  });

  describe('cooldown management', () => {
    it('should not have accounts on cooldown initially', () => {
      expect(manager.isAccountOnCooldown('user1')).toBe(false);
      expect(manager.getCooldownRemaining('user1')).toBe(0);
    });

    it('should add accounts to cooldown', () => {
      manager.addToCooldown('user1', 'Rate limited');
      
      expect(manager.isAccountOnCooldown('user1')).toBe(true);
      expect(manager.getCooldownRemaining('user1')).toBeGreaterThan(0);
      expect(manager.getCooldownRemaining('user1')).toBeLessThanOrEqual(1000);
    });

    it('should apply exponential backoff for consecutive rate limits', () => {
      // First cooldown: 1x (1000ms)
      manager.addToCooldown('user1', 'Rate limited');
      const firstCooldown = manager.getCooldownRemaining('user1');
      expect(firstCooldown).toBeLessThanOrEqual(1000);
      
      // Second cooldown: 2x (2000ms)
      manager.addToCooldown('user1', 'Rate limited again');
      const secondCooldown = manager.getCooldownRemaining('user1');
      expect(secondCooldown).toBeGreaterThan(1000);
      expect(secondCooldown).toBeLessThanOrEqual(2000);
      
      // Third cooldown: 3x (3000ms)
      manager.addToCooldown('user1', 'Rate limited third time');
      const thirdCooldown = manager.getCooldownRemaining('user1');
      expect(thirdCooldown).toBeGreaterThan(2000);
      expect(thirdCooldown).toBeLessThanOrEqual(3000);
      
      // Fourth cooldown: 4x (4000ms) - max multiplier
      manager.addToCooldown('user1', 'Rate limited fourth time');
      const fourthCooldown = manager.getCooldownRemaining('user1');
      expect(fourthCooldown).toBeGreaterThan(3000);
      expect(fourthCooldown).toBeLessThanOrEqual(4000);
      
      // Fifth cooldown: should stay at 4x (4000ms)
      manager.addToCooldown('user1', 'Rate limited fifth time');
      const fifthCooldown = manager.getCooldownRemaining('user1');
      expect(fifthCooldown).toBeLessThanOrEqual(4000);
    });

    it('should remove accounts from cooldown', () => {
      manager.addToCooldown('user1', 'Rate limited');
      expect(manager.isAccountOnCooldown('user1')).toBe(true);
      
      manager.removeFromCooldown('user1');
      expect(manager.isAccountOnCooldown('user1')).toBe(false);
    });

    it('should expire cooldowns automatically', async () => {
      manager = new AccountRotationManager(mockAuthManager, {
        cooldownMs: 50, // Very short cooldown
      });
      
      manager.addToCooldown('user1', 'Rate limited');
      expect(manager.isAccountOnCooldown('user1')).toBe(true);
      
      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 60));
      
      expect(manager.isAccountOnCooldown('user1')).toBe(false);
    });

    it('should clear all cooldowns', () => {
      manager.addToCooldown('user1', 'Error');
      manager.addToCooldown('user2', 'Error');
      
      expect(manager.getAccountsOnCooldownCount()).toBe(2);
      
      manager.clearCooldowns();
      
      expect(manager.getAccountsOnCooldownCount()).toBe(0);
    });
  });

  describe('getAccountStatuses', () => {
    it('should return status for all accounts', () => {
      const statuses = manager.getAccountStatuses();
      
      expect(statuses).toHaveLength(3);
      expect(statuses.map(s => s.username)).toEqual(['user1', 'user2', 'user3']);
    });

    it('should include cooldown info when on cooldown', () => {
      manager.addToCooldown('user1', 'Rate limited');
      
      const statuses = manager.getAccountStatuses();
      const user1Status = statuses.find(s => s.username === 'user1');
      
      expect(user1Status?.isOnCooldown).toBe(true);
      expect(user1Status?.cooldownRemainingMs).toBeGreaterThan(0);
      expect(user1Status?.cooldownReason).toBe('Rate limited');
    });

    it('should track rate limit count', () => {
      manager.addToCooldown('user1', 'Error 1');
      manager.addToCooldown('user1', 'Error 2');
      manager.addToCooldown('user1', 'Error 3');
      
      const statuses = manager.getAccountStatuses();
      const user1Status = statuses.find(s => s.username === 'user1');
      
      expect(user1Status?.rateLimitCount).toBe(3);
    });
  });

  describe('getAvailableAccounts', () => {
    it('should return all accounts when none on cooldown', () => {
      const available = manager.getAvailableAccounts();
      
      expect(available).toHaveLength(3);
    });

    it('should exclude accounts on cooldown', () => {
      manager.addToCooldown('user1', 'Rate limited');
      manager.addToCooldown('user2', 'Rate limited');
      
      const available = manager.getAvailableAccounts();
      
      expect(available).toHaveLength(1);
      expect(available[0].username).toBe('user3');
    });
  });

  describe('getNextAvailableAccount', () => {
    it('should return current account when available', async () => {
      const result = await manager.getNextAvailableAccount();
      
      expect(result.account.username).toBe('user1');
      expect(result.wasRotated).toBe(false);
      expect(result.accountsOnCooldown).toBe(0);
      expect(result.totalAccounts).toBe(3);
    });

    it('should rotate to next account when current is on cooldown', async () => {
      manager.addToCooldown('user1', 'Rate limited');
      
      const result = await manager.getNextAvailableAccount();
      
      expect(result.account.username).toBe('user2');
      expect(result.wasRotated).toBe(true);
      expect(result.previousUsername).toBe('user1');
      expect(result.accountsOnCooldown).toBe(1);
      expect(mockAuthManager.switchAccount).toHaveBeenCalledWith(1);
    });

    it('should skip multiple cooldown accounts', async () => {
      manager.addToCooldown('user1', 'Rate limited');
      manager.addToCooldown('user2', 'Rate limited');
      
      const result = await manager.getNextAvailableAccount();
      
      expect(result.account.username).toBe('user3');
      expect(result.accountsOnCooldown).toBe(2);
    });

    it('should throw AllAccountsOnCooldownError when all accounts on cooldown', async () => {
      manager.addToCooldown('user1', 'Rate limited');
      manager.addToCooldown('user2', 'Rate limited');
      manager.addToCooldown('user3', 'Rate limited');
      
      await expect(manager.getNextAvailableAccount()).rejects.toThrow(AllAccountsOnCooldownError);
    });

    it('should include account statuses in AllAccountsOnCooldownError', async () => {
      manager.addToCooldown('user1', 'Error 1');
      manager.addToCooldown('user2', 'Error 2');
      manager.addToCooldown('user3', 'Error 3');
      
      try {
        await manager.getNextAvailableAccount();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AllAccountsOnCooldownError);
        const cooldownError = error as AllAccountsOnCooldownError;
        expect(cooldownError.accountStatuses).toHaveLength(3);
        expect(cooldownError.nextAvailableIn).toBeGreaterThan(0);
      }
    });

    it('should throw error when no accounts configured', async () => {
      mockAuthManager = createMockAuthManager([]);
      manager = new AccountRotationManager(mockAuthManager);
      
      await expect(manager.getNextAvailableAccount()).rejects.toThrow('No accounts configured');
    });

    it('should return current account when rotation is disabled', async () => {
      manager = new AccountRotationManager(mockAuthManager, {
        enabled: false,
      });
      manager.addToCooldown('user1', 'Rate limited');
      
      const result = await manager.getNextAvailableAccount();
      
      // Should still return current account even though it's on cooldown
      expect(result.account.username).toBe('user1');
      expect(result.wasRotated).toBe(false);
    });
  });

  describe('round-robin strategy', () => {
    it('should cycle through accounts in order', async () => {
      manager = new AccountRotationManager(mockAuthManager, {
        strategy: 'round-robin',
        cooldownMs: 1000,
      });
      
      // Mark first account as used, trigger rotation
      manager.addToCooldown('user1', 'Rate limited');
      const result1 = await manager.getNextAvailableAccount();
      expect(result1.account.username).toBe('user2');
      
      // Mark second as cooldown, should go to third
      manager.addToCooldown('user2', 'Rate limited');
      const result2 = await manager.getNextAvailableAccount();
      expect(result2.account.username).toBe('user3');
    });
  });

  describe('least-recently-used strategy', () => {
    it('should select least recently used account', async () => {
      // Set up accounts with different lastUsed times
      accounts = [
        createTestAccount('user1', { lastUsed: Date.now() }),           // Most recent
        createTestAccount('user2', { lastUsed: Date.now() - 10000 }),   // 10 seconds ago
        createTestAccount('user3', { lastUsed: Date.now() - 20000 }),   // 20 seconds ago (oldest)
      ];
      mockAuthManager = createMockAuthManager(accounts);
      manager = new AccountRotationManager(mockAuthManager, {
        strategy: 'least-recently-used',
        cooldownMs: 1000,
      });
      
      // Put current account on cooldown
      manager.addToCooldown('user1', 'Rate limited');
      
      const result = await manager.getNextAvailableAccount();
      
      // Should pick user3 (least recently used)
      expect(result.account.username).toBe('user3');
    });

    it('should use internal usage tracking over account lastUsed', async () => {
      manager = new AccountRotationManager(mockAuthManager, {
        strategy: 'least-recently-used',
        cooldownMs: 1000,
      });
      
      // Mark user3 as recently used via internal tracking
      manager.markAsUsed('user3');
      
      // Put current account on cooldown
      manager.addToCooldown('user1', 'Rate limited');
      
      const result = await manager.getNextAvailableAccount();
      
      // Should pick user2 (user3 was just marked as used)
      expect(result.account.username).toBe('user2');
    });
  });

  describe('handleRateLimitError', () => {
    it('should add current account to cooldown and return next available', async () => {
      const error = new Error('Rate limit exceeded');
      
      const result = await manager.handleRateLimitError(error);
      
      expect(result).not.toBeNull();
      expect(result!.account.username).toBe('user2');
      expect(manager.isAccountOnCooldown('user1')).toBe(true);
    });

    it('should return null when all accounts on cooldown', async () => {
      manager.addToCooldown('user2', 'Rate limited');
      manager.addToCooldown('user3', 'Rate limited');
      
      const error = new Error('Rate limit exceeded');
      const result = await manager.handleRateLimitError(error);
      
      expect(result).toBeNull();
    });

    it('should work when no current account', async () => {
      mockAuthManager = {
        ...mockAuthManager,
        getActiveAccount: () => null,
      };
      manager = new AccountRotationManager(mockAuthManager);
      
      const error = new Error('Rate limit exceeded');
      const result = await manager.handleRateLimitError(error);
      
      // Should still try to get next available
      expect(result).not.toBeNull();
    });
  });

  describe('markAsUsed', () => {
    it('should update internal usage tracking', () => {
      const beforeMark = Date.now();
      manager.markAsUsed('user2');
      
      const statuses = manager.getAccountStatuses();
      const user2Status = statuses.find(s => s.username === 'user2');
      
      expect(user2Status?.lastUsedAt).toBeGreaterThanOrEqual(beforeMark);
    });
  });

  describe('isRotationNeeded', () => {
    it('should return false when current account is available', () => {
      expect(manager.isRotationNeeded()).toBe(false);
    });

    it('should return true when current account is on cooldown', () => {
      manager.addToCooldown('user1', 'Rate limited');
      
      expect(manager.isRotationNeeded()).toBe(true);
    });

    it('should return false when rotation is disabled', () => {
      manager = new AccountRotationManager(mockAuthManager, { enabled: false });
      manager.addToCooldown('user1', 'Rate limited');
      
      expect(manager.isRotationNeeded()).toBe(false);
    });
  });

  describe('getSummary', () => {
    it('should return correct summary', () => {
      manager.addToCooldown('user1', 'Rate limited');
      
      const summary = manager.getSummary();
      
      expect(summary.enabled).toBe(true);
      expect(summary.totalAccounts).toBe(3);
      expect(summary.availableAccounts).toBe(2);
      expect(summary.onCooldown).toBe(1);
      expect(summary.currentAccount).toBe('user1');
      expect(summary.strategy).toBe('round-robin');
    });
  });

  describe('configure', () => {
    it('should update cooldown duration', () => {
      manager.configure({ cooldownMs: 5000 });
      
      expect(manager.getConfig().cooldownMs).toBe(5000);
    });

    it('should update enabled state', () => {
      manager.configure({ enabled: false });
      
      expect(manager.getConfig().enabled).toBe(false);
    });

    it('should update strategy', () => {
      manager.configure({ strategy: 'least-recently-used' });
      
      expect(manager.getConfig().strategy).toBe('least-recently-used');
    });
  });

  describe('resetStats', () => {
    it('should clear usage stats and reset index', () => {
      manager.markAsUsed('user1');
      manager.markAsUsed('user2');
      
      manager.resetStats();
      
      const statuses = manager.getAccountStatuses();
      // Stats should be cleared (lastUsedAt comes from account.lastUsed now)
      expect(statuses[0].rateLimitCount).toBe(0);
      expect(statuses[1].rateLimitCount).toBe(0);
    });
  });
});

describe('Global AccountRotationManager', () => {
  let mockAuthManager: IAuthManager;

  beforeEach(() => {
    resetGlobalAccountRotationManager();
    mockAuthManager = createMockAuthManager([
      createTestAccount('user1'),
      createTestAccount('user2'),
    ]);
  });

  it('should require authManager on first call', () => {
    expect(() => getGlobalAccountRotationManager()).toThrow('AuthManager required');
  });

  it('should create global instance with auth manager', () => {
    const manager = getGlobalAccountRotationManager(mockAuthManager);
    
    expect(manager).toBeInstanceOf(AccountRotationManager);
  });

  it('should return same instance on subsequent calls', () => {
    const manager1 = getGlobalAccountRotationManager(mockAuthManager);
    const manager2 = getGlobalAccountRotationManager();
    
    expect(manager1).toBe(manager2);
  });

  it('should apply options when creating', () => {
    const manager = getGlobalAccountRotationManager(mockAuthManager, {
      cooldownMs: 5000,
      strategy: 'least-recently-used',
    });
    
    const config = manager.getConfig();
    expect(config.cooldownMs).toBe(5000);
    expect(config.strategy).toBe('least-recently-used');
  });

  it('should update config when called with options on existing instance', () => {
    const manager1 = getGlobalAccountRotationManager(mockAuthManager, { cooldownMs: 1000 });
    expect(manager1.getConfig().cooldownMs).toBe(1000);
    
    // Update existing instance
    const manager2 = getGlobalAccountRotationManager(undefined, { cooldownMs: 5000 });
    expect(manager2.getConfig().cooldownMs).toBe(5000);
    
    // Same instance
    expect(manager1).toBe(manager2);
  });

  it('should reset global instance', () => {
    const manager1 = getGlobalAccountRotationManager(mockAuthManager);
    manager1.addToCooldown('user1', 'Error');
    
    resetGlobalAccountRotationManager();
    
    const manager2 = getGlobalAccountRotationManager(mockAuthManager);
    expect(manager2).not.toBe(manager1);
    expect(manager2.isAccountOnCooldown('user1')).toBe(false);
  });
});

describe('AllAccountsOnCooldownError', () => {
  it('should include account statuses in error', () => {
    const statuses = [
      { username: 'user1', isOnCooldown: true, cooldownRemainingMs: 5000, rateLimitCount: 1 },
      { username: 'user2', isOnCooldown: true, cooldownRemainingMs: 3000, rateLimitCount: 1 },
    ];
    
    const error = new AllAccountsOnCooldownError(statuses);
    
    expect(error.accountStatuses).toEqual(statuses);
    expect(error.nextAvailableIn).toBe(3000); // Minimum cooldown remaining
    expect(error.message).toContain('user1');
    expect(error.message).toContain('user2');
    expect(error.name).toBe('AllAccountsOnCooldownError');
  });

  it('should show seconds in error message', () => {
    const statuses = [
      { username: 'user1', isOnCooldown: true, cooldownRemainingMs: 30000, rateLimitCount: 1 },
    ];
    
    const error = new AllAccountsOnCooldownError(statuses);
    
    expect(error.message).toContain('30s');
  });
});
