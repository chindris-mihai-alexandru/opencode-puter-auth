import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPuterAuthManager, type PuterAuthManager } from '../src/auth.js';

describe('PuterAuthManager', () => {
  let testDir: string;
  let authManager: PuterAuthManager;

  beforeEach(async () => {
    // Create a temp directory for each test
    testDir = path.join(os.tmpdir(), `puter-auth-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    authManager = createPuterAuthManager(testDir);
  });

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should initialize with empty accounts', async () => {
      await authManager.init();
      expect(authManager.getAllAccounts()).toHaveLength(0);
      expect(authManager.getActiveAccount()).toBeNull();
      expect(authManager.isAuthenticated()).toBe(false);
    });

    it('should load existing accounts from disk', async () => {
      // Write accounts file first
      const accountsData = {
        version: 1,
        accounts: [
          {
            username: 'testuser',
            authToken: 'test-token-123',
            addedAt: Date.now(),
            isTemporary: false,
          },
        ],
        activeIndex: 0,
      };
      await fs.writeFile(
        path.join(testDir, 'puter-accounts.json'),
        JSON.stringify(accountsData),
        'utf-8'
      );

      await authManager.init();
      
      expect(authManager.getAllAccounts()).toHaveLength(1);
      expect(authManager.getActiveAccount()?.username).toBe('testuser');
      expect(authManager.isAuthenticated()).toBe(true);
    });
  });

  describe('account management', () => {
    beforeEach(async () => {
      await authManager.init();
    });

    it('should add a new account', async () => {
      await authManager.addAccount({
        username: 'newuser',
        authToken: 'new-token',
        addedAt: Date.now(),
        isTemporary: false,
      });

      expect(authManager.getAllAccounts()).toHaveLength(1);
      expect(authManager.getActiveAccount()?.username).toBe('newuser');
    });

    it('should update existing account with same username', async () => {
      await authManager.addAccount({
        username: 'user1',
        authToken: 'token1',
        addedAt: Date.now(),
        isTemporary: false,
      });

      await authManager.addAccount({
        username: 'user1',
        authToken: 'token2',
        addedAt: Date.now(),
        isTemporary: false,
      });

      expect(authManager.getAllAccounts()).toHaveLength(1);
      expect(authManager.getActiveAccount()?.authToken).toBe('token2');
    });

    it('should switch between accounts', async () => {
      await authManager.addAccount({
        username: 'user1',
        authToken: 'token1',
        addedAt: Date.now(),
        isTemporary: false,
      });

      await authManager.addAccount({
        username: 'user2',
        authToken: 'token2',
        addedAt: Date.now(),
        isTemporary: false,
      });

      expect(authManager.getActiveAccount()?.username).toBe('user2');
      
      await authManager.switchAccount(0);
      expect(authManager.getActiveAccount()?.username).toBe('user1');
    });

    it('should remove an account', async () => {
      await authManager.addAccount({
        username: 'user1',
        authToken: 'token1',
        addedAt: Date.now(),
        isTemporary: false,
      });

      await authManager.removeAccount(0);
      
      expect(authManager.getAllAccounts()).toHaveLength(0);
      expect(authManager.isAuthenticated()).toBe(false);
    });

    it('should update lastUsed timestamp', async () => {
      await authManager.addAccount({
        username: 'user1',
        authToken: 'token1',
        addedAt: Date.now(),
        isTemporary: false,
      });

      const before = authManager.getActiveAccount()?.lastUsed;
      
      await new Promise(resolve => setTimeout(resolve, 10));
      await authManager.touchActiveAccount();
      
      const after = authManager.getActiveAccount()?.lastUsed;
      
      expect(after).toBeDefined();
      expect(before).toBeUndefined();
    });

    it('should logout and clear all accounts', async () => {
      await authManager.addAccount({
        username: 'user1',
        authToken: 'token1',
        addedAt: Date.now(),
        isTemporary: false,
      });

      await authManager.logout();
      
      expect(authManager.getAllAccounts()).toHaveLength(0);
      expect(authManager.isAuthenticated()).toBe(false);
    });
  });

  describe('persistence', () => {
    it('should persist accounts to disk', async () => {
      await authManager.init();
      
      await authManager.addAccount({
        username: 'persistent-user',
        authToken: 'persistent-token',
        addedAt: Date.now(),
        isTemporary: false,
      });

      // Create new manager and verify persistence
      const newManager = createPuterAuthManager(testDir);
      await newManager.init();
      
      expect(newManager.getAllAccounts()).toHaveLength(1);
      expect(newManager.getActiveAccount()?.username).toBe('persistent-user');
    });
  });
});
