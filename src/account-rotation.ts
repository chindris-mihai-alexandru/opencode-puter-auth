/**
 * Account Rotation Manager for opencode-puter-auth
 * 
 * Provides automatic account rotation when rate limits are encountered.
 * When an account returns a rate limit error (429/403), the manager:
 * 1. Adds the account to a cooldown list
 * 2. Switches to the next available account
 * 3. Returns to the original account after cooldown expires
 * 
 * This enables longer uninterrupted usage by cycling through multiple
 * Puter accounts when individual accounts hit rate limits.
 * 
 * @example
 * ```ts
 * const rotation = new AccountRotationManager(authManager, {
 *   cooldownMs: 300000, // 5 minutes
 *   enabled: true,
 * });
 * 
 * // Get the next available account (respecting cooldowns)
 * const account = await rotation.getNextAvailableAccount();
 * 
 * // Mark an account as rate-limited
 * rotation.addToCooldown('mihai_chindris', 'Rate limit exceeded');
 * ```
 */

import type { PuterAccount } from './types.js';
import type { Logger } from './logger.js';

/**
 * Default cooldown duration for rate-limited accounts (5 minutes)
 * Accounts typically need longer cooldown than models since Puter's
 * account-level limits are stricter.
 */
export const DEFAULT_ACCOUNT_COOLDOWN_MS = 300000;

/**
 * Configuration options for AccountRotationManager
 */
export interface AccountRotationOptions {
  /** Cooldown duration in milliseconds (default: 5 minutes) */
  cooldownMs?: number;
  /** Whether account rotation is enabled (default: true) */
  enabled?: boolean;
  /** Strategy for selecting next account: 'round-robin' | 'least-recently-used' */
  strategy?: 'round-robin' | 'least-recently-used';
}

/**
 * Status of an individual account in the rotation pool
 */
export interface AccountStatus {
  /** Account username */
  username: string;
  /** Whether the account is currently on cooldown */
  isOnCooldown: boolean;
  /** Remaining cooldown time in ms (0 if not on cooldown) */
  cooldownRemainingMs: number;
  /** Reason for cooldown (if on cooldown) */
  cooldownReason?: string;
  /** When the account was last used (Unix timestamp) */
  lastUsedAt?: number;
  /** Number of times this account has been rate-limited */
  rateLimitCount: number;
}

/**
 * Cooldown entry for a rate-limited account
 */
interface AccountCooldownEntry {
  /** Timestamp when cooldown expires */
  expiresAt: number;
  /** Reason for cooldown */
  reason: string;
  /** Number of consecutive rate limits */
  consecutiveRateLimits: number;
}

/**
 * Result of account rotation attempt
 */
export interface AccountRotationResult {
  /** The account that was selected */
  account: PuterAccount;
  /** Whether this account was rotated to (vs. being the primary) */
  wasRotated: boolean;
  /** Username of the previous account (if rotated) */
  previousUsername?: string;
  /** Number of accounts currently on cooldown */
  accountsOnCooldown: number;
  /** Total accounts available */
  totalAccounts: number;
}

/**
 * Error thrown when all accounts are on cooldown
 */
export class AllAccountsOnCooldownError extends Error {
  public readonly accountStatuses: AccountStatus[];
  public readonly nextAvailableIn: number;
  
  constructor(statuses: AccountStatus[]) {
    const usernames = statuses.map(s => s.username).join(', ');
    const nextAvailable = Math.min(...statuses.map(s => s.cooldownRemainingMs));
    super(`All accounts on cooldown: ${usernames}. Next available in ${Math.round(nextAvailable / 1000)}s`);
    this.name = 'AllAccountsOnCooldownError';
    this.accountStatuses = statuses;
    this.nextAvailableIn = nextAvailable;
  }
}

/**
 * Interface for the auth manager (to avoid circular dependency)
 */
export interface IAuthManager {
  getActiveAccount(): PuterAccount | null;
  getAllAccounts(): PuterAccount[];
  switchAccount(index: number): Promise<boolean>;
  isAuthenticated(): boolean;
}

/**
 * Manages automatic account rotation when rate limits are encountered.
 * 
 * Works with PuterAuthManager to cycle through multiple accounts,
 * ensuring uninterrupted service even when individual accounts
 * hit their rate limits.
 */
