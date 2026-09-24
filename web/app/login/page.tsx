import { redirect } from 'next/navigation';
import { AUTH_ENABLED } from '@/lib/auth-flags';
import { Suspense } from 'react';
import LoginForm from './LoginForm';

export default function LoginPage() {
  if (!AUTH_ENABLED) redirect('/');

  return (
    <Suspense fallback={
      <div className="ops-card" style={{ maxWidth: '26rem' }}>
        <h1 className="section-head">Caveat</h1>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
