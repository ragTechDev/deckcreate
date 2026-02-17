'use client';

import { Container, Group, Title, Text, Stack, useMantineColorScheme, ActionIcon } from '@mantine/core';
import { IconSun, IconMoon } from '@tabler/icons-react';

export function Header() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();

  return (
    <Container size="md" py="xl">
      <Group justify="space-between" align="flex-start">
        <Stack gap="xs">
          <Title
            order={1}
            style={{
              fontSize: 'clamp(2rem, 5vw, 3rem)',
              fontWeight: 800,
              background: 'linear-gradient(135deg, #fc8b94 0%, #a2d4d1 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Deckcreate
          </Title>
          <Text size="lg" c="dimmed">
            Transform YouTube videos into stunning carousel images
          </Text>
        </Stack>
        <ActionIcon
          variant="subtle"
          size="lg"
          onClick={() => toggleColorScheme()}
          aria-label="Toggle color scheme"
        >
          {colorScheme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}
        </ActionIcon>
      </Group>
    </Container>
  );
}
