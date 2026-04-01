import { AuthenticatedLayout } from './routes/_authenticated';
import { SignInPage } from './routes/auth/sign-in';
import { OnboardingPage } from './routes/_authenticated/onboarding';

export function App() {
  return (
    <div>
      <SignInPage />
      <AuthenticatedLayout isAuthenticated>
        <OnboardingPage />
      </AuthenticatedLayout>
    </div>
  );
}
