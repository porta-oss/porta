import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";

import type { ApiDatabase } from "./db/index";
import {
  account,
  accountRelations,
  invitation,
  invitationRelations,
  member,
  memberRelations,
  session,
  sessionRelations,
  user,
  userRelations,
  verification,
  workspace,
  workspaceRelations,
} from "./db/schema/auth";
import type { ApiEnv } from "./lib/env";
import { summarizeAuthProviders } from "./lib/env";

export interface MagicLinkDelivery {
  createdAt: string;
  email: string;
  token: string;
  url: string;
}

export interface ApiAuthRuntime {
  auth: ReturnType<typeof betterAuth>;
  bootstrap: {
    basePath: "/api/auth";
    providers: ReturnType<typeof summarizeAuthProviders>;
    magicLinkTransport: "dev-inbox";
  };
  getLatestMagicLink: (email?: string) => MagicLinkDelivery | undefined;
  listMagicLinks: (email?: string) => MagicLinkDelivery[];
  resetMagicLinks: () => void;
}

export function createWorkspaceSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function hasGoogleProviderConfig(env: ApiEnv): env is ApiEnv & {
  googleClientId: string;
  googleClientSecret: string;
} {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

export function createAuthRuntime(
  env: ApiEnv,
  database: ApiDatabase
): ApiAuthRuntime {
  const magicLinkInbox: MagicLinkDelivery[] = [];
  const providers = summarizeAuthProviders(env);

  const auth = betterAuth({
    appName: "Porta",
    baseURL: env.betterAuthUrl,
    basePath: "/api/auth",
    secret: env.betterAuthSecret,
    trustedOrigins: [env.webUrl, env.apiUrl],
    advanced: {
      useSecureCookies: env.nodeEnv === "production",
    },
    database: drizzleAdapter(database.db, {
      provider: "pg",
      transaction: true,
      schema: {
        account,
        accountRelations,
        invitation,
        invitationRelations,
        member,
        memberRelations,
        session,
        sessionRelations,
        user,
        userRelations,
        verification,
        workspace,
        workspaceRelations,
      },
    }),
    socialProviders: hasGoogleProviderConfig(env)
      ? {
          google: {
            clientId: env.googleClientId,
            clientSecret: env.googleClientSecret,
          },
        }
      : undefined,
    plugins: [
      organization({
        schema: {
          session: {
            fields: {
              activeOrganizationId: "active_workspace_id",
            },
          },
          organization: {
            modelName: "workspace",
          },
          member: {
            modelName: "member",
          },
          invitation: {
            modelName: "invitation",
          },
        },
      }),
      magicLink({
        expiresIn: 60 * 10,
        allowedAttempts: 1,
        sendMagicLink: async ({ email, token, url }) => {
          const delivery: MagicLinkDelivery = {
            email,
            token,
            url,
            createdAt: new Date().toISOString(),
          };

          magicLinkInbox.push(delivery);
          console.info("[auth] magic-link queued", {
            email,
            transport: "dev-inbox",
            sender: env.magicLinkSenderEmail,
          });
        },
      }),
    ],
  });

  return {
    auth: auth as unknown as ReturnType<typeof betterAuth>,
    bootstrap: {
      basePath: "/api/auth",
      providers,
      magicLinkTransport: "dev-inbox",
    },
    listMagicLinks(email) {
      if (!email) {
        return [...magicLinkInbox];
      }

      return magicLinkInbox.filter((entry) => entry.email === email);
    },
    getLatestMagicLink(email) {
      const messages = email
        ? magicLinkInbox.filter((entry) => entry.email === email)
        : magicLinkInbox;
      return messages.at(-1);
    },
    resetMagicLinks() {
      magicLinkInbox.length = 0;
    },
  };
}
