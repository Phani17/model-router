import { describe, expect, it } from 'vitest';
import { parseEnv } from '../env.js';

describe('environment configuration', () => {
  it('treats an empty Compose access-key value as unconfigured', () => {
    const parsed = parseEnv({ DIGITALOCEAN_MODEL_ACCESS_KEY: '' });

    expect(parsed.DIGITALOCEAN_MODEL_ACCESS_KEY).toBeUndefined();
    expect(parsed.PORT).toBe(8080);
    expect(parsed.HOST).toBe('0.0.0.0');
  });

  it('retains a configured access key', () => {
    const parsed = parseEnv({ DIGITALOCEAN_MODEL_ACCESS_KEY: 'test-key' });

    expect(parsed.DIGITALOCEAN_MODEL_ACCESS_KEY).toBe('test-key');
  });

  it('fails closed when SSO is enabled without complete OIDC settings', () => {
    expect(() => parseEnv({ AUTH_ENABLED: 'true' })).toThrow(/OIDC_ISSUER/);
  });

  it('accepts a complete OIDC configuration', () => {
    const parsed = parseEnv({ AUTH_ENABLED: 'true', OIDC_ISSUER: 'https://id.example.com/', OIDC_AUDIENCE: 'router', OIDC_JWKS_URL: 'https://id.example.com/jwks' });
    expect(parsed.AUTH_ENABLED).toBe(true);
  });
});
