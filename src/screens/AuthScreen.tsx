import { useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { useResponsive } from '@/hooks/useResponsive';
import { useAuth } from '@/auth/AuthContext';
import { typography, spacing, radius } from '@/theme/tokens';

export function AuthScreen() {
  const { theme } = useTheme();
  const r = useResponsive();
  const { signIn, signUp, sendPasswordReset, googleAvailable, signInWithGoogle } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleForgotPassword = async () => {
    setError(null);
    setNotice(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Enter your email above, then tap \u201cForgot password?\u201d again.');
      return;
    }
    setSubmitting(true);
    try {
      await sendPasswordReset(trimmedEmail);
      setNotice(`If ${trimmedEmail} has an account, a reset link is on its way.`);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setNotice(null);

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
        await signUp(name, trimmedEmail, password);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = [
    typography.body,
    styles.input,
    {
      backgroundColor: theme.bg.recessed,
      borderColor: theme.line.hairline,
      color: theme.text.primary,
    },
  ];
  const labelStyle = [typography.label, styles.fieldLabel, { color: theme.text.secondary }];

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingVertical: r.sectionGap, paddingHorizontal: r.gutter },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          accessibilityRole="header"
          style={[r.title, styles.title, { color: theme.text.primary }]}
        >
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </Text>
        <Text
          style={[typography.body, { color: theme.text.secondary, marginBottom: r.sectionGap }]}
        >
          {mode === 'signin'
            ? 'Welcome back to Moby.'
            : 'Set up your account to receive alerts.'}
        </Text>

        {googleAvailable && (
          <>
            <Button
              mode="outlined"
              icon="google"
              onPress={handleGoogle}
              disabled={submitting}
              textColor={theme.text.primary}
              style={[styles.googleBtn, { borderColor: theme.line.hairline, backgroundColor: theme.bg.raised }]}
              contentStyle={styles.googleBtnContent}
              labelStyle={typography.bodyStrong}
            >
              Continue with Google
            </Button>
            <Text style={[typography.meta, styles.orText, { color: theme.text.secondary }]}>
              Or use your email
            </Text>
          </>
        )}

        <View style={styles.form}>
          {mode === 'signup' && (
            <View>
              <Text style={labelStyle} nativeID="auth-name-label">
                First name (optional)
              </Text>
              <TextInput
                style={inputStyle}
                accessibilityLabelledBy="auth-name-label"
                accessibilityLabel="First name, optional"
                autoCapitalize="words"
                autoComplete="given-name"
                textContentType="givenName"
                value={name}
                onChangeText={setName}
                editable={!submitting}
                returnKeyType="next"
                maxLength={80}
              />
            </View>
          )}

          <View>
            <Text style={labelStyle} nativeID="auth-email-label">
              Email
            </Text>
            <TextInput
              style={inputStyle}
              accessibilityLabelledBy="auth-email-label"
              accessibilityLabel="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
              editable={!submitting}
              returnKeyType="next"
              placeholderTextColor={theme.text.faint}
            />
          </View>

          <View>
            <Text style={labelStyle} nativeID="auth-password-label">
              Password
            </Text>
            <TextInput
              style={inputStyle}
              accessibilityLabelledBy="auth-password-label"
              accessibilityLabel="Password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              textContentType={mode === 'signin' ? 'password' : 'newPassword'}
              value={password}
              onChangeText={setPassword}
              editable={!submitting}
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />
          </View>

          {error && (
            <Text
              accessibilityRole="alert"
              style={[typography.meta, { color: theme.severity.critical }]}
            >
              {error}
            </Text>
          )}

          {notice && (
            <Text accessibilityLiveRegion="polite" style={[typography.meta, { color: theme.text.secondary }]}>
              {notice}
            </Text>
          )}

          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting, busy: submitting }}
            style={[
              styles.submitBtn,
              { backgroundColor: theme.accent.calm, opacity: submitting ? 0.6 : 1 },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: theme.bg.raised }]}>
              {submitting
                ? 'One moment…'
                : mode === 'signin'
                  ? 'Sign in'
                  : 'Create account'}
            </Text>
          </Pressable>
        </View>

        {mode === 'signin' && (
          <Pressable
            accessibilityRole="button"
            style={[styles.switchBtn, styles.forgotBtn]}
            onPress={handleForgotPassword}
            disabled={submitting}
          >
            <Text style={[typography.meta, styles.strong, { color: theme.accent.calm }]}>
              Forgot password?
            </Text>
          </Pressable>
        )}

        <View style={[styles.switchRow, { marginTop: r.sectionGap }]}>
          <Text style={[typography.meta, { color: theme.text.secondary }]}>
            {mode === 'signin' ? 'No account yet?' : 'Already have an account?'}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.switchBtn}
            onPress={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
              setNotice(null);
            }}
          >
            <Text style={[typography.meta, styles.strong, { color: theme.accent.calm }]}>
              {mode === 'signin' ? 'Create one' : 'Sign in'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  title: {
    marginBottom: spacing.scale[1],
  },
  form: {
    gap: spacing.scale[3],
  },
  fieldLabel: {
    marginBottom: spacing.scale[1],
  },
  input: {
    paddingVertical: spacing.scale[2],
    paddingHorizontal: spacing.scale[3],
    borderWidth: 1,
    borderRadius: radius.input,
  },
  submitBtn: {
    minHeight: spacing.minTapTarget,
    borderRadius: radius.input,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.scale[2],
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.scale[1],
  },
  switchBtn: {
    minHeight: spacing.minTapTarget,
    justifyContent: 'center',
  },
  strong: {
    fontWeight: '600',
  },
  googleBtn: {
    borderRadius: radius.input,
  },
  googleBtnContent: {
    minHeight: spacing.minTapTarget,
  },
  orText: {
    marginTop: spacing.scale[4],
    marginBottom: spacing.scale[2],
  },
  forgotBtn: {
    alignSelf: 'center',
    marginTop: spacing.scale[2],
  },
});
