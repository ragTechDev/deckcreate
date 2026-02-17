'use client';

import { usePathname } from 'next/navigation';
import {
  Container,
  Group,
  Title,
  Anchor,
  ActionIcon,
  useMantineColorScheme,
  Burger,
  Drawer,
  Stack,
  UnstyledButton,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconSun, IconMoon, IconPhoto, IconFileText, IconInfoCircle } from '@tabler/icons-react';

const NAV_LINKS = [
  { href: '/carousel', label: 'Carousel Generator', icon: IconPhoto },
  { href: '/transcribe', label: 'Transcription', icon: IconFileText },
  { href: '/about', label: 'About', icon: IconInfoCircle },
];

export function Header() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const pathname = usePathname();
  const [drawerOpened, { toggle: toggleDrawer, close: closeDrawer }] = useDisclosure(false);

  return (
    <>
      <header
        style={{
          borderBottom: '1px solid var(--mantine-color-default-border)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          backdropFilter: 'blur(12px)',
          backgroundColor: 'var(--mantine-color-body)',
        }}
      >
        <Container size="md" py="sm">
          <Group justify="space-between" align="center">
            <Anchor href="/" underline="never">
              <Title
                order={3}
                style={{
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, #fc8b94 0%, #a2d4d1 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Deckcreate
              </Title>
            </Anchor>

            {/* Desktop nav */}
            <Group gap="xs" visibleFrom="sm">
              {NAV_LINKS.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Anchor
                    key={link.href}
                    href={link.href}
                    underline="never"
                    px="sm"
                    py={6}
                    style={{
                      borderRadius: 'var(--mantine-radius-md)',
                      fontWeight: isActive ? 600 : 400,
                      fontSize: 'var(--mantine-font-size-sm)',
                      color: isActive
                        ? 'var(--mantine-color-primary-6)'
                        : 'var(--mantine-color-dimmed)',
                      backgroundColor: isActive
                        ? 'var(--mantine-color-primary-light)'
                        : 'transparent',
                      transition: 'background-color 150ms ease',
                    }}
                  >
                    {link.label}
                  </Anchor>
                );
              })}
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={() => toggleColorScheme()}
                aria-label="Toggle color scheme"
              >
                {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Group>

            {/* Mobile burger */}
            <Group gap="xs" hiddenFrom="sm">
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={() => toggleColorScheme()}
                aria-label="Toggle color scheme"
              >
                {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
              <Burger opened={drawerOpened} onClick={toggleDrawer} size="sm" />
            </Group>
          </Group>
        </Container>
      </header>

      {/* Mobile drawer */}
      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        size="xs"
        padding="md"
        title={
          <Title
            order={4}
            style={{
              fontWeight: 800,
              background: 'linear-gradient(135deg, #fc8b94 0%, #a2d4d1 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Deckcreate
          </Title>
        }
        zIndex={200}
      >
        <Stack gap="xs">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;
            return (
              <Anchor key={link.href} href={link.href} underline="never" onClick={closeDrawer}>
                <UnstyledButton
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--mantine-radius-md)',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive
                      ? 'var(--mantine-color-primary-6)'
                      : 'var(--mantine-color-dimmed)',
                    backgroundColor: isActive
                      ? 'var(--mantine-color-primary-light)'
                      : 'transparent',
                  }}
                >
                  <Icon size={18} />
                  <Text size="sm" inherit>{link.label}</Text>
                </UnstyledButton>
              </Anchor>
            );
          })}
        </Stack>
      </Drawer>
    </>
  );
}
