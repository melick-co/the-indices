import { redirect } from 'next/navigation';
import { AUTH_ENABLED } from '@/lib/auth-flags';
import { Suspense } from 'react';
import LoginForm from './LoginForm';

export default function LoginPage() {
  if (!AUTH_ENABLED) redirect('/');

  return (
    <Suspense fallback={
      <main className="wrap" style={{ maxWidth: '26rem', paddingTop: '5rem' }}>
        <div className="wordmark" style={{ fontSize: '2rem' }}>Caveat</div>
      </main>
    }>
      <LoginForm />
    </Suspense>
  );
}
