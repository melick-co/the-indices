import { Suspense } from 'react';
import LoginForm from './LoginForm';

export default function LoginPage() {
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
