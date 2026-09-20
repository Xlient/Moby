import { useState, type CSSProperties, type FormEvent } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { useResponsive } from '@/hooks/useResponsive';
import { useAuth } from '@/auth/AuthContext';
import { typography, spacing, radius } from '@/theme/tokens';

export function AuthScreen() {
  const { theme } = useTheme();
  const r = useResponsive();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Enter your email address.');
      return;
    }
    if (!password) {
      setError('Enter a password.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signIn(trimmedEmail, password);
      } else {
        await signUp(trimmedEmail, password);
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const styles: Record<string, CSSProperties> = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      minHeight: '100%',
      padding: `${r.sectionGap}px ${r.gutter}px`,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    },
    title: {
      ...r.title,
      color: theme.text.primary,
      margin: `0 0 ${spacing.scale[1]}px 0`,
      fontVariantNumeric: undefined,
    },
    subtitle: {
      ...typography.body,
      color: theme.text.secondary,
      margin: `0 0 ${r.sectionGap}px 0`,
      fontVariantNumeric: undefined,
    },
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: spacing.scale[3],
    },
    fieldLabel: {
      ...typography.label,
      color: theme.text.secondary,
      marginBottom: spacing.scale[1],
      display: 'block',
      fontVariantNumeric: undefined,
    },
    input: {
      ...typography.body,
      width: '100%',
      padding: `${spacing.scale[2]}px ${spacing.scale[3]}px`,
      backgroundColor: theme.bg.recessed,
      border: `1px solid ${theme.line.hairline}`,
      borderRadius: radius.input,
      color: theme.text.primary,
      fontVariantNumeric: undefined,
      outline: 'none',
    },
    submitBtn: {
      ...typography.bodyStrong,
      width: '100%',
      minHeight: spacing.minTapTarget,
      backgroundColor: theme.accent.calm,
      color: theme.bg.raised,
      border: 'none',
      borderRadius: radius.input,
      cursor: submitting ? 'default' : 'pointer',
      opacity: submitting ? 0.6 : 1,
      fontVariantNumeric: undefined,
      marginTop: spacing.scale[2],
    },
    error: {
      ...typography.meta,
      color: theme.severity.critical,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    switchRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.scale[1],
      marginTop: r.sectionGap,
    },
    switchText: {
      ...typography.meta,
      color: theme.text.secondary,
    },
    switchBtn: {
      ...typography.meta,
      fontWeight: 600,
      color: theme.accent.calm,
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: 0,
      minHeight: spacing.minTapTarget,
      display: 'inline-flex',
      alignItems: 'center',
    },
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>
        {mode === 'signin' ? 'Sign in' : 'Create account'}
      </h1>
      <p style={styles.subtitle}>
        {mode === 'signin'
          ? 'Welcome back to Early Warning.'
          : 'Set up your account to receive alerts.'}
      </p>

      <form style={styles.form} onSubmit={handleSubmit} noValidate>
        <div>
          <label style={styles.fieldLabel} htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            style={styles.input}
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            aria-invalid={!!error}
          />
        </div>

        <div>
          <label style={styles.fieldLabel} htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            style={styles.input}
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
        </div>

        {error && (
          <p style={styles.error} role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          style={styles.submitBtn}
          disabled={submitting}
        >
          {submitting
            ? 'One moment\u2026'
            : mode === 'signin'
              ? 'Sign in'
              : 'Create account'}
        </button>
      </form>

      <div style={styles.switchRow}>
        <span style={styles.switchText}>
          {mode === 'signin'
            ? 'No account yet?'
            : 'Already have an account?'}
        </span>
        <button
          type="button"
          style={styles.switchBtn}
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
          }}
        >
          {mode === 'signin' ? 'Create one' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
