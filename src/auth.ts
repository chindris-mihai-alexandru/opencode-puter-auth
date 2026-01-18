/**
 * Puter Authentication Manager
 * 
 * Handles OAuth authentication with Puter.com via browser popup.
 * Supports multiple accounts with automatic persistence and seamless switching.
 * 
 * Authentication Flow:
 * 1. Start local HTTP server to serve auth HTML and receive callback
 * 2. Open browser to the local server serving Puter SDK auth page
 * 3. User signs in via Puter popup (puter.auth.signIn())
 * 4. Page redirects to /callback with token and username
 * 5. Token is stored locally and server shuts down
 * 
 * IMPORTANT: Puter uses popup-based auth (puter.auth.signIn()) which returns a token.
 * For CLI tools, we serve an HTML page that handles the popup auth flow,
 * then redirects to our local callback with the token.
 * 
 * @example
 * ```ts
 * import { createPuterAuthManager } from 'opencode-puter-auth';
 * 
 * const authManager = createPuterAuthManager('~/.config/opencode');
 * await authManager.init();
 * 
 * if (!authManager.isAuthenticated()) {
 *   const result = await authManager.login();
 *   if (result.success) {
 *     console.log('Logged in as:', result.account?.username);
 *   }
 * }
 * 
 * const account = authManager.getActiveAccount();
 * console.log('Token:', account?.authToken);
 * ```
 * 
 * @module auth
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { URL } from 'node:url';
import type {
  PuterAccount,
  PuterAccountsStorage,
  PuterAuthResult,
  PuterConfig,
} from './types.js';
import { PuterAccountsStorageSchema } from './types.js';
import { createLoggerFromConfig, type Logger } from './logger.js';

/** Default port for the local OAuth callback server */
const DEFAULT_CALLBACK_PORT = 19847;

/** Authentication timeout duration (5 minutes) */
const AUTH_TIMEOUT_MS = 300000;

/**
 * HTML page that handles Puter popup auth flow
 * This page loads the Puter SDK, triggers signIn(), and redirects to our callback
 */