export class AccountRotationManager {
  private authManager: IAuthManager;
  private cooldownMap: Map<string, AccountCooldownEntry> = new Map();
  private usageStats: Map<string, { lastUsedAt: number; rateLimitCount: number }> = new Map();
  private cooldownMs: number;
  private enabled: boolean;
  private strategy: 'round-robin' | 'least-recently-used';
  private currentIndex: number = 0;
  private logger?: Logger;
  
  /**
   * Create a new AccountRotationManager
   * 
   * @param authManager - The PuterAuthManager instance
   * @param options - Configuration options
   * @param logger - Optional logger for debugging
   */
  constructor(
    authManager: IAuthManager,
    options: AccountRotationOptions = {},
    logger?: Logger
  ) {
    this.authManager = authManager;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_ACCOUNT_COOLDOWN_MS;
    this.enabled = options.enabled ?? true;
    this.strategy = options.strategy ?? 'round-robin';
    this.logger = logger;
  }
  
  /**
   * Check if an account is currently on cooldown
   * 
   * @param username - Account username to check
   * @returns true if the account is on cooldown
   */
  public isAccountOnCooldown(username: string): boolean {
    const entry = this.cooldownMap.get(username);
    if (!entry) return false;
    
    if (Date.now() >= entry.expiresAt) {
      this.cooldownMap.delete(username);
      return false;
    }
    
    return true;
  }
  
  /**
   * Get remaining cooldown time for an account
   * 
   * @param username - Account username to check
   * @returns Remaining cooldown in ms, or 0 if not on cooldown
   */
  public getCooldownRemaining(username: string): number {
    const entry = this.cooldownMap.get(username);
    if (!entry) return 0;
    
    const remaining = entry.expiresAt - Date.now();
    if (remaining <= 0) {
      this.cooldownMap.delete(username);
      return 0;
    }
    
    return remaining;
  }
  
  /**
   * Add an account to the cooldown list
   * 
   * Each consecutive rate limit increases the cooldown duration
   * exponentially (up to 4x base cooldown).
   * 
   * @param username - Account username to add to cooldown
   * @param reason - Reason for the cooldown
   */
  public addToCooldown(username: string, reason: string): void {
    const existing = this.cooldownMap.get(username);
    const consecutiveRateLimits = (existing?.consecutiveRateLimits ?? 0) + 1;
    
    // Exponential backoff: 1x, 2x, 3x, 4x (max)
    const multiplier = Math.min(consecutiveRateLimits, 4);
    const duration = this.cooldownMs * multiplier;
    
    this.cooldownMap.set(username, {
      expiresAt: Date.now() + duration,
      reason,
      consecutiveRateLimits,
    });
    
    // Update stats
    const stats = this.usageStats.get(username) ?? { lastUsedAt: 0, rateLimitCount: 0 };
    stats.rateLimitCount++;
    this.usageStats.set(username, stats);
    
    const durationSecs = Math.round(duration / 1000);
    this.logger?.warn(`Account ${username} cooldown: ${durationSecs}s (${consecutiveRateLimits}x)`);
  }
  
  /**
   * Remove an account from cooldown (e.g., after successful request)
   * 
   * @param username - Account username to remove from cooldown
   */
  public removeFromCooldown(username: string): void {
    if (this.cooldownMap.has(username)) {
      this.cooldownMap.delete(username);
      this.logger?.debug(`Account ${username} removed from cooldown`);
    }
  }
  
  /**
   * Mark an account as recently used
   * 
   * @param username - Account username that was used
   */
  public markAsUsed(username: string): void {
    const stats = this.usageStats.get(username) ?? { lastUsedAt: 0, rateLimitCount: 0 };
    stats.lastUsedAt = Date.now();
    this.usageStats.set(username, stats);
  }
  
  /**
   * Get status of all accounts
   * 
   * @returns Array of account statuses
   */
  public getAccountStatuses(): AccountStatus[] {
    const accounts = this.authManager.getAllAccounts();
    
    return accounts.map(account => {
      const cooldownRemaining = this.getCooldownRemaining(account.username);
      const entry = this.cooldownMap.get(account.username);
      const stats = this.usageStats.get(account.username);
      
      return {
        username: account.username,
        isOnCooldown: cooldownRemaining > 0,
        cooldownRemainingMs: cooldownRemaining,
        cooldownReason: entry?.reason,
        lastUsedAt: stats?.lastUsedAt ?? account.lastUsed,
        rateLimitCount: stats?.rateLimitCount ?? 0,
      };
    });
  }
  
