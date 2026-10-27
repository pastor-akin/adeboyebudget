import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { Colors, Radius, Shadow } from '../constants/theme';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // Shown inline — RN's Alert.alert does nothing in a web browser.
  const [error, setError] = useState('');

  async function signIn() {
    setError('');
    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(error.message);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>
        <View style={styles.logo}>
          <Ionicons name="home" size={34} color="#fff" />
        </View>
        <Text style={styles.title}>Adeboye Budget</Text>
        <Text style={styles.subtitle}>Your household's money, together.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={Colors.textMuted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={Colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            onSubmitEditing={signIn}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity style={styles.button} onPress={signIn} disabled={loading} activeOpacity={0.85}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, width: '100%', maxWidth: 440, alignSelf: 'center' },
  logo: { width: 72, height: 72, borderRadius: 24, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 18, ...Shadow.raised },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', marginTop: 6, marginBottom: 28 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: 22, ...Shadow.card },
  label: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: Colors.text, marginBottom: 16,
  },
  error: { color: Colors.error, fontSize: 13.5, fontWeight: '600', marginBottom: 12 },
  button: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
