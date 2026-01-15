/**
 * OpenCode Plugin Example
 * 
 * This shows how the opencode-puter-auth plugin integrates with OpenCode.
 * You don't need to use this file directly - just install the plugin!
 */

/*
 * INSTALLATION
 * ============
 * 
 * 1. Install the plugin:
 *    npm install opencode-puter-auth
 * 
 * 2. Add to your opencode.json configuration:
 *    {
 *      "plugins": ["opencode-puter-auth"],
 *      "provider": {
 *        "puter": {
 *          "models": {
 *            "claude-opus-4-5": {
 *              "name": "Claude Opus 4.5 (FREE via Puter)",
 *              "limit": { "context": 200000, "output": 64000 }
 *            },
 *            "claude-sonnet-4-5": {
 *              "name": "Claude Sonnet 4.5 (FREE via Puter)",
 *              "limit": { "context": 200000, "output": 64000 }
 *            },
 *            "gpt-4o": {
 *              "name": "GPT-4o (FREE via Puter)",
 *              "limit": { "context": 128000, "output": 16384 }
 *            },
 *            "gemini-2.5-pro": {
 *              "name": "Gemini 2.5 Pro (FREE via Puter)",
 *              "limit": { "context": 1000000, "output": 65536 }
 *            }
 *          }
 *        }
 *      }
 *    }
 * 
 * 3. Start OpenCode and authenticate:
 *    opencode auth login
 *    (Select "Puter.com (FREE Unlimited AI)" as the provider)
 * 
 * 4. A browser window opens - sign in with your Puter account
 * 
 * 5. You're ready! OpenCode now has access to:
 *    - Claude Opus 4.5, Sonnet 4.5, Haiku
 *    - GPT-5, GPT-5 Nano
 *    - Gemini models
 *    - 500+ other AI models via Puter
 * 
 * 
 * CUSTOM TOOLS PROVIDED
 * =====================
 * 
 * The plugin adds these tools to OpenCode:
 * 
 * 1. puter_login
 *    - Trigger authentication flow manually
 *    - Opens Puter login in browser
 * 
 * 2. puter_models
 *    - List all available AI models
 *    - Shows model capabilities and pricing
 * 
 * 3. puter_account
 *    - View your Puter account info
 *    - Check authentication status
 * 
 * 
 * HOW IT WORKS
 * ============
 * 
 * 1. Plugin registers as an OAuth provider with OpenCode
 * 2. When you run `opencode auth login`, it starts a local HTTP server
 * 3. Server serves an HTML page that loads Puter.js SDK
 * 4. User clicks "Sign in with Puter" - popup opens
 * 5. After authentication, token is stored locally
 * 6. OpenCode uses the token for all AI requests through Puter
 * 
 * 
 * BENEFITS
 * ========
 * 
 * - FREE: No API keys needed, no billing to set up
 * - UNLIMITED: No rate limits, no usage caps
 * - USER-PAYS: Each user pays their own Puter usage
 * - SECURE: Tokens stored locally, never transmitted
 * - PRIVATE: Your data stays between you and Puter
 * 
 * 
 * TROUBLESHOOTING
 * ===============
 * 
 * If authentication fails:
 * 1. Make sure port 19847 is available
 * 2. Check your firewall settings
 * 3. Try disabling browser extensions
 * 4. Clear browser cookies for puter.com
 * 
 * If models aren't working:
 * 1. Re-authenticate: opencode auth login
 * 2. Check Puter service status: https://puter.com
 * 3. Try a different model
 * 
 */

export {}; // Make this a module
