import { createRouter, type RouterHistory } from '@tanstack/react-router';

import { authController, type AuthController } from './lib/auth-client';
import { authenticatedRoute, protectedHomeRoute } from './routes/_authenticated';
import { signInRoute } from './routes/auth/sign-in';
import { rootRoute } from './routes/__root';
import { indexRoute } from './routes/index';

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  authenticatedRoute.addChildren([protectedHomeRoute])
]);

export function createAppRouter(
  auth: AuthController = authController,
  options?: { history?: RouterHistory }
) {
  return createRouter({
    routeTree,
    history: options?.history,
    context: {
      auth
    },
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultPreload: 'intent'
  });
}

export const router = createAppRouter();

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
