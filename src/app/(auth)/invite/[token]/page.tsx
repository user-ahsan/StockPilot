import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InviteAcceptForm } from '@/components/layout/invite-accept-form';

/**
 * Invitation acceptance screen (Doc 4 §4.5).
 * Server Component: `params` is a Promise in Next 16 and is awaited here.
 *
 * This route sits outside the dashboard shell and has no `<Suspense>` ancestor,
 * so it opts out of cache-components prerendering (Next 16 `instant` flag).
 */
export const instant = false;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">
        <Card className="border-border bg-card text-card-foreground">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-card-foreground">
              Activate your StockPilot account
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Invitation token{' '}
              <span className="font-mono tabular-nums text-foreground">{token.slice(0, 12)}…</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteAcceptForm token={token} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
