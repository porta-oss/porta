import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { organization } from 'better-auth/plugins/organization';

import type { ApiDatabase } from './db/index';
import * as authSchema from './db/schema/auth';
import type { ApiEnv } from './lib/env';
import { summarizeAuthProviders } from './lib/env';

export interface MagicLinkDelivery {
  email: string;
  url: string;
  token: string;
  createdAt: string;
}

export interface ApiAuthRuntime {
  auth: ReturnType<typeof betterAuth>;
  bootstrap: {
    basePath: '/api/auth';
    providers: ReturnType<typeof summarizeAuthProviders>;
    magicLinkTransport: 'dev-inbox';
  };
  listMagicLinks: (email?: string) => MagicLinkDelivery[];
  getLatestMagicLink: (email?: string) => MagicLinkDelivery | undefined;
  resetMagicLinks: () => void;
}

export function createWorkspaceSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export function createAuthRuntime(env: ApiEnv, database: ApiDatabase): ApiAuthRuntime {
  const magicLinkInbox: MagicLinkDelivery[] = [];
  const providers = summarizeAuthProviders(env);

  const auth = betterAuth({
    appName: 'Founder Control Plane',
    baseURL: env.betterAuthUrl,
    basePath: '/api/auth',
    secret: env.betterAuthSecret,
    trustedOrigins: [env.webUrl, env.apiUrl],
    advanced: {
      useSecureCookies: env.nodeEnv === 'production'
    },
    database: drizzleAdapter(database.db, {
      provider: 'pg',
      transaction: true,
      schema: authSchema
    }),
    socialProviders: providers.google.configured
      ? {
          google: {
            clientId: env.googleClientId!,
            clientSecret: env.googleClientSecret!
          }
        }
      : undefined,
    plugins: [
      organization({
        schema: {
          session: {
            fields: {
              activeOrganizationId: 'active_workspace_id'
            }
          },
          organization: {
            modelName: 'workspace'
          },
          member: {
            modelName: 'member'
          },
          invitation: {
            modelName: 'invitation'
          }
        }
      }),
      magicLink({
        expiresIn: 60 * 10,
        allowedAttempts: 1,
        sendMagicLink: async ({ email, token, url }) => {
          const delivery: MagicLinkDelivery = {
            email,
            token,
            url,
            createdAt: new Date().toISOString()
          };

          magicLinkInbox.push(delivery);
          console.info('[auth] magic-link queued', {
            email,
            transport: 'dev-inbox',
            sender: env.magicLinkSenderEmail
          });
        }
      })
    ]
  });

  return {
    auth: auth as unknown as ReturnType<typeof betterAuth>,
    bootstrap: {
      basePath: '/api/auth',
      providers,
      magicLinkTransport: 'dev-inbox'
    },
    listMagicLinks(email) {
      if (!email) {
        return [...magicLinkInbox];
      }

      return magicLinkInbox.filter((entry) => entry.email === email);
    },
    getLatestMagicLink(email) {
      const messages = email ? magicLinkInbox.filter((entry) => entry.email === email) : magicLinkInbox;
      return messages.at(-1);
    },
    resetMagicLinks() {
      magicLinkInbox.length = 0;
    }
  };
}