  /**
   * Get list of available accounts (not on cooldown)
   * 
   * @returns Array of available accounts
   */
  public getAvailableAccounts(): PuterAccount[] {
    return this.authManager.getAllAccounts().filter(
      account => !this.isAccountOnCooldown(account.username)
    );
  }
  
  /**
   * Get count of accounts currently on cooldown
   * 
   * @returns Number of accounts on cooldown
   */
  public getAccountsOnCooldownCount(): number {
    const accounts = this.authManager.getAllAccounts();
    return accounts.filter(a => this.isAccountOnCooldown(a.username)).length;
  }
  
  /**
   * Select the next account to use based on strategy
   * 
   * @param availableAccounts - List of available accounts
   * @returns The selected account
   */
  private selectNextAccount(availableAccounts: PuterAccount[]): PuterAccount {
    if (availableAccounts.length === 0) {
      throw new Error('No available accounts');
    }
    
    if (availableAccounts.length === 1) {
      return availableAccounts[0];
    }
    
    switch (this.strategy) {
      case 'least-recently-used': {
        // Find the account with the oldest lastUsedAt
        let oldest = availableAccounts[0];
        let oldestTime = this.usageStats.get(oldest.username)?.lastUsedAt ?? oldest.lastUsed ?? 0;
        
        for (const account of availableAccounts) {
          const lastUsed = this.usageStats.get(account.username)?.lastUsedAt ?? account.lastUsed ?? 0;
          if (lastUsed < oldestTime) {
            oldest = account;
            oldestTime = lastUsed;
          }
        }
        
        return oldest;
      }
      
      case 'round-robin':
      default: {
        // Cycle through accounts in order
        const allAccounts = this.authManager.getAllAccounts();
        
        // Find next available account starting from currentIndex
        for (let i = 0; i < allAccounts.length; i++) {
          const idx = (this.currentIndex + i) % allAccounts.length;
          const account = allAccounts[idx];
          
          if (availableAccounts.includes(account)) {
            this.currentIndex = (idx + 1) % allAccounts.length;
            return account;
          }
        }
        
        // Fallback to first available
        return availableAccounts[0];
      }
    }
  }
  
  /**
   * Get the next available account, potentially rotating from current
   * 
   * If the current account is on cooldown or has been rate-limited,
   * switches to the next available account.
   * 
   * @returns Rotation result with the selected account
   * @throws AllAccountsOnCooldownError if all accounts are on cooldown
   */
  public async getNextAvailableAccount(): Promise<AccountRotationResult> {
    const allAccounts = this.authManager.getAllAccounts();
    const totalAccounts = allAccounts.length;
    
    if (totalAccounts === 0) {
      throw new Error('No accounts configured. Run `puter-auth login` to add an account.');
    }
    
    // If rotation is disabled, just return current account
    if (!this.enabled) {
      const current = this.authManager.getActiveAccount();
      if (!current) {
        throw new Error('No active account');
      }
      return {
        account: current,
        wasRotated: false,
        accountsOnCooldown: this.getAccountsOnCooldownCount(),
        totalAccounts,
      };
    }
    
    const availableAccounts = this.getAvailableAccounts();
    const accountsOnCooldown = totalAccounts - availableAccounts.length;
    
    // If all accounts are on cooldown, throw error with details
    if (availableAccounts.length === 0) {
      const statuses = this.getAccountStatuses();
      throw new AllAccountsOnCooldownError(statuses);
    }
    
    const currentAccount = this.authManager.getActiveAccount();
    const currentUsername = currentAccount?.username;
    
    // Check if current account is available
    const currentIsAvailable = currentAccount && 
      availableAccounts.some(a => a.username === currentAccount.username);
    
    if (currentIsAvailable && accountsOnCooldown === 0) {
      // Current account is fine and no rotation needed
      return {
        account: currentAccount!,
        wasRotated: false,
        accountsOnCooldown: 0,
        totalAccounts,
      };
    }
    
    // Need to select a (potentially different) account
    const selectedAccount = this.selectNextAccount(availableAccounts);
    const wasRotated = selectedAccount.username !== currentUsername;
    
    // If we selected a different account, switch to it
    if (wasRotated) {
      const targetIndex = allAccounts.findIndex(a => a.username === selectedAccount.username);
      if (targetIndex >= 0) {
        await this.authManager.switchAccount(targetIndex);
        this.logger?.info(`Rotated to account: ${selectedAccount.username}`);
      }
    }
    
    // Mark as used
    this.markAsUsed(selectedAccount.username);
    
    return {
      account: selectedAccount,
      wasRotated,
      previousUsername: wasRotated ? currentUsername : undefined,
      accountsOnCooldown,
      totalAccounts,
    };
  }
  
