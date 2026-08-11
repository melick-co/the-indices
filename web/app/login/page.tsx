import { Suspense } from 'react';
import LoginForm from './LoginForm';

export default function LoginPage() {
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
