'use client';

/** Client form for the invitation-acceptance screen (Doc 4 §4.5). */
import { useState, type FormEvent } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface InviteAcceptFormProps {
  token: string;
}

export function InviteAcceptForm({ token }: InviteAcceptFormProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  const tooShort = password.length > 0 && password.length < 12;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function activate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      const res = await fetch('/api/v1/auth/accept-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(payload?.error?.message ?? 'This invitation could not be activated.');
        return;
      }
      setDone(true);
    } catch {
      setError('Network error. Please retry.');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <Alert>
        <AlertTitle>Account activated</AlertTitle>
        <AlertDescription>You can now sign in with your new password.</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={activate} className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not activate</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {tooShort ? <p className="text-xs text-destructive">At least 12 characters.</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        {mismatch ? <p className="text-xs text-destructive">Passwords do not match.</p> : null}
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Activating…' : 'Set password & activate'}
      </Button>
    </form>
  );
}