  /**
   * Handle a rate limit error by adding current account to cooldown
   * and returning the next available account
   * 
   * @param error - The rate limit error
   * @returns Next available account, or null if all on cooldown
   */
  public async handleRateLimitError(error: Error): Promise<AccountRotationResult | null> {
    const currentAccount = this.authManager.getActiveAccount();
    
    if (currentAccount) {
      this.addToCooldown(currentAccount.username, error.message);
    }
    
    try {
      return await this.getNextAvailableAccount();
    } catch (e) {
      if (e instanceof AllAccountsOnCooldownError) {
        return null;
      }
      throw e;
    }
  }
  
  /**
   * Clear all cooldowns (useful for testing or manual reset)
   */
  public clearCooldowns(): void {
    this.cooldownMap.clear();
    this.logger?.debug('All account cooldowns cleared');
  }
  
  /**
   * Reset all statistics
   */
  public resetStats(): void {
    this.usageStats.clear();
    this.currentIndex = 0;
    this.logger?.debug('Account rotation stats reset');
  }
  
  /**
   * Update configuration
   */
  public configure(options: Partial<AccountRotationOptions>): void {
    if (options.cooldownMs !== undefined) {
      this.cooldownMs = options.cooldownMs;
    }
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
    if (options.strategy !== undefined) {
      this.strategy = options.strategy;
    }
  }
  
  /**
   * Get current configuration
   */
  public getConfig(): Required<AccountRotationOptions> {
    return {
      cooldownMs: this.cooldownMs,
      enabled: this.enabled,
      strategy: this.strategy,
    };
  }
  
  /**
   * Check if rotation is needed (current account on cooldown)
   */
  public isRotationNeeded(): boolean {
    if (!this.enabled) return false;
    
    const current = this.authManager.getActiveAccount();
    if (!current) return false;
    
    return this.isAccountOnCooldown(current.username);
  }
  
  /**
   * Get a summary of the rotation state
   */
  public getSummary(): {
    enabled: boolean;
    totalAccounts: number;
    availableAccounts: number;
    onCooldown: number;
    currentAccount: string | null;
    strategy: string;
  } {
    const allAccounts = this.authManager.getAllAccounts();
    const available = this.getAvailableAccounts();
    const current = this.authManager.getActiveAccount();
    
    return {
      enabled: this.enabled,
      totalAccounts: allAccounts.length,
      availableAccounts: available.length,
      onCooldown: allAccounts.length - available.length,
      currentAccount: current?.username ?? null,
      strategy: this.strategy,
    };
  }
}

/**
 * Global AccountRotationManager instance
 */
let globalAccountRotationManager: AccountRotationManager | null = null;

/**
 * Get the global AccountRotationManager instance
 * 
 * @param authManager - The auth manager (required on first call)
 * @param options - Configuration options
 * @param logger - Optional logger
 * @returns The global AccountRotationManager instance
 */
export function getGlobalAccountRotationManager(
  authManager?: IAuthManager,
  options?: AccountRotationOptions,
  logger?: Logger
): AccountRotationManager {
  if (!globalAccountRotationManager) {
    if (!authManager) {
      throw new Error('AuthManager required when creating AccountRotationManager');
    }
    globalAccountRotationManager = new AccountRotationManager(authManager, options, logger);
  } else if (options) {
    globalAccountRotationManager.configure(options);
  }
  return globalAccountRotationManager;
}

/**
 * Reset the global AccountRotationManager (useful for testing)
 */
export function resetGlobalAccountRotationManager(): void {
  globalAccountRotationManager = null;
}
