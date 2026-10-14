'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getPublicEnv } from '@/lib/env';

const DEMO_PERSONAS: ReadonlyArray<{ role: string; label: string }> = [
  { role: 'OWNER', label: 'Owner' },
  { role: 'MANAGER', label: 'Store Manager' },
  { role: 'PROCUREMENT_OFFICER', label: 'Procurement Officer' },
  { role: 'WAREHOUSE_CLERK', label: 'Warehouse Clerk' },
  { role: 'SALES_ASSOCIATE', label: 'Sales Associate' },
  { role: 'AUDITOR', label: 'Auditor' },
];

export default function LoginPage() {
  const router = useRouter();
  const isDemo = getPublicEnv().NEXT_PUBLIC_APP_ENV === 'demo';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function signIn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending('credentials');
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(payload?.error?.message ?? 'Unable to sign in.');
        return;
      }
      router.push('/overview');
    } catch {
      setError('Network error. Please retry.');
    } finally {
      setPending(null);
    }
  }

  async function switchPersona(role: string): Promise<void> {
    setError(null);
    setPending(role);
    try {
      const res = await fetch('/api/v1/auth/demo-switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(payload?.error?.message ?? 'Unable to switch persona.');
        return;
      }
      router.push('/overview');
    } catch {
      setError('Network error. Please retry.');
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">StockPilot</h1>
          <p className="text-sm text-muted-foreground">Multi-location inventory & order management</p>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Sign-in failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Card className="bg-card text-card-foreground border-border">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-card-foreground">Sign in</CardTitle>
            <CardDescription className="text-muted-foreground">
              Use your Nexus Hardware &amp; Electronics credentials.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={signIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@nexushardware.test"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <Button type="submit" className="w-full" disabled={pending !== null}>
                {pending === 'credentials' ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {isDemo ? (
          <Card className="bg-card text-card-foreground border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold text-card-foreground">
                  1-Click Demo Persona Switcher
                </CardTitle>
                <Badge variant="secondary">demo</Badge>
              </div>
              <CardDescription className="text-muted-foreground">
                Instantly sign in as one of the six RBAC roles.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_PERSONAS.map((persona) => (
                  <Button
                    key={persona.role}
                    type="button"
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => switchPersona(persona.role)}
                  >
                    {pending === persona.role ? 'Switching…' : persona.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
