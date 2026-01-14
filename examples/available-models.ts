/**
 * Available Models Example for opencode-puter-auth
 * 
 * This example shows how to list and use different AI models
 * available through Puter.com
 */

// Models available through Puter.com (as of January 2025)
// These are FREE and UNLIMITED for users to use!

export const CLAUDE_MODELS = [
  'claude-sonnet-4',      // Claude Sonnet 4 - Fast and capable
  'claude-sonnet-4-5',    // Claude Sonnet 4.5 - Enhanced version
  'claude-opus-4',        // Claude Opus 4 - Most capable
  'claude-opus-4-5',      // Claude Opus 4.5 - Enhanced most capable
  'claude-haiku-4-5',     // Claude Haiku 4.5 - Fastest
] as const;

export const GPT_MODELS = [
  'gpt-5-nano',           // GPT-5 Nano - Fast and efficient
  'gpt-5',                // GPT-5 - Full version (via OpenRouter)
] as const;

export const GEMINI_MODELS = [
  'gemini-2.0-flash',     // Gemini 2.0 Flash
  'gemini-2.5-pro',       // Gemini 2.5 Pro
] as const;

export const OPENROUTER_MODELS = [
  // Access 500+ models via OpenRouter prefix
  'openrouter:anthropic/claude-3.5-sonnet',
  'openrouter:openai/gpt-4o',
  'openrouter:google/gemini-pro',
  'openrouter:meta-llama/llama-3.3-70b-instruct',
  'openrouter:mistralai/mistral-large',
  'openrouter:deepseek/deepseek-r1',
  'openrouter:prime-intellect/intellect-3',
] as const;

// All available models
export const ALL_MODELS = [
  ...CLAUDE_MODELS,
  ...GPT_MODELS,
  ...GEMINI_MODELS,
  ...OPENROUTER_MODELS,
] as const;

// Model recommendations by use case
export const RECOMMENDED_MODELS = {
  // For complex reasoning and analysis
  reasoning: 'claude-opus-4-5',
  
  // For fast, everyday tasks
  fast: 'claude-haiku-4-5',
  
  // For balanced performance
  balanced: 'claude-sonnet-4-5',
  
  // For code generation
  coding: 'claude-sonnet-4-5',
  
  // For creative writing
  creative: 'claude-opus-4',
  
  // For budget-conscious usage (all are free, but haiku is fastest)
  efficient: 'claude-haiku-4-5',
} as const;

console.log('Available AI Models through Puter.com:');
console.log('=====================================\n');

console.log('Claude Models:');
CLAUDE_MODELS.forEach(m => console.log(`  - ${m}`));

console.log('\nGPT Models:');
GPT_MODELS.forEach(m => console.log(`  - ${m}`));

console.log('\nGemini Models:');
GEMINI_MODELS.forEach(m => console.log(`  - ${m}`));

console.log('\nOpenRouter Models (500+ available):');
OPENROUTER_MODELS.forEach(m => console.log(`  - ${m}`));

console.log('\n✨ All models are FREE and UNLIMITED through Puter.com!');
console.log('💡 Users pay their own Puter usage - developers pay nothing!');
