'use client';

import { usePathname, useRouter } from 'next/navigation';
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
  Badge,
  Button,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconSun, IconMoon, IconPhoto, IconFileText, IconInfoCircle, IconWand, IconLogin, IconLogout } from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';

const NAV_LINKS = [
  { href: '/carousel', label: 'Carousel', icon: IconPhoto, pro: false },
  { href: '/transcribe', label: 'Transcription', icon: IconFileText, pro: false },
  { href: '/auto-carousel', label: 'Auto Carousel', icon: IconWand, pro: true },
  { href: '/about', label: 'About', icon: IconInfoCircle, pro: false },
];

export function Header() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
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
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
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
                    {link.pro && <Badge size="xs" color="violet" variant="light" ml={2}>Pro</Badge>}
                  </Anchor>
                );
              })}
              {user ? (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  color="dimmed"
                  leftSection={<IconLogout size={14} />}
                  onClick={() => { logout(); router.push('/'); }}
                >
                  Sign Out
                </Button>
              ) : (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  color="dimmed"
                  leftSection={<IconLogin size={14} />}
                  onClick={() => router.push('/login')}
                >
                  Sign In
                </Button>
              )}
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
                  {link.pro && <Badge size="xs" color="violet" variant="light">Pro</Badge>}
                </UnstyledButton>
              </Anchor>
            );
          })}
          {user ? (
            <Button
              variant="subtle"
              size="sm"
              color="dimmed"
              leftSection={<IconLogout size={16} />}
              onClick={() => { logout(); closeDrawer(); router.push('/'); }}
              fullWidth
              justify="flex-start"
            >
              Sign Out
            </Button>
          ) : (
            <Button
              variant="subtle"
              size="sm"
              color="dimmed"
              leftSection={<IconLogin size={16} />}
              onClick={() => { closeDrawer(); router.push('/login'); }}
              fullWidth
              justify="flex-start"
            >
              Sign In
            </Button>
          )}
        </Stack>
      </Drawer>
    </>
  );
}
