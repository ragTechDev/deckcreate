'use client';

import { useRouter } from 'next/navigation';
import { Container, Stack, Paper, Title, Text, Button, Group, ThemeIcon, Badge, Loader, Center } from '@mantine/core';
import { IconLock, IconWand } from '@tabler/icons-react';
import { Header } from '../components/Header';
import { AutoCarouselForm } from '../components/AutoCarouselForm';
import { useAuth } from '../context/AuthContext';

export default function AutoCarouselPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh' }}>
        <Header />
        <Center pt={100}>
          <Loader size="lg" />
        </Center>
      </div>
    );
  }

  if (!user || !user.isSubscribed) {
    return (
      <div style={{ minHeight: '100vh', paddingBottom: '2rem' }}>
        <Header />
        <Container size="sm" px="md" pt="xl">
          <Paper p="xl" withBorder radius="lg" ta="center">
            <Stack gap="lg" align="center">
              <ThemeIcon size={64} radius="xl" variant="light" color="violet">
                <IconLock size={32} />
              </ThemeIcon>
              <Badge color="violet" variant="light" size="lg">Pro Feature</Badge>
              <Title order={3}>Auto Bulk Carousel Generator</Title>
              <Text size="sm" c="dimmed" maw={400}>
                This premium feature uses a local LLM to analyze your video transcript and
                automatically generate multiple carousel posts with attention-grabbing hooks
                and call-to-action slides.
              </Text>
              <Stack gap="xs">
                <Button
                  size="md"
                  color="violet"
                  onClick={() => router.push('/login')}
                  leftSection={<IconLock size={16} />}
                >
                  Sign In to Access
                </Button>
                <Text size="xs" c="dimmed">
                  Demo: demo@deckcreate.com / demo123
                </Text>
              </Stack>
            </Stack>
          </Paper>
        </Container>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', paddingBottom: '2rem' }}>
      <Header />
      <Container size="md" px="md" pt="xl">
        <AutoCarouselForm />
      </Container>
    </div>
  );
}
