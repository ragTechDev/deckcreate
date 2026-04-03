'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Container,
  Paper,
  Title,
  Text,
  TextInput,
  PasswordInput,
  Button,
  Stack,
  Alert,
  Code,
  Group,
  ThemeIcon,
  Divider,
} from '@mantine/core';
import { IconLock, IconInfoCircle } from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';
import { Header } from '../components/Header';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { login, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user) {
      router.push('/auto-carousel');
    }
  }, [user, router]);

  if (user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const result = await login(email, password);
    setIsLoading(false);

    if (result.success) {
      router.push('/auto-carousel');
    } else {
      setError(result.error || 'Login failed');
    }
  };

  return (
    <div style={{ minHeight: '100vh', paddingBottom: '2rem' }}>
      <Header />
      <Container size="xs" px="md" pt="xl">
        <Paper p="xl" withBorder radius="lg">
          <Stack gap="lg">
            <Stack gap="xs" align="center" ta="center">
              <ThemeIcon size={48} radius="xl" variant="light" color="primary">
                <IconLock size={24} />
              </ThemeIcon>
              <Title order={3}>Sign in to Deckcreate Pro</Title>
              <Text size="sm" c="dimmed">
                Access AI-powered auto bulk carousel generation
              </Text>
            </Stack>

            <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
              <Text size="xs">
                <strong>Demo credentials:</strong>
              </Text>
              <Text size="xs">
                Email: <Code>demo@deckcreate.com</Code>
              </Text>
              <Text size="xs">
                Password: <Code>demo123</Code>
              </Text>
            </Alert>

            {error && (
              <Alert color="red" variant="light">
                <Text size="sm">{error}</Text>
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <Stack gap="md">
                <TextInput
                  label="Email"
                  placeholder="demo@deckcreate.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />
                <PasswordInput
                  label="Password"
                  placeholder="demo123"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                />
                <Button type="submit" fullWidth loading={isLoading}>
                  Sign In
                </Button>
              </Stack>
            </form>

            <Divider label="Why sign in?" labelPosition="center" />

            <Text size="xs" c="dimmed" ta="center">
              The Auto Bulk Carousel feature uses a local LLM (Ollama) to intelligently
              select the best segments from your video for carousel content. This premium
              feature is available to subscribers.
            </Text>
          </Stack>
        </Paper>
      </Container>
    </div>
  );
}