const getAuthHtml = (callbackUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Puter Authentication - OpenCode</title>
  <script src="https://js.puter.com/v2/"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .card {
      background: white;
      padding: 48px;
      border-radius: 16px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 420px;
      width: 90%;
    }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { color: #333; margin-bottom: 8px; font-size: 24px; }
    .subtitle { color: #666; margin-bottom: 24px; font-size: 14px; }
    .status { 
      padding: 16px; 
      border-radius: 8px; 
      margin-bottom: 16px;
      font-size: 14px;
    }
    .status.loading { background: #e3f2fd; color: #1565c0; }
    .status.success { background: #e8f5e9; color: #2e7d32; }
    .status.error { background: #ffebee; color: #c62828; }
    .btn {
      display: inline-block;
      padding: 14px 32px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(102,126,234,0.4); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .features {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid #eee;
      text-align: left;
    }
    .feature {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 13px;
      color: #666;
    }
    .feature-icon { color: #22c55e; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🟣</div>
    <h1>Connect to Puter</h1>
    <p class="subtitle">Access Claude, GPT-5, Gemini and 500+ AI models through Puter.com</p>
    
    <div id="status" class="status loading">Initializing Puter SDK...</div>
    
    <button id="signInBtn" class="btn hidden" onclick="signIn()">
      Sign in with Puter
    </button>
    
    <div class="features">
      <div class="feature"><span class="feature-icon">✓</span> Claude Opus 4.5 & Sonnet 4.5</div>
      <div class="feature"><span class="feature-icon">✓</span> GPT-5.2 & o3-mini</div>
      <div class="feature"><span class="feature-icon">✓</span> Gemini 2.5 Pro (1M context)</div>
      <div class="feature"><span class="feature-icon">✓</span> No API keys required</div>
    </div>
  </div>

  <script>
    const callbackUrl = ${JSON.stringify(callbackUrl)};
    const statusEl = document.getElementById('status');
    const signInBtn = document.getElementById('signInBtn');

    function setStatus(message, type = 'loading') {
      statusEl.textContent = message;
      statusEl.className = 'status ' + type;
    }

    // Check if already signed in
    async function checkAuth() {
      try {
        if (puter.auth.isSignedIn()) {
          setStatus('Already signed in, getting token...', 'loading');
          // Already signed in, get user info and redirect
          const user = await puter.auth.getUser();
          // We need to trigger signIn again to get a fresh token
          await triggerSignIn();
        } else {
          setStatus('Click the button below to sign in', 'loading');
          signInBtn.classList.remove('hidden');
        }
      } catch (err) {
        setStatus('Click the button below to sign in', 'loading');
        signInBtn.classList.remove('hidden');
      }
    }

    async function triggerSignIn() {
      try {
        setStatus('Opening Puter sign-in popup...', 'loading');
        signInBtn.disabled = true;
        
        const result = await puter.auth.signIn();
        
        if (result.success && result.token) {
          setStatus('Success! Redirecting to OpenCode...', 'success');
          
          // Get username from user info
          let username = result.username || 'puter_user';
          try {
            const user = await puter.auth.getUser();
            username = user.username || username;
          } catch (e) {}
          
          // Redirect to callback with token
          const params = new URLSearchParams({
            token: result.token,
            username: username,
            success: 'true'
          });
          
          window.location.href = callbackUrl + '?' + params.toString();
        } else {
          setStatus('Sign-in was not completed. ' + (result.error || ''), 'error');
          signInBtn.disabled = false;
        }
      } catch (err) {
        setStatus('Error: ' + (err.message || 'Sign-in failed'), 'error');
        signInBtn.disabled = false;
      }
    }

    function signIn() {
      triggerSignIn();
    }

    // Initialize on load
    setTimeout(checkAuth, 500);
  </script>
</body>
</html>
`;

/**
 * Internal implementation of PuterAuthManager.
 * 
 * Not exported directly to avoid OpenCode plugin loader issues.
 * OpenCode iterates through all exports and calls them as functions,
 * which causes "cannot call class without new" errors.
 * 
 * Use {@link createPuterAuthManager} factory function instead.
 */
// Internal class - not exported to avoid OpenCode plugin loader issues
// OpenCode iterates through all exports and calls them as functions
class PuterAuthManagerInternal {
  /** Directory where config files are stored */
  private configDir: string;
  
  /** Path to the accounts JSON file */
  private accountsFile: string;
  
  /** In-memory account storage (synced with disk) */
  private storage: PuterAccountsStorage | null = null;
  
  /** Logger instance for debugging */
  private logger: Logger;

  /**
   * Create a new PuterAuthManager instance.
   * 
   * @param configDir - Directory to store account data (e.g., ~/.config/opencode)
   * @param config - Optional configuration overrides
   */
  constructor(configDir: string, config: Partial<PuterConfig> = {}) {
    this.configDir = configDir;
    this.accountsFile = path.join(configDir, 'puter-accounts.json');
    this.logger = createLoggerFromConfig(config);
  }

  /**
   * Initialize the auth manager and load existing accounts from disk.
   * 
   * Must be called before using other methods. Creates the config
   * directory if it doesn't exist and loads any saved accounts.
   * 
   * @throws Error if unable to create config directory
   */
  public async init(): Promise<void> {
    this.logger.debug('Initializing auth manager');
    await this.ensureConfigDir();
    await this.loadAccounts();
    const accountCount = this.storage?.accounts.length || 0;
    this.logger.debug('Auth manager initialized', { accounts: accountCount });
  }

  /**
   * Ensure the config directory exists
   */
  private async ensureConfigDir(): Promise<void> {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch {
      // Directory exists
    }
  }

  /**
   * Load accounts from the persisted JSON file.
   * If file doesn't exist or is invalid, initializes with empty storage.
   */
  private async loadAccounts(): Promise<void> {
    try {
      const data = await fs.readFile(this.accountsFile, 'utf-8');
      const parsed = JSON.parse(data);
      this.storage = PuterAccountsStorageSchema.parse(parsed);
    } catch {
      // No accounts file or invalid - start fresh
      this.storage = {
        version: 1,
        accounts: [],
        activeIndex: 0,
      };
    }
  }

  /**
   * Persist current account storage to disk.
   * Called automatically after any account modification.
   */
  private async saveAccounts(): Promise<void> {
    if (!this.storage) return;
    
    const data = JSON.stringify(this.storage, null, 2);
    await fs.writeFile(this.accountsFile, data, 'utf-8');
  }

  /**
   * Get the currently active Puter account.
   * 
   * The active account is used for all API calls. Use {@link switchAccount}
   * to change which account is active.
   * 
   * @returns The active account, or null if not authenticated
   */
  public getActiveAccount(): PuterAccount | null {
    if (!this.storage || this.storage.accounts.length === 0) {
      return null;
    }
    return this.storage.accounts[this.storage.activeIndex] || null;
  }

  /**
   * Get all stored Puter accounts.
   * 
   * Useful for displaying account selection UI or implementing
   * account rotation when rate limits are hit.
   * 
   * @returns Array of all accounts (may be empty)
   */
  public getAllAccounts(): PuterAccount[] {
    return this.storage?.accounts || [];
  }

  /**
   * Check if there is at least one authenticated account.
   * 
   * @returns true if at least one account is available
   */
  public isAuthenticated(): boolean {
    return this.getActiveAccount() !== null;
  }

  /**
   * Start the OAuth flow by opening a browser for Puter authentication.
   * 
   * This method:
   * 1. Starts a local HTTP server on port 19847
   * 2. Opens the browser to serve the Puter SDK auth page
   * 3. Waits for the user to complete sign-in via Puter popup
   * 4. Receives the token via redirect to /callback
   * 5. Stores the account and shuts down the server
   * 
   * The browser window can be closed after successful authentication.
   * 
   * @returns Authentication result with success status and account details
   * 
   * @example
   * ```ts
   * const result = await authManager.login();
   * if (result.success) {
   *   console.log('Authenticated as:', result.account?.username);
   * } else {
   *   console.error('Auth failed:', result.error);
   * }
   * ```
   */
  public async login(): Promise<PuterAuthResult> {
    return new Promise((resolve) => {
      const port = DEFAULT_CALLBACK_PORT;
      let resolved = false;

      // Create callback server
      const server = http.createServer(async (req, res) => {
        if (resolved) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Already authenticated</h1></body></html>');
          return;
        }

        const url = new URL(req.url || '/', `http://localhost:${port}`);
        
        if (url.pathname === '/callback') {
          const token = url.searchParams.get('token');
          const username = url.searchParams.get('username') || 'puter_user';
          const success = url.searchParams.get('success') === 'true';

          if (token && success) {
            resolved = true;

            const account: PuterAccount = {
              username,
              authToken: token,
              addedAt: Date.now(),
              isTemporary: false,
            };

            // Add account to storage
            await this.addAccount(account);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>Puter Auth Success</title>
                <style>
                  body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
                  .card { background: white; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
                  h1 { color: #22c55e; margin: 0 0 16px 0; }
                  p { color: #666; margin: 0; }
                  .emoji { font-size: 48px; margin-bottom: 16px; }
                </style>
              </head>
              <body>
                <div class="card">
                  <div class="emoji">✅</div>
                  <h1>Authentication Successful!</h1>
                  <p>You can close this window and return to OpenCode.</p>
                  <p style="margin-top: 16px; font-size: 14px; color: #888;">Logged in as: ${username}</p>
                </div>
                <script>
                  // Try to close the window after a short delay
                  setTimeout(() => { try { window.close(); } catch(e) {} }, 2000);
                </script>
              </body>
              </html>
            `);

            server.close();
            resolve({ success: true, account });
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Missing token or auth failed</h1></body></html>');
          }
        } else if (url.pathname === '/') {
          // Serve the auth HTML page
          const callbackUrl = `http://localhost:${port}/callback`;
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(getAuthHtml(callbackUrl));
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      server.listen(port, 'localhost', async () => {
        console.log(`\n🔐 Opening browser for Puter authentication...`);
        console.log(`   If browser doesn't open, visit: http://localhost:${port}\n`);

        // Open browser
        try {
          const open = await import('open');
          await open.default(`http://localhost:${port}`);
        } catch {
          console.log(`   Please open http://localhost:${port} in your browser`);
        }
      });

      // Timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          server.close();
          resolve({ success: false, error: 'Authentication timeout' });
        }
      }, AUTH_TIMEOUT_MS);

      // Handle server errors
      server.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: `Server error: ${err.message}` });
        }
      });
    });
  }

  /**
   * Add a new account or update an existing one.
   * 
   * If an account with the same username exists, it will be updated
   * with the new token. The added/updated account becomes the active account.
   * 
   * @param account - The account to add or update
   * 
   * @example
   * ```ts
   * await authManager.addAccount({
   *   username: 'john_doe',
   *   authToken: 'puter-token-xyz',
   *   addedAt: Date.now(),
   *   isTemporary: false,
   * });
   * ```
   */
  public async addAccount(account: PuterAccount): Promise<void> {
    if (!this.storage) {
      this.storage = { version: 1, accounts: [], activeIndex: 0 };
    }
    
    // Check if account already exists
    const existingIndex = this.storage.accounts.findIndex(
      a => a.username === account.username
    );
    
    if (existingIndex >= 0) {
      // Update existing
      this.storage.accounts[existingIndex] = account;
      this.storage.activeIndex = existingIndex;
      this.logger.auth('Account updated', account.username);
    } else {
      // Add new
      this.storage.accounts.push(account);
      this.storage.activeIndex = this.storage.accounts.length - 1;
      this.logger.auth('Account added', account.username);
    }

    await this.saveAccounts();
  }

  /**
   * Switch to a different account by index.
   * 
   * The index corresponds to the account's position in {@link getAllAccounts}.
   * The switched account becomes the active account for all API calls.
   * 
   * @param index - Zero-based index of the account to switch to
   * @returns true if switch was successful, false if index is invalid
   * 
   * @example
   * ```ts
   * const accounts = authManager.getAllAccounts();
   * if (accounts.length > 1) {
   *   await authManager.switchAccount(1); // Switch to second account
   * }
   * ```
   */
  public async switchAccount(index: number): Promise<boolean> {
    if (!this.storage || index < 0 || index >= this.storage.accounts.length) {
      this.logger.warn('Invalid account switch attempt', { index });
      return false;
    }
    
    this.storage.activeIndex = index;
    await this.saveAccounts();
    const username = this.storage.accounts[index]?.username;
    this.logger.auth('Switched account', username);
    return true;
  }

  /**
   * Remove an account by index.
   * 
   * If the removed account was active, the active index is adjusted
   * to point to the previous account (or first if none remain).
   * 
   * @param index - Zero-based index of the account to remove
   * @returns true if removal was successful, false if index is invalid
   */
  public async removeAccount(index: number): Promise<boolean> {
    if (!this.storage || index < 0 || index >= this.storage.accounts.length) {
      this.logger.warn('Invalid account remove attempt', { index });
      return false;
    }

    const username = this.storage.accounts[index]?.username;
    this.storage.accounts.splice(index, 1);
    
    if (this.storage.activeIndex >= this.storage.accounts.length) {
      this.storage.activeIndex = Math.max(0, this.storage.accounts.length - 1);
    }
    
    await this.saveAccounts();
    this.logger.auth('Account removed', username);
    return true;
  }

  /**
   * Update the lastUsed timestamp for the active account.
   * 
   * Called automatically by PuterClient after successful API calls.
   * Useful for implementing least-recently-used account rotation.
   */
  public async touchActiveAccount(): Promise<void> {
    const account = this.getActiveAccount();
    if (account && this.storage) {
      account.lastUsed = Date.now();
      await this.saveAccounts();
    }
  }

  /**
   * Logout and remove all stored accounts.
   * 
   * This clears all account data from memory and disk.
   * A new login will be required to use the plugin.
   */
  public async logout(): Promise<void> {
    this.logger.auth('Logging out', 'all accounts');
    this.storage = {
      version: 1,
      accounts: [],
      activeIndex: 0,
    };
    await this.saveAccounts();
  }
}

/**
 * Type alias for the auth manager.
 * 
 * Used for external typing without exposing the internal class.
 * Compatible with the {@link IAuthManager} interface for account rotation.
 */
export type PuterAuthManager = PuterAuthManagerInternal;

/**
 * Factory function to create a PuterAuthManager instance.
 * 
 * This is the recommended way to create an auth manager.
 * Direct class instantiation is not exposed to avoid plugin loader issues.
 * 
 * @param configDir - Directory to store account data (e.g., ~/.config/opencode)
 * @param config - Optional configuration overrides
 * @returns A new PuterAuthManager instance (call .init() before use)
 * 
 * @example
 * ```ts
 * import { createPuterAuthManager } from 'opencode-puter-auth';
 * 
 * const authManager = createPuterAuthManager('~/.config/my-app');
 * await authManager.init();
 * 
 * if (!authManager.isAuthenticated()) {
 *   await authManager.login();
 * }
 * 
 * const token = authManager.getActiveAccount()?.authToken;
 * ```
 */
export function createPuterAuthManager(configDir: string, config: Partial<PuterConfig> = {}): PuterAuthManager {
  return new PuterAuthManagerInternal(configDir, config);
}
